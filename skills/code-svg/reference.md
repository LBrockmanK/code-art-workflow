# code-svg reference

## Tools

All in `${CLAUDE_PLUGIN_ROOT}/scripts/`; run the Node tools from the piece folder (they resolve `sharp` and `playwright` from it; `CODE_ART_PIECE` names another project).

- `svg-parity.mjs <file.svg>... [--width 700] [--renderers resvg,librsvg,chromium] [--time s]` writes `<name>.<renderer>.png`, `<name>.sheet.png` (three-up) and `scores.tsv` into `out/svg-parity-<stamp>/`. The SVG needs a `viewBox`.
- `oklch.py <oklch(L% C h) or #hex> [#background]`; as a module: `parse`, `oklch_hex`, `hex_to_oklch`, `contrast`.
- `textmetrics.py "Text" 96 --font "Lora[wght].ttf" --wght 600 [--x --y --spacing --anchor]` prints the path, start x and width; as a module: `text_path(text, size, x, y, file, wght, spacing, anchor=...)`, `advances`, `glyph_box`.
- `trace_token.py image.png [--crop x,y,w,h] [--threshold N] [--use-size WxH] [--out-root out]` writes `token.png`, `mask.png`, and with potrace present `trace.svg` and `framing.png`.

## Composition tricks that paid off

- `gradientUnits="userSpaceOnUse"` for effects that fade along a length.
- Masks for lighting; a stroke underlay for clean outlines of multi-part shapes.
- `<symbol>` and `<use>` for mirrored and reusable parts.
- Silhouette with carved highlight lines where a face fails.
- librsvg ignores per-glyph `dx` lists; outline text rather than relying on them.

## Figure prompt shape

Write the prompt in the schema `fleet:codex-imagegen` expects and leave the generation to it. Fill every slot; name the medium, palette and composition.

Trace route example: Use case `illustration-story`; Asset type `woodcut portrait token source, 1024x1024`; Primary request `a bearded innkeeper in profile`; Scene/backdrop `plain white`; Style/medium `woodcut, pure black ink only`; Composition/framing `subject fills 80% of the frame, centred`; Constraints `pure black and white, no grey wash, no shading, no frame, no text`.

Composite route example: same slots with `painted portrait, muted oils`, plain mid-grey background, and Constraints `no frame, no text, no border`.
