// Checks of an encoded clip: a contact sheet, the loop check, and the banding check.
// All three use ffmpeg only and write into the run folder they are given.
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg, probe } from './ffmpeg.mjs';

export const PSNR_CAP = 100;
export const LOOP_MARGIN_DB = 3;
export const LOOP_PAIRS = 8;

/** Reads "average:NN" from ffmpeg's psnr filter output; infinite (identical frames) and any value above 100 become 100. */
export function parsePsnr(stderr) {
  const m = /average:(inf|[\d.]+)/.exec(stderr);
  if (!m) throw new Error(`no PSNR average in ffmpeg output: ${stderr.trim().split('\n').slice(-2).join(' | ')}`);
  const v = m[1] === 'inf' ? Infinity : Number(m[1]);
  return Math.min(v, PSNR_CAP);
}

/**
 * pass when the seam PSNR (last frame against first frame) is at least the lowest adjacent-pair
 * PSNR minus 3 dB. A periodic animation's last frame precedes its first by one step, so the
 * seam must look like one ordinary frame step, not like the first frame.
 */
export function loopVerdict(seam, pairs) {
  const lowestPair = Math.min(...pairs);
  const threshold = lowestPair - LOOP_MARGIN_DB;
  return { verdict: seam >= threshold ? 'pass' : 'fail', seam, pairs, lowestPair, threshold };
}

/** Frame indices of the adjacent pairs: eight evenly spaced pairs (p, p + 1). */
export function pairStarts(frameCount) {
  if (frameCount < 10) throw new Error(`the loop check needs at least 10 frames; this clip has ${frameCount}`);
  return Array.from({ length: LOOP_PAIRS }, (_, k) => Math.floor((k * (frameCount - 1)) / LOOP_PAIRS));
}

async function psnrOf(a, b) {
  const { stderr } = await runFfmpeg(['-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-']);
  return parsePsnr(stderr);
}

export async function loopCheck(clip, runDir) {
  const { frames: n } = probe(clip);
  const starts = pairStarts(n);
  const wanted = [...new Set([0, n - 1, ...starts, ...starts.map((p) => p + 1)])].sort((x, y) => x - y);
  const framesDir = path.join(runDir, 'loop-frames');
  fs.mkdirSync(framesDir);
  const select = wanted.map((i) => `eq(n\\,${i})`).join('+');
  await runFfmpeg(['-i', clip, '-vf', `select=${select}`, '-fps_mode', 'passthrough',
    path.join(framesDir, 'f%04d.png')]);
  const fileOf = new Map(wanted.map((idx, k) => [idx, path.join(framesDir, `f${String(k + 1).padStart(4, '0')}.png`)]));
  const seam = await psnrOf(fileOf.get(n - 1), fileOf.get(0));
  const pairs = [];
  for (const p of starts) pairs.push(await psnrOf(fileOf.get(p), fileOf.get(p + 1)));
  return { ...loopVerdict(seam, pairs), frames: n, starts };
}

export function formatLoopReport(r) {
  return [
    `seam PSNR (last frame against first): ${r.seam.toFixed(2)} dB`,
    ...r.pairs.map((p, k) => `adjacent pair ${k + 1} (frames ${r.starts[k]}-${r.starts[k] + 1}): ${p.toFixed(2)} dB`),
    `threshold (lowest adjacent pair - ${LOOP_MARGIN_DB} dB): ${r.threshold.toFixed(2)} dB`,
    `loop verdict: ${r.verdict}`,
  ].join('\n');
}

/** A tiled sheet of evenly spaced frames of the encoded clip -> contact-sheet.png */
export async function contactSheet(clip, runDir, { count = 9, cols = 3, width = 480 } = {}) {
  const { duration } = probe(clip);
  const rows = Math.ceil(count / cols);
  const out = path.join(runDir, 'contact-sheet.png');
  await runFfmpeg(['-i', clip, '-vf',
    `fps=${count}/${duration},scale=${width}:-2,tile=${cols}x${rows}:padding=4`,
    '-frames:v', '1', out]);
  return out;
}

/**
 * Banding check for dark scenes: the levels are crushed four times (every level multiplied by
 * four, clipped at white), so steps invisible in the dark show as bands. -> banding-4x-sheet.png
 */
export async function bandingCheck(clip, runDir, { count = 4, cols = 2, width = 640 } = {}) {
  const { duration } = probe(clip);
  const rows = Math.ceil(count / cols);
  const out = path.join(runDir, 'banding-4x-sheet.png');
  await runFfmpeg(['-i', clip, '-vf',
    `fps=${count}/${duration},curves=all='0/0 0.25/1 1/1',scale=${width}:-2,tile=${cols}x${rows}:padding=4`,
    '-frames:v', '1', out]);
  return out;
}
