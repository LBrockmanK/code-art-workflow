import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, runScript, here } from './helpers.mjs';

// The fixture is shapes only (no text), so the three renderers should agree closely.
const SVG = path.join(here, 'fixtures', 'shapes.svg');

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
