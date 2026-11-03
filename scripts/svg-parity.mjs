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

function viewBoxOf(svg) {
  const m = /viewBox="([\d.\s,-]+)"/.exec(svg);
  if (m) { const v = m[1].trim().split(/[\s,]+/).map(Number); return { w: v[2], h: v[3] }; }
  const w = /<svg[^>]*\swidth="([\d.]+)/.exec(svg);
  const h = /<svg[^>]*\sheight="([\d.]+)/.exec(svg);
  if (w && h) return { w: Number(w[1]), h: Number(h[1]) };
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
  const page = await browser.newPage({ viewport: { width, height } });
  const body = svgText.replace(/<\?xml[^>]*>/, '').replace(/<svg /, `<svg style="display:block;width:${width}px;height:${height}px" `);
  // The page is served from a virtual origin whose files are the SVG's own folder, so images linked beside the SVG load.
  const origin = 'http://svg.local';
  await page.route(`${origin}/**`, async (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === '/__page.html') return route.fulfill({ contentType: 'text/html', body: `<html><body style="margin:0;background:#fff">${body}</body></html>` });
    const file = path.join(baseDir, p);
    if (!file.startsWith(baseDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
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
  await page.close();
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
