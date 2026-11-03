"""oklch -> sRGB hex (with a chroma-reduction gamut clamp) and WCAG contrast.

SVG renderers such as resvg and librsvg do not parse oklch(), so a palette written in oklch
is turned into hex here before it goes into an SVG. Standard library only.

    python oklch.py "oklch(70% 0.12 200)" [#background]   -> hex, and the contrast ratio against a background
"""
import math
import re
import sys


def oklch_to_linear(L, C, h):
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def _enc(c):
    c = min(1, max(0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _dec(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def oklch_hex(L, C, h):
    """sRGB hex of an oklch colour; chroma is reduced until the colour is inside the sRGB gamut."""
    while True:
        rgb = oklch_to_linear(L, C, h)
        if all(-1e-4 <= v <= 1 + 1e-4 for v in rgb) or C <= 0:
            break
        C -= 0.002
    return "#" + "".join(f"{round(_enc(v) * 255):02x}" for v in rgb)


def hex_to_oklch(hx):
    """(L 0..1, C, h degrees) of an sRGB hex colour."""
    r, g, b = (_dec(int(hx[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    C = math.hypot(a, bb)
    h = math.degrees(math.atan2(bb, a)) % 360 if C > 1e-6 else 0.0
    return L, C, h


_OKLCH = re.compile(r"oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)")


def parse(tok):
    """A hex colour or an oklch(L% C h) / oklch(L C h) string -> lower-case sRGB hex."""
    if tok.startswith("#"):
        return tok.lower()
    m = _OKLCH.match(tok.strip())
    if not m:
        raise ValueError(f"not a hex colour or an oklch() colour: {tok!r}")
    L = float(m[1]) / (100 if m[2] else 1)
    return oklch_hex(L, float(m[3]), float(m[4]))


def lum(hx):
    v = [_dec(int(hx[i:i + 2], 16) / 255) for i in (1, 3, 5)]
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]


def contrast(a, b):
    """WCAG contrast ratio of two hex colours (1 to 21)."""
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    hx = parse(sys.argv[1])
    print(hx)
    if len(sys.argv) > 2:
        print("contrast against %s: %.2f" % (sys.argv[2], contrast(hx, parse(sys.argv[2]))))
