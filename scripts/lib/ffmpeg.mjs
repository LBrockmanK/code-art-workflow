// ffmpeg and ffprobe from PATH. Every ffmpeg call carries -n (never overwrite); ffmpeg's
// refusal to overwrite is treated as the tool's own error.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

export function runFfmpeg(args, { stdinSource } = {}) {
  const full = ['-hide_banner', '-v', 'info', ...(args.includes('-n') ? [] : ['-n']), ...args];
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', full, { stdio: [stdinSource ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => reject(new Error(`cannot start ffmpeg (is it on PATH?): ${e.message}`)));
    p.on('close', (code) => (code === 0
      ? resolve({ stderr })
      : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`))));
    if (stdinSource) stdinSource(p.stdin, p);
  });
}

/** Starts ffmpeg with a writable stdin for frame piping; returns { stdin, done }. */
export function startFfmpegPipe(args) {
  const full = ['-hide_banner', '-v', 'error', ...(args.includes('-n') ? [] : ['-n']), ...args];
  const p = spawn('ffmpeg', full, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    p.on('error', (e) => reject(new Error(`cannot start ffmpeg (is it on PATH?): ${e.message}`)));
    p.on('close', (code) => (code ? reject(new Error(`ffmpeg exited with ${code}`)) : resolve()));
  });
  return { stdin: p.stdin, done };
}

/** { duration (s), frames, fps } of the first video stream. */
export function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames,r_frame_rate,duration:format=duration',
    '-of', 'json', file], { encoding: 'utf8' });
  if (r.error) throw new Error(`cannot start ffprobe (is it on PATH?): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout);
  const s = j.streams?.[0];
  if (!s) throw new Error(`no video stream in ${file}`);
  const [num, den] = String(s.r_frame_rate).split('/').map(Number);
  const frames = Number(s.nb_read_frames);
  const fps = den ? num / den : num;
  const duration = Number(s.duration) || Number(j.format?.duration) || frames / fps;
  return { duration, frames, fps };
}

export const fileSize = (p) => fs.statSync(p).size;
