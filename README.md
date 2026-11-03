# code-art-workflow

A Claude Code plugin for making short videos and vector drawings by having an AI write code, for
tabletop, apps and games. It holds two skills and the shared tools they use.

- `code-art-workflow:code-video` takes a short video from a shot list to a checked, encoded clip. A piece starts as a Remotion project; Canvas and Three.js scenes are plain modules that also run under the plain-browser renderer in this plugin.
- `code-art-workflow:code-svg` takes a vector drawing from a chosen style to a delivered SVG by a small generator script, with all display text outlined to paths and a parity check across three renderers.

The plugin ships no templates: no starter project, no sample piece, no token builder. The files under `tests/` are test fixtures, not starters.

## Prerequisites

- Node 24 and Python 3.
- `ffmpeg` and `ffprobe` (the GPL build of the 8.1 release line, with libx264 and libvpx) and `resvg` on PATH. The fleet plugin installs these from GitHub releases when it is installed; otherwise download them yourself.
- Python packages for the helpers: `fonttools` and `pillow`.
- Optional: `potrace` (1.16) on PATH, only for the trace route of the SVG skill. The helper says so plainly when it is absent. potrace is called, never bundled.
- Each piece project installs the npm packages the Node tools resolve from it (the tools hold no `node_modules`): `remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer` (all at 4.0.540), `playwright` and `sharp`. Playwright's Chromium comes from `npx playwright install chromium` run in the piece.
- Figure steps use `fleet:codex-imagegen` where the fleet plugin is installed (a soft dependency). Without fleet, a piece supplies its figures another way.

## Remotion licence condition

Remotion is free for individuals, for-profit companies of up to three employees, and non-profits; any other company needs a company licence. Check this before commercial use. The plugin pins Remotion 4.0.540.

## Tools

All tools live in `scripts/`. The Node tools resolve `sharp`, `playwright` and the Remotion packages from the piece project they run in (set `CODE_ART_PIECE` to name another project folder).

| Tool | What it does |
|---|---|
| `render-frames.mjs` | Frame-accurate renderer for plain-browser pieces: stills, a contact sheet, full-size crops of text blocks, and H.264 or transparent WebM clips. `--software-gl` selects software rendering for a machine with no graphics card. |
| `remotion-stills.mjs` | Fast Remotion stills (one bundle, one browser), a contact sheet and text-block crops. `--gl swangle` is the no-graphics-card fallback. |
| `encode.mjs` | Encode presets and the size rule: H.264 at CRF 20 up to 21 seconds and CRF 23 past that; a second pass at CRF 23 when the first file exceeds 10 MB; transparent VP9 WebM for overlays. No audio in version 1. |
| `check-clip.mjs` | Checks of an encoded clip: a contact sheet, the loop check (a pass or fail verdict from PSNR), and the banding check for dark scenes. |
| `svg-parity.mjs` | Renders SVGs through resvg, librsvg (via sharp) and Chromium, writes a three-up sheet and the root-mean-square difference per pair. |
| `oklch.py` | oklch to sRGB hex with a gamut clamp, and WCAG contrast. |
| `textmetrics.py` | Glyph metrics and text outlined to one SVG path, from the shipped fonts. |
| `trace_token.py` | Crop, Otsu threshold and potrace trace of one token, with a framing sheet at the use size. |

Text blocks: a piece's props object carries `textBlocks: [{ id, x, y, w, h }]` (boxes in pixels of the full frame) beside its editable text. Pass the props file with `--props`; each box is cut from the full still at every time.

## Output policy

Every tool writes into a fresh folder named for the tool and the run's local time to the second, `out/<tool>-<YYYYMMDD-HHMMSS>/`, and refuses to start when that folder already exists. No tool deletes or empties a folder or file. Every ffmpeg call carries `-n` (never overwrite). The frame renderer's timing log, `out/render-log.tsv`, is appended to, never rewritten. A tool given an explicit output path refuses when the path exists. The second encode pass writes a second file with the suffix `-crf23` and keeps the first.

## Fonts

`fonts/<family>/` holds the open-licence TTF files both proof-of-concept runs used, each with its own `OFL.txt` (SIL Open Font License 1.1): Cinzel, IM Fell English, Inter, Lora, MedievalSharp, Orbitron, Oswald, Pirata One, Rajdhani, Rye, Share Tech Mono, Source Serif 4 and UnifrakturMaguntia. A Remotion piece copies the TTF it uses into its own `public/fonts` folder and declares it in CSS.

## Tests

```
npm ci --prefix tests/node
node --test "tests/node/*.test.mjs"
python -m pip install pytest fonttools pillow
python -m pytest tests/python -q
```

The Node tests need `ffmpeg`, `ffprobe` and `resvg` on PATH and Playwright's Chromium (`npx --prefix tests/node playwright install chromium`).

## Licence

MIT. See `LICENSE`. The fonts keep their own licences (`fonts/<family>/OFL.txt`).
