// Encode presets and the size rule. Version 1 carries no audio: every list ends with -an
// and no AAC argument appears anywhere.
//   H.264 for viewing: CRF 20 up to 21 seconds, CRF 23 past that.
//   Transparent VP9 WebM for overlays.
//   Size rule: when the first H.264 file exceeds 10 MB and ran below CRF 23, one second pass
//   at CRF 23, written beside the first file with the suffix -crf23. Never a third pass.
import path from 'node:path';

export const SIZE_LIMIT_BYTES = 10_000_000;
export const SECOND_PASS_CRF = 23;
export const SECOND_PASS_SUFFIX = '-crf23';
export const TARGETS = ['h264', 'webm-alpha'];

export function crfFor(target, durationSeconds) {
  if (target === 'h264') return durationSeconds <= 21 ? 20 : 23;
  if (target === 'webm-alpha') return 32;
  throw new Error(`unknown encode target "${target}" (use ${TARGETS.join(' or ')})`);
}

function build(target, crf) {
  if (target === 'h264') {
    return ['-n', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
  }
  return ['-n', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1',
    '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-an'];
}

/** The ffmpeg arguments of the first pass, without the input and the output path. */
export function plan(target, durationSeconds, { crf } = {}) {
  return build(target, crf ?? crfFor(target, durationSeconds));
}

/** null, or { suffix, args }: the one second pass, taken only for a large H.264 file. */
export function afterEncode(target, crf, sizeBytes) {
  if (target !== 'h264') return null;
  if (!(sizeBytes > SIZE_LIMIT_BYTES)) return null;
  if (!(crf < SECOND_PASS_CRF)) return null;
  return { suffix: SECOND_PASS_SUFFIX, args: build(target, SECOND_PASS_CRF) };
}

/** clip.mp4 -> clip-crf23.mp4 */
export function secondPassPath(outPath) {
  const { dir, name, ext } = path.parse(outPath);
  return path.join(dir, `${name}${SECOND_PASS_SUFFIX}${ext}`);
}
