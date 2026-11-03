// Full-size crops of text blocks. The piece's props object carries
//   textBlocks: [{ id, x, y, w, h }]   (a box in pixels of the full still)
// next to the editable text. One path serves React text and canvas text alike: the still is
// rendered once, and each box is cut from it with sharp's extract.
import path from 'node:path';
import { loadFromPiece } from './piece.mjs';
import { refuseIfExists } from './runfolder.mjs';

export function validateTextBlocks(textBlocks) {
  if (!Array.isArray(textBlocks)) throw new Error('props.textBlocks must be a list of { id, x, y, w, h }');
  const seen = new Set();
  for (const b of textBlocks) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(b.id))) throw new Error(`textBlocks id "${b.id}" must use letters, digits, - and _ only`);
    if (seen.has(b.id)) throw new Error(`textBlocks id "${b.id}" appears twice`);
    seen.add(b.id);
    for (const k of ['x', 'y', 'w', 'h']) {
      if (!Number.isInteger(b[k]) || b[k] < 0) throw new Error(`textBlocks "${b.id}": ${k} must be a whole number of pixels`);
    }
    if (b.w === 0 || b.h === 0) throw new Error(`textBlocks "${b.id}": w and h must be above 0`);
  }
  return textBlocks;
}

/** Cuts each block from the still; writes <label>-<id>.png into outDir; returns the paths. */
export async function cropTextBlocks(stillPath, textBlocks, outDir, label) {
  validateTextBlocks(textBlocks);
  const sharp = await loadFromPiece('sharp');
  const written = [];
  for (const b of textBlocks) {
    const out = path.join(outDir, `${label}-${b.id}.png`);
    refuseIfExists(out);
    await sharp(stillPath).extract({ left: b.x, top: b.y, width: b.w, height: b.h }).png().toFile(out);
    written.push(out);
  }
  return written;
}
