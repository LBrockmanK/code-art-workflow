// Test helpers: synthesized clips (no media files are committed) and shared paths.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const scripts = path.join(repoRoot, 'scripts');

// The tools resolve sharp and playwright from the piece project; the tests are the piece.
process.env.CODE_ART_PIECE = here;

export function tmpDir(prefix = 'code-art-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Runs a script in scripts/ as a child process; resolves { code, stdout, stderr }. */
export function runScript(script, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(scripts, script), ...args], {
      env: { ...process.env, CODE_ART_PIECE: here, ...env },
      cwd: here,
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Encodes raw RGB frames (Buffers of w*h*3) into a lossless H.264 clip at `out`. */
export function writeClip(out, frames, w, h, fps = 12) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-n', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      '-s', `${w}x${h}`, '-r', String(fps), '-i', '-', '-c:v', 'libx264', '-crf', '0',
      '-pix_fmt', 'yuv444p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (c) => (c ? reject(new Error(`ffmpeg ${c}`)) : resolve(out)));
    for (const f of frames) p.stdin.write(f);
    p.stdin.end();
  });
}

/** A black frame with a white block (bw x bh) whose left edge is at x (wraps around the width). */
export function blockFrame(w, h, x, bw, bh, y = 0) {
  const buf = Buffer.alloc(w * h * 3);
  for (let row = y; row < y + bh; row++) {
    for (let k = 0; k < bw; k++) {
      const col = (((x + k) % w) + w) % w;
      const o = (row * w + col) * 3;
      buf[o] = buf[o + 1] = buf[o + 2] = 255;
    }
  }
  return buf;
}
