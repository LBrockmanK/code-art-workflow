// The Node tools resolve their npm packages (sharp, playwright, remotion) from the piece
// project they run in, so the plugin's installed copy holds no node_modules.
// The piece project is CODE_ART_PIECE when set, else the current directory.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function pieceDir() {
  return path.resolve(process.env.CODE_ART_PIECE || process.cwd());
}

export async function loadFromPiece(name) {
  const require = createRequire(path.join(pieceDir(), 'package.json'));
  let resolved;
  try {
    resolved = require.resolve(name);
  } catch {
    throw new Error(`cannot find the package "${name}" from ${pieceDir()}. ` +
      'Run the tool from the piece project, or install the package there (npm install).');
  }
  const mod = await import(pathToFileURL(resolved).href);
  // A CommonJS package imports as { default: module.exports }; an ES-module package has no default.
  return mod.default ?? mod;
}
