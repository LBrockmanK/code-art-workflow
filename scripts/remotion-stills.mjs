#!/usr/bin/env node
// Fast Remotion stills for the critique loop: bundle once, open one browser, render one still
// per time through it, tile a contact sheet, and cut full-size crops of every text block.
//   node remotion-stills.mjs <entry.jsx> <CompositionId> --times 0,1.5,3 [--props props.json]
//        [--out-root out] [--cols 3] [--thumb 640] [--gl swangle]
// Run from the piece project (it holds remotion, @remotion/bundler, @remotion/renderer and sharp).
// The props file carries the editable text and a textBlocks list [{ id, x, y, w, h }] (pixels of
// the full frame); each box is cut from the full still at every time with sharp.
// Browser: Remotion's own headless shell, downloaded on first use; CHROME_SHELL overrides it.
// GL: the hardware path by default; --gl swangle (or --software-gl) selects software rendering
// for a machine with no graphics card.
// Output: out/remotion-stills-<YYYYMMDD-HHMMSS>/ holds NN.png, sheet.png, sheet.txt and the crops.
// The run refuses when that folder exists. Nothing is deleted.
import fs from 'node:fs';
import path from 'node:path';
import { loadFromPiece } from './lib/piece.mjs';
import { createRunFolder, exitWith, parseArgs } from './lib/runfolder.mjs';
import { cropTextBlocks } from './lib/crops.mjs';
import { makeSheet } from './lib/sheet.mjs';

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2), ['software-gl']);
  const [entry, id] = positional;
  if (!entry || !id || !opts.times) throw new Error('usage: node remotion-stills.mjs <entry.jsx> <CompositionId> --times t1,t2 [--props file.json]');
  const times = String(opts.times).split(',').map(Number);
  if (times.some((t) => !Number.isFinite(t))) throw new Error('--times takes comma-separated seconds, e.g. 0,1.5,3');
  const inputProps = opts.props ? JSON.parse(fs.readFileSync(opts.props, 'utf8')) : {};
  const textBlocks = inputProps.textBlocks || [];
  const gl = opts['software-gl'] || opts.gl === 'swangle' ? 'swangle' : undefined;
  const runDir = createRunFolder('remotion-stills', opts['out-root'] || path.resolve('out'));

  const { bundle } = await loadFromPiece('@remotion/bundler');
  const { openBrowser, selectComposition, renderStill } = await loadFromPiece('@remotion/renderer');
  const t0 = Date.now();
  const serveUrl = await bundle({ entryPoint: path.resolve(entry) });
  const t1 = Date.now();
  const browser = await openBrowser('chrome', {
    ...(process.env.CHROME_SHELL ? { browserExecutable: process.env.CHROME_SHELL } : {}),
    chromiumOptions: gl ? { gl } : {},
  });
  const files = [];
  try {
    const composition = await selectComposition({ serveUrl, id, inputProps, puppeteerInstance: browser });
    for (const [i, t] of times.entries()) {
      const output = path.join(runDir, `${String(i).padStart(2, '0')}.png`);
      await renderStill({ composition, serveUrl, output, frame: Math.round(t * composition.fps), inputProps, puppeteerInstance: browser });
      files.push(output);
      if (textBlocks.length) await cropTextBlocks(output, textBlocks, runDir, `${String(i).padStart(2, '0')}-t${t.toFixed(2).padStart(6, '0')}`);
    }
  } finally {
    await browser.close({ silent: true });
  }
  const t2 = Date.now();
  const { out } = await makeSheet(files, times, path.join(runDir, 'sheet.png'),
    { cols: Number(opts.cols || 3), thumb: Number(opts.thumb || 640) });
  console.log(`bundle ${((t1 - t0) / 1000).toFixed(1)} s, ${files.length} stills ${((t2 - t1) / 1000).toFixed(1)} s ` +
    `(${((t2 - t1) / files.length / 1000).toFixed(2)} s each incl. browser start) -> ${out}`);
  console.log('run folder:', runDir);
}

main().catch(exitWith).finally(() => process.exit());
