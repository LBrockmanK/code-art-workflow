// Contact sheet of stills, built with sharp: a grid of thumbnails on grey, plus a text index
// naming the time of each cell (reading order), since labels drawn into the image would need a font.
import fs from 'node:fs';
import { loadFromPiece } from './piece.mjs';
import { refuseIfExists } from './runfolder.mjs';

export async function makeSheet(files, times, out, { cols = 3, thumb = 640, gap = 6 } = {}) {
  refuseIfExists(out);
  const sharp = await loadFromPiece('sharp');
  const first = await sharp(files[0]).metadata();
  const w = thumb;
  const h = Math.round((thumb * first.height) / first.width);
  const c = Math.min(cols, files.length);
  const rows = Math.ceil(files.length / c);
  const cells = await Promise.all(files.map(async (f, i) => ({
    input: await sharp(f).resize(w, h).flatten({ background: '#808080' }).png().toBuffer(),
    left: gap + (i % c) * (w + gap),
    top: gap + Math.floor(i / c) * (h + gap),
  })));
  await sharp({ create: { width: gap + c * (w + gap), height: gap + rows * (h + gap), channels: 3, background: '#555555' } })
    .composite(cells).png().toFile(out);
  const index = out.replace(/\.png$/, '.txt');
  refuseIfExists(index);
  fs.writeFileSync(index, files.map((f, i) => `cell ${i + 1} (row ${Math.floor(i / c) + 1}, column ${(i % c) + 1}): t=${times[i]}s  ${f}`).join('\n') + '\n');
  return { out, index };
}
