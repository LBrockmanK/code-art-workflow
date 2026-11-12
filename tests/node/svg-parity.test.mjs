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

test('two SVG inputs with the same file name are refused before anything is rendered', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'a')); fs.mkdirSync(path.join(dir, 'b'));
  fs.copyFileSync(SVG, path.join(dir, 'a', 'piece.svg'));
  fs.copyFileSync(SVG, path.join(dir, 'b', 'piece.svg'));
  const out = path.join(dir, 'out');
  const r = await runScript('svg-parity.mjs', [path.join(dir, 'a', 'piece.svg'), path.join(dir, 'b', 'piece.svg'), '--out-root', out]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /same file name/);
  assert.ok(!fs.existsSync(out), 'no run folder is made');
});

test('valid SVG roots (single quotes, exponent numbers, a newline after the tag name) render at one size', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'odd.svg'),
    "<?xml version='1.0'?>\n<svg\n  xmlns='http://www.w3.org/2000/svg'\n  viewBox='0 0 1e2 5e1' style='background:#eee'>\n" +
    "<rect width='1e2' height='5e1' fill='#fff'/><circle cx='50' cy='25' r='1.5e1' fill='#c03020'/></svg>");
  const out = path.join(dir, 'out');
  const r = await runScript('svg-parity.mjs', [path.join(dir, 'odd.svg'), '--width', '200', '--out-root', out]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [run] = fs.readdirSync(out);
  const cols = fs.readFileSync(path.join(out, run, 'scores.tsv'), 'utf8').trim().split('\n')[1].split('\t');
  for (const c of cols.slice(1)) assert.ok(Number(c) < 0.08, `score ${c} in ${cols}`);
});

test('a script inside an SVG does not run in the Chromium render and nothing leaves the machine', async () => {
  const { default: sharp } = await import('sharp');
  const { createServer } = await import('node:http');
  let hits = 0;
  const server = createServer((req, res) => { hits++; res.writeHead(200).end('x'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'secret.env'), 'TOKEN=abc');
  fs.writeFileSync(path.join(dir, 'active.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="r" width="100" height="100" fill="#fff"/>' +
    '<image href="http://127.0.0.1:' + port + '/img.png" width="10" height="10"/>' +
    `<script>document.getElementById('r').setAttribute('fill','#ff0000');` +
    `fetch('http://127.0.0.1:${port}/leak');</script></svg>`);
  const out = path.join(dir, 'out');
  try {
    const r = await runScript('svg-parity.mjs', [path.join(dir, 'active.svg'), '--width', '100', '--out-root', out]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const [run] = fs.readdirSync(out);
    const { data } = await sharp(path.join(out, run, 'active.chromium.png')).raw().toBuffer({ resolveWithObject: true });
    const o = (50 * 100 + 50) * data.length / 10000; // a pixel in the middle
    assert.ok(data[o + 1] > 200, `the rect stayed white, got green channel ${data[o + 1]}`);
    assert.equal(hits, 0, 'no request reached the outside server');
  } finally {
    server.close();
  }
});

test('inputs whose names differ only by case are refused before anything is rendered', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'round1')); fs.mkdirSync(path.join(dir, 'final'));
  fs.copyFileSync(SVG, path.join(dir, 'round1', 'piece.svg'));
  fs.copyFileSync(SVG, path.join(dir, 'final', 'PIECE.svg'));
  const out = path.join(dir, 'out');
  const r = await runScript('svg-parity.mjs', [path.join(dir, 'round1', 'piece.svg'), path.join(dir, 'final', 'PIECE.svg'), '--out-root', out]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /same file name/);
  assert.ok(!fs.existsSync(out));
});

test('a link inside the SVG folder that points outside it is not served to Chromium', async () => {
  const { default: sharp } = await import('sharp');
  const dir = tmpDir();
  const outside = path.join(dir, 'outside'); const inner = path.join(dir, 'inner');
  fs.mkdirSync(outside); fs.mkdirSync(inner);
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).png().toFile(path.join(outside, 'secret.png'));
  fs.symlinkSync(outside, path.join(inner, 'link'), 'junction');
  fs.writeFileSync(path.join(inner, 'l.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/>' +
    '<image href="link/secret.png" x="0" y="0" width="100" height="100"/></svg>');
  const out = path.join(dir, 'out');
  const r = await runScript('svg-parity.mjs', [path.join(inner, 'l.svg'), '--width', '100', '--renderers', 'chromium', '--out-root', out]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [run] = fs.readdirSync(out);
  const { data } = await sharp(path.join(out, run, 'l.chromium.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (50 * 100 + 50) * 3;
  assert.ok(data[o + 1] > 200, `the outside image was not drawn, green channel ${data[o + 1]}`);
});
