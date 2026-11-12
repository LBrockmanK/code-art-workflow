#!/usr/bin/env node
// Frame-accurate renderer for plain-browser pieces (Canvas 2D, SVG/DOM, Three.js): the fallback
// renderer beside Remotion. Ported from the code-video proof of concept.
//
// Page contract:
//   window.piece = { width, height, fps, duration, async setup(), async frame(t, i) }
// The page never reads the wall clock; every frame is a pure function of t, so the output is
// deterministic and a slow frame cannot cause a dropped frame.
//
// Usage (run from the piece project, which holds playwright and sharp in its node_modules):
//   node render-frames.mjs <page.html> --stills 0,1.5,3 [--sheet] [--props props.json]
//   node render-frames.mjs <page.html> [--out clip.mp4] [--scale 1] [--crf N] [--workers 4]
//   node render-frames.mjs <page.html> --alpha          (transparent VP9 WebM, clip.webm)
// Options: --root <dir>   folder the page is served from and resolved against (default: cwd)
//          --out-root <dir>  where run folders go (default: ./out)
//          --query "a=1&b=2" URL parameters for the page    --cols N  --thumb PX
//          --software-gl     SwiftShader software rendering (a machine with no graphics card)
// CHROME overrides the Chromium executable; the default is Playwright's own Chromium.
// --props: a JSON file whose textBlocks list ([{id,x,y,w,h}]) is cropped from every still, full size.
//
// Output policy: out/render-frames-<YYYYMMDD-HHMMSS>/ holds everything of one run; the run
// refuses when the folder exists; an explicit --out refuses when the file exists; ffmpeg runs
// with -n; the timing log out/render-log.tsv is appended to.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadFromPiece } from './lib/piece.mjs';
import { appendTimingLog, createRunFolder, exitWith, parseArgs, refuseIfExists } from './lib/runfolder.mjs';
import { startFfmpegPipe, fileSize } from './lib/ffmpeg.mjs';
import { plan, afterEncode } from './lib/encode.mjs';
import { cropTextBlocks } from './lib/crops.mjs';
import { makeSheet } from './lib/sheet.mjs';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2), ['sheet', 'alpha', 'software-gl']);
  const pagePath = positional[0];
  if (!pagePath) throw new Error('usage: node render-frames.mjs <page.html> --stills t1,t2 | [--out clip.mp4]');
  const ROOT = path.resolve(opts.root || process.cwd());
  const pageFile = path.resolve(ROOT, pagePath);
  if (!fs.existsSync(pageFile)) throw new Error(`no such page: ${pageFile}`);
  const outRoot = path.resolve(opts['out-root'] || 'out');
  const props = opts.props ? JSON.parse(fs.readFileSync(opts.props, 'utf8')) : {};
  const textBlocks = props.textBlocks || [];
  const alpha = !!opts.alpha;
  const scale = Number(opts.scale || 1);
  const stills = opts.stills ? String(opts.stills).split(',').map(Number) : null;
  if (stills && stills.some((t) => !Number.isFinite(t))) throw new Error('--stills takes comma-separated seconds, e.g. 0,1.5,3');

  if (opts.workers !== undefined && !/^[1-9]\d*$/.test(String(opts.workers))) {
    throw new Error(`--workers takes a whole number above 0, got "${opts.workers}"`);
  }

  // Refuse before any browser starts.
  const explicitOut = opts.out ? path.resolve(opts.out) : null;
  if (explicitOut) refuseIfExists(explicitOut);
  const runDir = createRunFolder('render-frames', outRoot);

  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const inside = p === ROOT || p.startsWith(ROOT + path.sep);
    if (!inside || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const rel = path.relative(ROOT, pageFile).split(path.sep).join('/');
  const url = `http://127.0.0.1:${server.address().port}/${rel}${opts.query ? '?' + opts.query : ''}`;

  const pw = await loadFromPiece('playwright');
  const { chromium } = pw;
  const launchArgs = ['--hide-scrollbars'];
  if (opts['software-gl']) launchArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const launch = () => chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: launchArgs });
  const browsers = [await launch()];

  async function openPage(own = false) {
    const br = own ? await launch() : browsers[0];
    if (own) browsers.push(br);
    const page = await br.newPage({ deviceScaleFactor: scale });
    page.on('console', (m) => { if (!/favicon|404/.test(m.text())) console.log('[page]', m.text()); });
    page.on('pageerror', (e) => { console.error('[page error]', e); process.exitCode = 1; });
    await page.goto(url);
    await page.waitForFunction(() => window.piece);
    const meta = await page.evaluate(async () => {
      const p = window.piece;
      await document.fonts.ready;
      if (p.setup) await p.setup();
      await document.fonts.ready;
      return { width: p.width, height: p.height, fps: p.fps, duration: p.duration };
    });
    await page.setViewportSize({ width: meta.width, height: meta.height });
    return { page, meta };
  }

  try {
    const { page, meta } = await openPage();
    const frameOn = (pg, t, i) => pg.evaluate(([tt, ii]) => window.piece.frame(tt, ii), [t, i]);
    const t0 = Date.now();

    if (stills) {
      const files = [];
      for (const [k, t] of stills.entries()) {
        await frameOn(page, t, Math.round(t * meta.fps));
        // The index keeps names unique when times round alike or repeat; nothing is overwritten.
        const label = `${String(k).padStart(2, '0')}-t${t.toFixed(2).padStart(6, '0')}`;
        const file = path.join(runDir, `${label}.png`);
        fs.writeFileSync(file, await page.screenshot({ type: 'png', omitBackground: alpha }), { flag: 'wx' });
        files.push(file);
        if (textBlocks.length) await cropTextBlocks(file, textBlocks, runDir, label);
      }
      if (opts.sheet) {
        const { out } = await makeSheet(files, stills, path.join(runDir, 'sheet.png'),
          { cols: Number(opts.cols || 3), thumb: Number(opts.thumb || 640) });
        console.log('sheet ->', out);
      }
      const secs = (Date.now() - t0) / 1000;
      console.log(`stills: ${stills.length} in ${secs.toFixed(1)}s -> ${runDir}`);
      appendTimingLog(outRoot, [rel, `${meta.width}x${meta.height}`, meta.fps, `stills:${stills.length}`, secs.toFixed(1), '']);
    } else {
      const target = alpha ? 'webm-alpha' : 'h264';
      if (explicitOut && explicitOut.endsWith('.webm') && !alpha) {
        throw new Error('a .webm output is the transparent overlay preset; add --alpha');
      }
      const out = explicitOut || path.join(runDir, alpha ? 'clip.webm' : 'clip.mp4');
      const n = Math.round(meta.duration * meta.fps);
      const W = Math.round((meta.width * scale) / 2) * 2;
      const H = Math.round((meta.height * scale) / 2) * 2;
      const crf = opts.crf ? Number(opts.crf) : undefined;
      const enc = plan(target, meta.duration, { crf });
      const effectiveCrf = Number(enc[enc.indexOf('-crf') + 1]);
      const { stdin, done } = startFfmpegPipe(['-f', 'image2pipe', '-c:v', alpha ? 'png' : 'mjpeg',
        '-framerate', String(meta.fps), '-i', '-',
        '-vf', `scale=${W}:${H}`, ...enc, out]);
      stdin.on('error', () => {}); // ffmpeg's own failure is reported by `done`
      done.catch(() => {}); // keep an early ffmpeg failure from being an unhandled rejection; it is rethrown at `await done`
      // Frames are pure functions of t, so N pages render interleaved frames in parallel;
      // results are flushed to ffmpeg strictly in order.
      const nw = Number(opts.workers || 4);
      const pages = [page, ...(await Promise.all(Array.from({ length: nw - 1 }, () => openPage(true).then((o) => o.page))))];
      const shoot = (pg) => pg.screenshot(alpha ? { type: 'png', omitBackground: true } : { type: 'jpeg', quality: 95 });
      const ready = new Map();
      let next = 0;
      let capMs = 0;
      const flush = async () => {
        while (ready.has(next)) {
          const buf = ready.get(next);
          ready.delete(next);
          if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
          if (next % 60 === 0) process.stdout.write(`\rframe ${next}/${n}`);
          next++;
        }
      };
      await Promise.all(pages.map(async (pg, w) => {
        for (let i = w; i < n; i += nw) {
          while (i - next > nw * 8) await new Promise((r) => setTimeout(r, 5)); // bound memory
          await frameOn(pg, i / meta.fps, i);
          const c0 = Date.now();
          ready.set(i, await shoot(pg));
          capMs += Date.now() - c0;
          await flush();
        }
      }));
      await flush();
      stdin.end();
      await done;
      const secs = (Date.now() - t0) / 1000;
      const size = fileSize(out);
      console.log(`\r${n} frames ${W}x${H}@${meta.fps} in ${secs.toFixed(1)}s (${(n / secs).toFixed(1)} fps, ${nw} workers, ` +
        `capture ${(capMs / n).toFixed(0)} ms/frame) -> ${out} ${(size / 1e6).toFixed(2)} MB`);
      const again = afterEncode(target, effectiveCrf, size);
      if (again) {
        console.log(`note: this file is over 10 MB at CRF ${effectiveCrf}. Run encode.mjs on it with --target h264 for the second pass at CRF 23.`);
      }
      appendTimingLog(outRoot, [rel, `${W}x${H}`, meta.fps, n, secs.toFixed(1), (size / 1e6).toFixed(2)]);
    }
  } finally {
    await Promise.all(browsers.map((b) => b.close()));
    server.close();
  }
}

main().catch(exitWith).finally(() => process.exit()); // the page server must not keep a failed run alive
