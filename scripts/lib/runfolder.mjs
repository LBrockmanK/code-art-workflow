// Output policy shared by every tool the plugin ships.
//   - every run writes into a fresh folder named for the tool and the run's local time
//     to the second: <outRoot>/<tool>-<YYYYMMDD-HHMMSS>/
//   - a run refuses to start when that folder already exists
//   - nothing is ever deleted or emptied; an explicit output path that exists is refused
//   - the timing log is appended to, never rewritten
import fs from 'node:fs';
import path from 'node:path';

export class RefusalError extends Error {}

const pad = (n) => String(n).padStart(2, '0');

/** Local time to the second, as YYYYMMDD-HHMMSS. */
export function stamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function refusal(target) {
  return `refusing to write: ${target} already exists. The tools never overwrite or delete; ` +
    'wait one second for a new run folder, or give a new output path.';
}

/** Throws RefusalError when the path exists. */
export function refuseIfExists(target) {
  if (fs.existsSync(target)) throw new RefusalError(refusal(target));
}

/** The override must be a plain token (letters, digits, - and _) so the run stays under the output folder. */
function runStamp(now) {
  const o = process.env.CODE_ART_RUN_STAMP;
  if (!o) return stamp(now);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(o)) {
    throw new RefusalError('refusing to start: CODE_ART_RUN_STAMP must be letters, digits, - and _ only (for example 20261102-090507)');
  }
  return o;
}

/**
 * Creates <outRoot>/<tool>-<stamp>/ and returns its path. The leaf folder is created
 * without `recursive`, so an existing folder is an error, never a reuse.
 * CODE_ART_RUN_STAMP fixes the stamp (a hook for tests and for replaying a run name).
 */
export function createRunFolder(tool, outRoot, { now = new Date() } = {}) {
  const dir = path.resolve(outRoot, `${tool}-${runStamp(now)}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if (err.code === 'EEXIST') throw new RefusalError(refusal(dir));
    throw err;
  }
  return dir;
}

/** Appends one tab-separated line to <outRoot>/render-log.tsv. Never rewrites the file. */
export function appendTimingLog(outRoot, fields) {
  fs.mkdirSync(outRoot, { recursive: true });
  const file = path.join(outRoot, 'render-log.tsv');
  fs.appendFileSync(file, [new Date().toISOString(), ...fields].join('\t') + '\n');
  return file;
}

/** Prints a failure and sets the exit code; the CLIs call this from their catch. */
export function exitWith(err) {
  console.error(err instanceof RefusalError ? err.message : `error: ${err.message ?? err}`);
  process.exitCode = 1;
}

/** Tiny option reader shared by the CLIs: --key value, --flag, --key=value. */
export function parseArgs(argv, flags = []) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { opts[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    if (flags.includes(key)) { opts[key] = true; continue; }
    opts[key] = argv[++i];
  }
  return { positional, opts };
}
