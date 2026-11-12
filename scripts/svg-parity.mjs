#!/usr/bin/env node
// SVG renderer and three-renderer parity check.
//   node svg-parity.mjs <file.svg>... [--width 700] [--out-root out] [--fonts-dir dir]
//        [--renderers resvg,librsvg,chromium]
// Renders each SVG through resvg (the resvg command-line binary on PATH), librsvg (through the
// sharp package, whose prebuilt libvips bundles librsvg) and Chromium (Playwright), flattens each
// result on white, writes a three-up sheet and a root-mean-square difference per pair.
// Output: out/svg-parity-<YYYYMMDD-HHMMSS>/ with <name>.<renderer>.png, <name>.sheet.png and scores.tsv.
// The RMSE is normalised 0..1 (0 identical). SMIL and CSS animation run only in Chromium
// (add --time <seconds> to pause animations at that time).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadFromPiece } from './lib/piece.mjs';
import { createRunFolder, exitWith, parseArgs } from './lib/runfolder.mjs';
import { rmse } from './lib/rmse.mjs';

const FONTS_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

// The root <svg ...> tag, read with a small attribute scanner that accepts single or double
// quotes and any whitespace (a newline after the tag name included).
function rootAttributes(svg) {
  const tag = /<svg(?=[\s>/])((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(svg);
  if (!tag) throw new Error('no <svg> root element found');
  const attrs = {};
  for (const m of tag[1].matchAll(/([^\s=/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = m[2] ?? m[3];
  return attrs;
}

const NUMBER = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*(?:px)?\s*$/;

function viewBoxOf(svg) {
  const attrs = rootAttributes(svg);
  if (attrs.viewBox !== undefined) {
    const v = attrs.viewBox.trim().split(/[\s,]+/).map(Number);
    if (v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0) return { w: v[2], h: v[3] };
  }
  if (NUMBER.test(attrs.width ?? '') && NUMBER.test(attrs.height ?? '')) return { w: parseFloat(attrs.width), h: parseFloat(attrs.height) };
  throw new Error('the SVG needs a viewBox (or width and height) so the renderers can agree on a size');
}

function renderResvg(file, out, width, fontsDir) {
  const args = ['--width', String(width), '--background', 'white', '--quiet'];
  if (fs.existsSync(fontsDir)) {
    // resvg takes one folder: every family folder of the plugin's fonts is passed.
    for (const d of fs.readdirSync(fontsDir, { withFileTypes: true })) if (d.isDirectory()) args.push('--use-fonts-dir', path.join(fontsDir, d.name));
  }
  const r = spawnSync('resvg', [...args, file, out], { encoding: 'utf8' });
  if (r.error) throw new Error(`cannot start resvg (is it on PATH?): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`resvg failed on ${file}: ${r.stderr.trim()}`);
}

async function renderLibrsvg(sharp, file, out, width) {
  // A file path (not a buffer) lets librsvg resolve images linked beside the SVG.
  // density 96 maps one user unit to one pixel; resize then fixes the width.
  await sharp(path.resolve(file), { density: 96 }).resize({ width }).flatten({ background: '#ffffff' }).png().toFile(out);
}

async function renderChromium(browser, svgText, out, width, height, time, baseDir) {
  // The SVG is untrusted input: scripts are off, and only the SVG's own folder is served.
  // Nothing else is reachable: every request outside the virtual origin is aborted.
  const context = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false });
  const page = await context.newPage();
  // The size comes from a page rule (important beats any style attribute on the root), so the SVG text is not rewritten.
  const body = svgText.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?[^>]*>/i, '');
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'">` +
    `<style>body{margin:0;background:#fff}body>svg{display:block!important;width:${width}px!important;height:${height}px!important}</style></head><body>${body}</body></html>`;
  // The page is served from a virtual origin whose files are the SVG's own folder, so images linked beside the SVG load.
  const origin = 'http://svg.local';
  const root = path.resolve(baseDir);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const p = decodeURIComponent(url.pathname);
    if (p === '/__page.html') return route.fulfill({ contentType: 'text/html', body: html });
    const file = path.resolve(root, '.' + p);
    const inside = file.startsWith(root + path.sep);
    if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file) });
  });
  await page.goto(`${origin}/__page.html`);
  await page.evaluate(() => document.fonts.ready);
  if (time !== undefined) {
    await page.evaluate((t) => {
      const s = document.querySelector('svg');
      s.pauseAnimations(); s.setCurrentTime(t);
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
    }, time);
    await page.waitForTimeout(50);
  }
  await page.screenshot({ path: out });
  await context.close();
}

async function rawPixels(sharp, file) {
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (!positional.length) throw new Error('usage: node svg-parity.mjs <file.svg>... [--width 700] [--out-root out]');
  const width = Number(opts.width || 700);
  const fontsDir = path.resolve(opts['fonts-dir'] || FONTS_DEFAULT);
  const wanted = String(opts.renderers || 'resvg,librsvg,chromium').split(',');
  const time = opts.time === undefined ? undefined : Number(opts.time);
  for (const f of positional) if (!fs.existsSync(f)) throw new Error(`no such file: ${f}`);
  const names = new Map();
  for (const f of positional) {
    const n = path.basename(f, path.extname(f));
    if (names.has(n)) throw new Error(`refusing to start: ${names.get(n)} and ${f} have the same file name "${n}"; their renders would overwrite each other. Run them one at a time or rename one.`);
    names.set(n, f);
  }
  const runDir = createRunFolder('svg-parity', opts['out-root'] || path.resolve('out'));
  const sharp = await loadFromPiece('sharp');
  const browser = wanted.includes('chromium') ? await (await loadFromPiece('playwright')).chromium.launch(
    process.env.CHROME ? { executablePath: process.env.CHROME } : {}) : null;
  const rows = ['piece\tresvg-vs-librsvg\tresvg-vs-chromium\tlibrsvg-vs-chromium'];
  try {
    for (const file of positional) {
      const name = path.basename(file, path.extname(file));
      const svgText = fs.readFileSync(file, 'utf8');
      const vb = viewBoxOf(svgText);
      const height = Math.round((width * vb.h) / vb.w);
      const png = (r) => path.join(runDir, `${name}.${r}.png`);
      if (wanted.includes('resvg')) renderResvg(path.resolve(file), png('resvg'), width, fontsDir);
      if (wanted.includes('librsvg')) await renderLibrsvg(sharp, file, png('librsvg'), width);
      if (wanted.includes('chromium')) await renderChromium(browser, svgText, png('chromium'), width, height, time, path.dirname(path.resolve(file)));
      const px = {};
      for (const r of wanted) px[r] = await rawPixels(sharp, png(r));
      const score = (a, b) => {
        if (!px[a] || !px[b]) return 'n/a';
        const A = px[a]; const B = px[b];
        if (A.info.width !== B.info.width || A.info.height !== B.info.height) return 'size-mismatch';
        return rmse(A.data, B.data).toFixed(4);
      };
      const s = [score('resvg', 'librsvg'), score('resvg', 'chromium'), score('librsvg', 'chromium')];
      rows.push([name, ...s].join('\t'));
      console.log(`${name.padEnd(28)} resvg-vs-librsvg ${s[0]}  resvg-vs-chromium ${s[1]}  librsvg-vs-chromium ${s[2]}`);
      // three-up sheet, grey gutters
      const cells = wanted.map((r, i) => ({ input: png(r), left: i * (width + 6), top: 0 }));
      await sharp({ create: { width: wanted.length * width + (wanted.length - 1) * 6, height, channels: 3, background: '#888888' } })
        .composite(cells).png().toFile(path.join(runDir, `${name}.sheet.png`));
    }
  } finally {
    if (browser) await browser.close();
  }
  fs.writeFileSync(path.join(runDir, 'scores.tsv'), rows.join('\n') + '\n');
  console.log('run folder:', runDir);
}

main().catch(exitWith).finally(() => process.exit());
