# code-video reference

## Piece setup

Run from the folder that will hold the piece (`<piece>` is a new folder name):

```
npx create-video@4.0.540 --blank --yes <piece>
```

The scaffolder runs `npm install` itself. Edit `<piece>/package.json`: set `remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer` (and any other `@remotion/*`) to `4.0.540`, and add `playwright` and `sharp` as dependencies. Then, in the piece:

```
npm install
npx playwright install chromium
```

The tools resolve `remotion`, `@remotion/bundler`, `@remotion/renderer`, `playwright` and `sharp` from the piece project they run in (`CODE_ART_PIECE` names another project folder). Remotion renders with its own headless shell, downloaded on first use; the plain renderer uses Playwright's Chromium (`CHROME` overrides the executable). Both browsers are downloaded per piece.

## Tools

All in `${CLAUDE_PLUGIN_ROOT}/scripts/`; run each from the piece.

- `remotion-stills.mjs <entry.jsx> <CompositionId> --times t1,t2 [--props props.json] [--cols 3] [--thumb 640] [--gl swangle]` writes `NN.png`, `sheet.png`, `sheet.txt` (the time of each cell) and one crop PNG per text block per time into `out/remotion-stills-<stamp>/`.
- `render-frames.mjs <page.html> --stills t1,t2 [--sheet] [--props props.json]`, or without `--stills` a clip (`--alpha` for WebM, `--scale`, `--crf`, `--workers`, `--software-gl` for no graphics card). Appends one line to `out/render-log.tsv` per run (size, frames, seconds): record it as the render budget.
- `encode.mjs <input> --target h264|webm-alpha [--duration s] [--out file]`.
- `check-clip.mjs <clip> contact|loop|banding|all`.

Page contract of the plain renderer: `window.piece = { width, height, fps, duration, async setup(), frame(t, i) }`. The page never reads the wall clock.

## Canvas and Three.js scenes inside Remotion

Write the scene as a module exporting `frame(t)` (draw everything for time `t`). In Remotion, call it from a layout effect so drawing finishes before the frame is captured:

```jsx
const t = useCurrentFrame() / useVideoConfig().fps;
const ref = useRef(null);
useLayoutEffect(() => { scene.frame(t); }, [t]);
return <AbsoluteFill><canvas ref={ref} style={{ position: 'absolute', width: W, height: H }} /></AbsoluteFill>;
```

Hold the first frame with `delayRender` until fonts are loaded and the scene is built. The same module runs under `render-frames.mjs` through `window.piece.frame`.

## Static grain on dark gradients

Per-frame grain cost 6.6 MB on an 11 second clip; one static tile cost 1.4 MB and still dithers the gradient. Build the tile once with a seeded generator and draw it over the finished frame every frame:

```js
const g = document.createElement('canvas'); g.width = g.height = 256;
const gx = g.getContext('2d'), img = gx.createImageData(256, 256), rr = rng(100); // seeded
for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i+1] = img.data[i+2] = rr() * 255; img.data[i+3] = 10; }
gx.putImageData(img, 0, 0);
// at the end of frame(t):
for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(g, x, y);
```

Confirm with the banding sheet of `check-clip.mjs`.

## Figure prompts

Write the prompt in the schema `fleet:codex-imagegen` expects (Use case, Asset type, Primary request, Scene/backdrop, Subject, Style/medium, Composition/framing, Color palette, Constraints, Avoid) and leave the generation to that skill. Both routes: plain background, a stated subject fill, no frame, no text.

- Composite: a painted image; place it as an `<img>` or canvas image in the piece.
- Trace: add "pure black and white, no grey wash, no shading"; threshold and trace with `trace_token.py` (see `code-art-workflow:code-svg`).
