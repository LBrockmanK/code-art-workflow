#!/usr/bin/env node
// Encode a clip with the plugin's presets and the size rule.
//   node encode.mjs <input> --target h264|webm-alpha [--duration seconds] [--out file] [--out-root out]
// First pass: H.264 for viewing (CRF 20 up to 21 seconds, CRF 23 past that) or transparent VP9 WebM
// for overlays; no audio stream (version 1 carries no audio). When the H.264 file exceeds 10 MB and
// ran below CRF 23, one second pass at CRF 23 writes <name>-crf23.mp4 beside it. Both files are kept
// and both sizes are printed. Never a third pass.
// Output: out/encode-<YYYYMMDD-HHMMSS>/<input name>.mp4|.webm, or --out (refused when it exists).
import fs from 'node:fs';
import path from 'node:path';
import { createRunFolder, exitWith, parseArgs, refuseIfExists } from './lib/runfolder.mjs';
import { fileSize, probe, runFfmpeg } from './lib/ffmpeg.mjs';
import { afterEncode, crfFor, plan, secondPassPath, TARGETS } from './lib/encode.mjs';

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const input = positional[0];
  const target = opts.target || 'h264';
  if (!input || !TARGETS.includes(target)) throw new Error(`usage: node encode.mjs <input> --target ${TARGETS.join('|')} [--duration s] [--out file]`);
  if (!fs.existsSync(input)) throw new Error(`no such input: ${input}`);
  const duration = opts.duration ? Number(opts.duration) : probe(input).duration;
  const ext = target === 'h264' ? '.mp4' : '.webm';
  let out;
  if (opts.out) {
    out = path.resolve(opts.out);
    refuseIfExists(out);
    if (target === 'h264') refuseIfExists(secondPassPath(out)); // fail before the first pass, not after it
  } else {
    out = path.join(createRunFolder('encode', opts['out-root'] || path.resolve('out')), path.basename(input, path.extname(input)) + ext);
  }
  const crf = crfFor(target, duration);
  await runFfmpeg(['-i', input, ...plan(target, duration), out]);
  const size = fileSize(out);
  console.log(`first pass: CRF ${crf}, ${size} bytes (${(size / 1e6).toFixed(2)} MB) -> ${out}`);
  const again = afterEncode(target, crf, size);
  if (again) {
    const out2 = secondPassPath(out);
    await runFfmpeg(['-i', input, ...again.args, out2]);
    const size2 = fileSize(out2);
    console.log(`second pass: CRF 23, ${size2} bytes (${(size2 / 1e6).toFixed(2)} MB) -> ${out2} (the first file is kept)`);
  }
}

main().catch(exitWith);
