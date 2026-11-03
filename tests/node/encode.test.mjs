import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, afterEncode, secondPassPath, crfFor } from '../../scripts/lib/encode.mjs';

const H264 = (crf) => ['-n', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];

test('H.264 at 10 seconds uses CRF 20', () => {
  assert.deepEqual(plan('h264', 10), H264(20));
});

test('H.264 at 30 seconds uses CRF 23', () => {
  assert.deepEqual(plan('h264', 30), H264(23));
});

test('H.264 keeps CRF 20 up to 21 seconds and moves to 23 just past it', () => {
  assert.equal(crfFor('h264', 21), 20);
  assert.equal(crfFor('h264', 21.01), 23);
});

test('transparent VP9 WebM for overlays', () => {
  assert.deepEqual(plan('webm-alpha', 5), ['-n', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32',
    '-row-mt', '1', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-an']);
});

test('every list carries -n and none carries audio arguments', () => {
  for (const args of [plan('h264', 10), plan('h264', 30), plan('webm-alpha', 5)]) {
    assert.ok(args.includes('-n'));
    assert.ok(args.includes('-an'));
    assert.ok(!args.some((a) => /aac|libopus|-c:a|-b:a/.test(a)));
  }
});

test('afterEncode returns null at 9,000,000 bytes', () => {
  assert.equal(afterEncode('h264', 20, 9_000_000), null);
});

test('afterEncode returns the CRF 23 second pass with the -crf23 suffix at 12,000,000 bytes after CRF 20', () => {
  const r = afterEncode('h264', 20, 12_000_000);
  assert.equal(r.suffix, '-crf23');
  assert.deepEqual(r.args, H264(23));
  assert.equal(secondPassPath('out/clip.mp4').replaceAll('\\', '/'), 'out/clip-crf23.mp4');
});

test('afterEncode returns null at 12,000,000 bytes after a CRF 23 pass', () => {
  assert.equal(afterEncode('h264', 23, 12_000_000), null);
});

test('afterEncode never re-encodes the WebM overlay preset', () => {
  assert.equal(afterEncode('webm-alpha', 32, 50_000_000), null);
});

test('an unknown target is an error', () => {
  assert.throws(() => plan('gif', 3), /unknown encode target/);
});
