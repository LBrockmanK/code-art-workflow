import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.mjs';
import { cropTextBlocks, validateTextBlocks } from '../../scripts/lib/crops.mjs';
import { rmse } from '../../scripts/lib/rmse.mjs';
import { loadFromPiece } from '../../scripts/lib/piece.mjs';

test('a still with two declared textBlocks yields two PNGs of the declared sizes', async () => {
  const sharp = await loadFromPiece('sharp');
  const dir = tmpDir();
  const still = path.join(dir, 'still.png');
  await sharp({ create: { width: 200, height: 100, channels: 3, background: '#223344' } }).png().toFile(still);
  const files = await cropTextBlocks(still, [
    { id: 'title', x: 10, y: 5, w: 120, h: 30 },
    { id: 'caption', x: 20, y: 60, w: 64, h: 20 },
  ], dir, 't01.50');
  assert.equal(files.length, 2);
  const [a, b] = await Promise.all(files.map((f) => sharp(f).metadata()));
  assert.deepEqual([a.width, a.height], [120, 30]);
  assert.deepEqual([b.width, b.height], [64, 20]);
  assert.ok(files.every((f) => fs.existsSync(f)));
  assert.equal(path.basename(files[0]), 't01.50-title.png');
});

test('textBlocks reject unsafe ids and bad boxes', () => {
  assert.throws(() => validateTextBlocks([{ id: '../x', x: 0, y: 0, w: 1, h: 1 }]), /letters, digits/);
  assert.throws(() => validateTextBlocks([{ id: 'a', x: 0, y: 0, w: 0, h: 1 }]), /above 0/);
  assert.throws(() => validateTextBlocks('nope'), /list/);
});

test('identical buffers score 0', () => {
  assert.equal(rmse(Buffer.from([1, 2, 3, 250]), Buffer.from([1, 2, 3, 250])), 0);
});

test('a known-difference buffer scores the expected RMSE', () => {
  assert.equal(rmse(Buffer.from([0, 0, 0, 0]), Buffer.from([255, 255, 255, 255])), 1);
  assert.equal(rmse(Buffer.from([0, 0, 0, 0]), Buffer.from([255, 0, 0, 0])), 0.5);
  assert.throws(() => rmse(Buffer.from([0]), Buffer.from([0, 0])), /differ in length/);
});
