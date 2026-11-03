"""Text outlining and glyph metrics, so marks can be placed relative to letters and display text
can be outlined to a single SVG path (renderer- and font-install-independent).

Hand-guessing x positions for a tittle or an underline is the main failure mode of hand-written
SVG type. advances() and glyph_box() measure; text_path() outlines.

Fonts are looked up by file name in the plugin's fonts/ folder (one folder per family), or taken as
a path when one is given. Needs fontTools.

    python textmetrics.py "Hello" 96 --font "Lora[wght].ttf" --wght 600 [--x 10 --y 100 --spacing 2]
        prints the path d, its start x and its width
"""
import argparse
import os
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONTS = Path(__file__).resolve().parent.parent / "fonts"
_cache = {}


def find_font(file):
    """A path as given when it exists, else the first fonts/<family>/<file> match."""
    p = Path(file)
    if p.is_file():
        return p
    for hit in sorted(FONTS.glob(f"*/{glob_escape(file)}")):
        return hit
    raise FileNotFoundError(f"font {file!r} is neither a file nor in {FONTS}")


def glob_escape(name):
    # file names such as Lora[wght].ttf hold glob characters
    return name.replace("[", "[[]")


def font(file, wght=None):
    k = (str(file), wght)
    if k not in _cache:
        f = TTFont(find_font(file))
        if wght and "fvar" in f:
            f = instantiateVariableFont(f, {"wght": wght})
        _cache[k] = f
    return _cache[k]


def advances(text, size, file="Lora[wght].ttf", wght=400, spacing=0.0):
    """x offset of each character's origin, plus the total width (kerning-free advances)."""
    f = font(file, wght)
    cmap = f.getBestCmap()
    hm = f["hmtx"]
    upm = f["head"].unitsPerEm
    xs, x = [], 0.0
    for ch in text:
        xs.append(x)
        x += hm[cmap[ord(ch)]][0] * size / upm + spacing
    return xs, x - spacing


def glyph_box(ch, size, file="Lora[wght].ttf", wght=400):
    """(x0, y0, x1, y1) of one glyph's outline in SVG y-down units, origin at the glyph origin on the baseline."""
    from fontTools.pens.boundsPen import BoundsPen
    f = font(file, wght)
    gs = f.getGlyphSet()
    name = f.getBestCmap()[ord(ch)]
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    upm = f["head"].unitsPerEm
    x0, y0, x1, y1 = bp.bounds
    return x0 * size / upm, -y1 * size / upm, x1 * size / upm, -y0 * size / upm


def text_path(text, size, x=0.0, y=0.0, file="Lora[wght].ttf", wght=400, spacing=0.0, gaps=None, anchor="start", kern=True):
    """Outline text to one SVG path 'd'. Returns (d, x_start, total_width).

    gaps: optional per-glyph extra advance (cumulative tracking), which librsvg's text engine
    ignores when given as a dx list. Applies GPOS pair kerning when present (simple pairs only).
    """
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    f = font(file, wght)
    cmap = f.getBestCmap()
    hm = f["hmtx"]
    upm = f["head"].unitsPerEm
    gs = f.getGlyphSet()
    s = size / upm
    names = [cmap[ord(c)] for c in text]
    kp = _kern_pairs(f) if kern else {}
    adv = []
    for i, n in enumerate(names):
        a = hm[n][0] * s + spacing + (gaps[i] if gaps and i < len(gaps) else 0)
        if i + 1 < len(names):
            a += kp.get((n, names[i + 1]), 0) * s
        adv.append(a)
    total = sum(adv) - spacing
    x0 = x - (total / 2 if anchor == "middle" else total if anchor == "end" else 0)
    # 2-decimal coordinates: full float precision made outlined text about 10x larger for no visible gain
    pen = SVGPathPen(gs, ntos=lambda v: (f"{v:.2f}".rstrip("0").rstrip(".") or "0"))
    cx = x0
    for n, a in zip(names, adv):
        gs[n].draw(TransformPen(pen, (s, 0, 0, -s, cx, y)))
        cx += a
    return pen.getCommands(), x0, total


_kcache = {}


def _kern_pairs(f):
    if id(f) in _kcache:
        return _kcache[id(f)]
    pairs = {}
    try:
        for lk in f["GPOS"].table.LookupList.Lookup:
            for st in lk.SubTable:
                st = getattr(st, "ExtSubTable", st)
                if getattr(st, "LookupType", None) != 2 or st.Format != 1:
                    continue
                cov = st.Coverage.glyphs
                for g1, ps in zip(cov, st.PairSet):
                    for pv in ps.PairValueRecord:
                        v = getattr(pv.Value1, "XAdvance", 0) or 0
                        if v:
                            pairs.setdefault((g1, pv.SecondGlyph), v)
    except KeyError:
        pass
    _kcache[id(f)] = pairs
    return pairs


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Outline text to an SVG path using a shipped font.")
    ap.add_argument("text")
    ap.add_argument("size", type=float)
    ap.add_argument("--font", default="Lora[wght].ttf")
    ap.add_argument("--wght", type=float, default=400)
    ap.add_argument("--x", type=float, default=0.0)
    ap.add_argument("--y", type=float, default=0.0)
    ap.add_argument("--spacing", type=float, default=0.0)
    ap.add_argument("--anchor", choices=["start", "middle", "end"], default="start")
    a = ap.parse_args()
    d, x0, total = text_path(a.text, a.size, a.x, a.y, a.font, a.wght, a.spacing, anchor=a.anchor)
    print(f"d={d}\nx_start={x0:.2f}\nwidth={total:.2f}")
