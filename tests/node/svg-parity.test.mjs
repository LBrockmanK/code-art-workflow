import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, runScript, here } from './helpers.mjs';

// The fixture is shapes only (no text), so the three renderers should agree closely.
const SVG = path.join(here, 'fixtures', 'shapes.svg');

test('a linked image beside the SVG loads in all three renderers (the composite route)', async () => {
  const { default: sharp } = await import('sharp');
  const dir = tmpDir();
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c03020' } }).png().toFile(path.join(dir, 'fig.png'));
  fs.writeFileSync(path.join(dir, 'linked.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/>' +
    '<image href="fig.png" x="10" y="10" width="80" height="80"/></svg>');
  const out = path.join(dir, 'out');
  const r = await runScript('svg-parity.mjs', [path.join(dir, 'linked.svg'), '--width', '200', '--out-root', out]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [run] = fs.readdirSync(out);
  const cols = fs.readFileSync(path.join(out, run, 'scores.tsv'), 'utf8').trim().split('\n')[1].split('\t');
  assert.ok(Number(cols[1]) < 0.08, `resvg vs librsvg ${cols[1]}`);
  assert.ok(Number(cols[2]) < 0.08, `resvg vs chromium ${cols[2]}`);
});

test('the parity tool renders one fixture SVG through resvg, librsvg (sharp) and Chromium', async () => {
  const out = path.join(tmpDir(), 'out');
  const r = await runScript('svg-parity.mjs', [SVG, '--width', '300', '--out-root', out]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [run] = fs.readdirSync(out);
  assert.match(run, /^svg-parity-\d{8}-\d{6}$/);
  const files = fs.readdirSync(path.join(out, run));
  for (const f of ['shapes.resvg.png', 'shapes.librsvg.png', 'shapes.chromium.png', 'shapes.sheet.png', 'scores.tsv']) {
    assert.ok(files.includes(f), `${f} missing from ${files}`);
  }
  const scores = fs.readFileSync(path.join(out, run, 'scores.tsv'), 'utf8').trim().split('\n');
  assert.equal(scores.length, 2); // header and one piece
  const cols = scores[1].split('\t');
  const [resvgVsLibrsvg, resvgVsChromium] = [Number(cols[1]), Number(cols[2])];
  assert.ok(resvgVsLibrsvg >= 0 && resvgVsLibrsvg < 0.08, `resvg vs librsvg ${resvgVsLibrsvg}`);
  assert.ok(resvgVsChromium >= 0 && resvgVsChromium < 0.08, `resvg vs chromium ${resvgVsChromium}`);
});
