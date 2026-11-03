import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, writeClip, blockFrame, runScript, here } from './helpers.mjs';
import { createRunFolder, refuseIfExists, appendTimingLog, stamp, RefusalError } from '../../scripts/lib/runfolder.mjs';

const W = 96;
const H = 48;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a run folder is named for the tool and local time to the second', () => {
  assert.match(stamp(new Date(2026, 10, 2, 9, 5, 7)), /^20261102-090507$/);
  const root = tmpDir();
  const dir = createRunFolder('demo', root, { now: new Date(2026, 10, 2, 9, 5, 7) });
  assert.equal(path.basename(dir), 'demo-20261102-090507');
});

test('a run into a folder that already exists is refused and writes nothing', async () => {
  const root = tmpDir();
  const clip = await writeClip(path.join(root, 'in.mp4'), Array(12).fill(blockFrame(W, H, 0, 24, 24)), W, H);
  const env = { CODE_ART_RUN_STAMP: '20260101-000000' };
  const first = await runScript('check-clip.mjs', [clip, 'contact', '--out-root', path.join(root, 'out')], env);
  assert.equal(first.code, 0, first.stderr);
  const before = fs.readdirSync(path.join(root, 'out', 'check-clip-20260101-000000'));
  const second = await runScript('check-clip.mjs', [clip, 'contact', '--out-root', path.join(root, 'out')], env);
  assert.notEqual(second.code, 0);
  assert.match(second.stderr, /refusing to write/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'out', 'check-clip-20260101-000000')), before);
  assert.deepEqual(fs.readdirSync(path.join(root, 'out')), ['check-clip-20260101-000000']);
});

test('two runs a second apart produce two folders', async () => {
  const root = tmpDir();
  const clip = await writeClip(path.join(root, 'in.mp4'), Array(12).fill(blockFrame(W, H, 0, 24, 24)), W, H);
  const a = await runScript('check-clip.mjs', [clip, 'contact', '--out-root', path.join(root, 'out')]);
  await sleep(1100);
  const b = await runScript('check-clip.mjs', [clip, 'contact', '--out-root', path.join(root, 'out')]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(fs.readdirSync(path.join(root, 'out')).length, 2);
});

test('an explicit output path that exists is refused', () => {
  const root = tmpDir();
  const f = path.join(root, 'x.mp4');
  fs.writeFileSync(f, 'keep');
  assert.throws(() => refuseIfExists(f), RefusalError);
  assert.equal(fs.readFileSync(f, 'utf8'), 'keep');
});

test('the timing log grows by one line per run and is never rewritten', () => {
  const root = tmpDir();
  appendTimingLog(root, ['a']);
  const log = path.join(root, 'render-log.tsv');
  const first = fs.readFileSync(log, 'utf8');
  appendTimingLog(root, ['b']);
  const second = fs.readFileSync(log, 'utf8');
  assert.equal(second.split('\n').filter(Boolean).length, 2);
  assert.ok(second.startsWith(first));
});

test('the frame renderer appends one timing line per run and keeps earlier run folders', async (t) => {
  const root = tmpDir();
  const outRoot = path.join(root, 'out');
  const args = ['piece.html', '--root', path.join(here, 'fixtures'), '--stills', '0,0.5', '--out-root', outRoot];
  const a = await runScript('render-frames.mjs', args);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  await sleep(1100);
  const b = await runScript('render-frames.mjs', args);
  assert.equal(b.code, 0, b.stdout + b.stderr);
  const log = fs.readFileSync(path.join(outRoot, 'render-log.tsv'), 'utf8').split('\n').filter(Boolean);
  assert.equal(log.length, 2);
  const folders = fs.readdirSync(outRoot).filter((n) => n.startsWith('render-frames-'));
  assert.equal(folders.length, 2);
  for (const f of folders) assert.ok(fs.readdirSync(path.join(outRoot, f)).some((n) => n.endsWith('.png')));
  t.diagnostic(log.join(' / '));
});
