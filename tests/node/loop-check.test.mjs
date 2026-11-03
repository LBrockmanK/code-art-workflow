import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpDir, writeClip, blockFrame, scripts } from './helpers.mjs';
import { loopCheck, bandingCheck, contactSheet, loopVerdict, parsePsnr } from '../../scripts/lib/clipcheck.mjs';
import fs from 'node:fs';

const W = 96;
const H = 48;
const STEP = 8; // 12 steps across the width
const BW = 24; // block width 3 steps: one step overlaps, half the width does not

const movingFrames = () => Array.from({ length: 12 }, (_, k) => blockFrame(W, H, k * STEP, BW, 24));

test('loop verdict rule: seam at least the lowest adjacent pair minus 3 dB', () => {
  assert.equal(loopVerdict(30, [33, 34, 40]).verdict, 'pass'); // 30 >= 33 - 3
  assert.equal(loopVerdict(29.9, [33, 34, 40]).verdict, 'fail');
});

test('PSNR parsing caps infinite values at 100 dB', () => {
  assert.equal(parsePsnr('PSNR y:inf u:inf v:inf average:inf min:inf max:inf'), 100);
  assert.equal(parsePsnr('PSNR y:1 u:1 v:1 average:41.250000 min:1 max:1'), 41.25);
  assert.equal(parsePsnr('PSNR average:120.5'), 100);
});

test('a still clip passes with every PSNR capped at 100', async () => {
  const dir = tmpDir();
  const clip = await writeClip(path.join(dir, 'still.mp4'), Array(12).fill(blockFrame(W, H, 0, BW, 24)), W, H);
  const r = await loopCheck(clip, dir);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.seam, 100);
  assert.equal(r.pairs.length, 8);
  assert.ok(r.pairs.every((p) => p === 100));
});

test('a moving clip that returns to the start passes (the seam equals one adjacent step)', async () => {
  const dir = tmpDir();
  const clip = await writeClip(path.join(dir, 'moving.mp4'), movingFrames(), W, H);
  const r = await loopCheck(clip, dir);
  assert.equal(r.verdict, 'pass', JSON.stringify(r));
  assert.ok(r.seam < 100);
});

test('the same clip with the last frame replaced by the first frame shifted half the width fails', async () => {
  const dir = tmpDir();
  const frames = movingFrames();
  frames[11] = blockFrame(W, H, W / 2, BW, 24);
  const clip = await writeClip(path.join(dir, 'broken.mp4'), frames, W, H);
  const r = await loopCheck(clip, dir);
  assert.equal(r.verdict, 'fail', JSON.stringify(r));
});

test('the banding check writes the four-times sheet for a dark gradient', async () => {
  const dir = tmpDir();
  const frame = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.round((x / (W - 1)) * 30);
    const o = (y * W + x) * 3;
    frame[o] = frame[o + 1] = frame[o + 2] = v;
  }
  const clip = await writeClip(path.join(dir, 'dark.mp4'), Array(12).fill(frame), W, H);
  const out = await bandingCheck(clip, dir);
  assert.equal(path.basename(out), 'banding-4x-sheet.png');
  assert.ok(fs.statSync(out).size > 100);
});

test('the contact sheet of an encoded clip is written', async () => {
  const dir = tmpDir();
  const clip = await writeClip(path.join(dir, 'moving.mp4'), movingFrames(), W, H);
  const out = await contactSheet(clip, dir);
  assert.equal(path.basename(out), 'contact-sheet.png');
  assert.ok(fs.statSync(out).size > 100);
  assert.ok(scripts);
});
