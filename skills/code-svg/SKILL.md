---
name: code-svg
description: "Use when a vector drawing (icon set, handout, card, map, title card, token frame, diagram, brand study) is to be made by writing a generator script that emits SVG, checked by a render every round and a parity check."
---

# Code SVG

Make a vector drawing by writing a small script that emits SVG, rendering it, looking at it, and fixing named defects. It is good enough for anything geometric, typographic, diagrammatic or flat-plus-gradient. Figurative drawing (faces, animals, vehicles) tops out at a flat cartoon: do not draw it, generate it (step 6).

`${CLAUDE_PLUGIN_ROOT}` below is this plugin's folder. Commands and details are in [reference.md](reference.md).

## Setup

1. Prerequisites: Node 24, `resvg` on PATH, Python 3 with `fonttools` and `pillow`, and a piece folder with `sharp` and `playwright` installed (`npm install sharp playwright` and `npx playwright install chromium`). `potrace` is optional, only for the trace route of step 6.
2. Output policy (binding on every tool of this plugin): each tool run writes into a fresh folder `out/<tool>-<YYYYMMDD-HHMMSS>/` and refuses to start when that folder exists. No tool deletes or empties a file or folder, and a tool given an explicit output path refuses when the path exists. Do not delete an old run to get past a refusal; wait one second or give a new path.
3. Remotion is not used here. If the drawing is later animated as video, use `code-art-workflow:code-video`, which states the Remotion licence condition (free for individuals, evaluation and companies of up to three employees; a paid licence for any larger company before commercial use).

## Steps

1. Pick a style SVG can carry before drawing: silhouette, line, flat-plus-gradient or typographic. Decide this before round 1, not after round 3.
2. Write a small generator script (`piece.py` writes `piece.svg`): hand-placed structure, seeded randomness for repeated marks (stars, stones, glitter), and a shared palette and type helper. Palette: `python ${CLAUDE_PLUGIN_ROOT}/scripts/oklch.py "oklch(70% 0.12 200)" "#101018"` gives the hex (resvg and librsvg do not parse `oklch()`) and the WCAG contrast. Type: outline all display text to paths with `${CLAUDE_PLUGIN_ROOT}/scripts/textmetrics.py` (`text_path()`; glyph boxes place marks relative to letters), which reads the fonts shipped in `${CLAUDE_PLUGIN_ROOT}/fonts/`. Outlined text renders identically everywhere.
3. Render and look, every round, at real use size (a 60 px icon, a 70 px token, a phone frame): `node ${CLAUDE_PLUGIN_ROOT}/scripts/svg-parity.mjs piece.svg --width <use width>` writes each renderer's PNG; read one and crop into detail areas. Write down one or two concrete defects and fix only those. Keep the first-round render (`r1`) for step 8.
4. Expect 2 to 5 rounds. Stop when the remaining defects are about drawing skill (the placement of many control points to describe an organic form), not layout. More rounds will not cross that ceiling.
5. Optional tool: vex (MIT, vector assets as code) may be brought in for a piece; nothing here depends on it.
6. Figures. Do not draw a figurative element. Generate it with `fleet:codex-imagegen`, with a prompt written in that skill's schema for one of two routes, composite by default and trace where real vectors are needed (plotter or cutter paths, large prints, runtime recolouring). Start from a reference image, compose in code, check at use size. Both routes: plain background, a stated subject fill, no frame, no text.
   - Composite route (default): a painted image, saved beside the SVG and linked as `<image href="figure.png">` under an SVG frame that handles crop, vignette and ring. Check at use size.
   - Trace route (optional branch): the prompt asks for a pure black-and-white image with no grey wash. Cut each token by its crop box, threshold, and trace with potrace into inline paths in one command: `python ${CLAUDE_PLUGIN_ROOT}/scripts/trace_token.py image.png --crop x,y,w,h --use-size WxH`. The crop and framing step: the helper renders the traced path at the use size and writes a framing sheet showing its bounding box against the intended box with margins in pixels. The human reads the framing sheet before the token is placed; fix a bad crop or margin and run again. Then inline the path and restyle it (potrace paths sit under `scale(0.1)`, so multiply stroke widths by 10). When potrace is absent the helper says so plainly and still writes the mask.
7. Before delivery check renderer parity: `svg-parity.mjs` renders through resvg, librsvg and Chromium and prints a root-mean-square difference per pair (0 identical; at or below about 0.09 is the proven range, mostly 0.03). Read the three-up sheet for the largest pair. The usual cause of a real difference is text: outline it. `feTurbulence` differs slightly between renderers and is kept subtle.
8. Deliver the final SVG and keep the first-round render beside the final one for the record. Say in the report that the human's eye overrules these judgments, and that logos stay with a designer.
