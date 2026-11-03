// Root-mean-square difference of two raw pixel buffers, normalised to 0..1
// (0 identical, 1 black against white). Plain JavaScript: no ImageMagick.
export function rmse(a, b) {
  if (a.length !== b.length) throw new Error(`buffers differ in length (${a.length} against ${b.length})`);
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] - b[i]) / 255;
    sum += d * d;
  }
  return Math.sqrt(sum / a.length);
}
