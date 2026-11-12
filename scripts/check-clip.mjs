#!/usr/bin/env node
// Checks of an encoded clip.
//   node check-clip.mjs <clip> contact|loop|banding|all [--out-root out]
// Writes into out/check-clip-<YYYYMMDD-HHMMSS>/ (refuses when that folder exists).
//   contact  -> contact-sheet.png
//   loop     -> loop verdict (pass or fail) and its ten numbers (seam, eight pairs, threshold)
//   banding  -> banding-4x-sheet.png (levels crushed four times, for dark scenes)
import fs from 'node:fs';
import path from 'node:path';
import { createRunFolder, exitWith, parseArgs } from './lib/runfolder.mjs';
import { bandingCheck, contactSheet, formatLoopReport, loopCheck } from './lib/clipcheck.mjs';

const { positional, opts } = parseArgs(process.argv.slice(2));
const [clip, which = 'all'] = positional;
try {
  if (!clip || !['contact', 'loop', 'banding', 'all'].includes(which)) {
    throw new Error('usage: node check-clip.mjs <clip> contact|loop|banding|all [--out-root out]');
  }
  if (!fs.existsSync(clip)) throw new Error(`no such clip: ${clip}`);
  const runDir = createRunFolder('check-clip', opts['out-root'] || path.resolve('out'));
  if (which === 'contact' || which === 'all') console.log('contact sheet ->', await contactSheet(clip, runDir));
  if (which === 'banding' || which === 'all') console.log('banding sheet ->', await bandingCheck(clip, runDir));
  if (which === 'loop' || which === 'all') {
    const report = formatLoopReport(await loopCheck(clip, runDir));
    fs.writeFileSync(path.join(runDir, 'loop-report.txt'), report + '\n');
    console.log(report);
  }
  console.log('run folder:', runDir);
} catch (err) {
  exitWith(err);
}
