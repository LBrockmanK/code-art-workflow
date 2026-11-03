"""Crop, threshold and trace one token of a generated black-and-white image: the trace route's helper.

    python trace_token.py image.png [--crop x,y,w,h] [--threshold N] [--use-size WxH] [--out-root out]

Steps: cut one token from the generated image (--crop), threshold it (Otsu unless --threshold is
given; ink is black), write mask.png, then trace the mask with the potrace binary into trace.svg.
With --use-size the traced path is rendered at the size it will be used at (through resvg) and a
framing sheet shows the path's bounding box against the intended box with its margins in pixels;
read that sheet before the token is placed.

potrace is an optional prerequisite and is called, never bundled. When it is not on PATH the mask
is still written and the trace step is skipped with a plain message (exit code 0).

Output policy: everything lands in out/trace-<YYYYMMDD-HHMMSS>/ (CODE_ART_RUN_STAMP fixes the
stamp); the run refuses when that folder exists; nothing is deleted or overwritten.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

POTRACE_ABSENT = ("potrace is not installed; the mask was written but the trace step is skipped. "
                  "Install potrace 1.16 (https://potrace.sourceforge.net/) and put it on PATH, then run again.")


def parse_crop(text):
    parts = [int(p) for p in text.split(",")]
    if len(parts) != 4:
        raise ValueError("--crop takes x,y,w,h")
    return tuple(parts)


def parse_size(text):
    w, h = text.lower().split("x")
    return int(w), int(h)


def crop(img, box):
    x, y, w, h = box
    return img.crop((x, y, x + w, y + h))


def otsu_threshold(img):
    """The grey level that best splits a greyscale image into two classes (Otsu's method)."""
    hist = img.convert("L").histogram()
    total = sum(hist)
    sum_all = sum(i * c for i, c in enumerate(hist))
    best_t, best_var, w0, sum0 = 0, -1.0, 0, 0
    for t in range(256):
        w0 += hist[t]
        if w0 == 0:
            continue
        w1 = total - w0
        if w1 == 0:
            break
        sum0 += t * hist[t]
        m0, m1 = sum0 / w0, (sum_all - sum0) / w1
        var = w0 * w1 * (m0 - m1) ** 2
        if var > best_var:
            best_var, best_t = var, t
    return best_t


def threshold(img, t):
    """Mode L mask: 0 (ink) where the grey level is at or below t, 255 (paper) elsewhere."""
    return img.convert("L").point(lambda v: 0 if v <= t else 255)


def ink_bbox(mask):
    """(left, top, right, bottom) of the ink (black) pixels, right and bottom exclusive; None if no ink."""
    return ImageOps.invert(mask.convert("L")).point(lambda v: 255 if v > 127 else 0).getbbox()


def _resvg(svg, out, width=None, height=None):
    args = ["resvg", "--background", "white", "--quiet"]
    if width:
        args += ["--width", str(width)]
    if height:
        args += ["--height", str(height)]
    r = subprocess.run(args + [str(svg), str(out)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"resvg failed: {r.stderr.strip()}")


def framing_sheet(svg, use_size, out):
    """Render the SVG at the use size, measure its ink against the intended box, write a framing sheet.

    Returns {"ink_bbox": (l, t, r, b), "margins": {left, top, right, bottom}} in pixels of the use size.
    """
    out = Path(out)
    if out.exists():
        raise FileExistsError(f"refusing to write: {out} already exists")
    w, h = use_size
    with tempfile.TemporaryDirectory() as tmp:
        render = Path(tmp) / "render.png"
        _resvg(svg, render, w, h)
        img = Image.open(render).convert("RGB")
        bbox = ink_bbox(img.convert("L").point(lambda v: 0 if v < 250 else 255))
        if bbox is None:
            raise RuntimeError("the traced path drew nothing at the use size")
        l, t, r, b = bbox
        margins = {"left": l, "top": t, "right": w - r, "bottom": h - b}
        pad = 24
        sheet = Image.new("RGB", (w + 2 * pad, h + 2 * pad + 18), "#dddddd")
        sheet.paste(img, (pad, pad))
        d = ImageDraw.Draw(sheet)
        d.rectangle((pad - 1, pad - 1, pad + w, pad + h), outline="#2060d0")  # intended box
        d.rectangle((pad + l, pad + t, pad + r - 1, pad + b - 1), outline="#d02020")  # path bounding box
        d.text((pad, pad + h + 6), "margins px  left %d  top %d  right %d  bottom %d   (blue: intended box, red: path)"
               % (margins["left"], margins["top"], margins["right"], margins["bottom"]), fill="#000000")
        sheet.save(out)
    return {"ink_bbox": bbox, "margins": margins}


def create_run_folder(tool, out_root):
    stamp = os.environ.get("CODE_ART_RUN_STAMP") or time.strftime("%Y%m%d-%H%M%S")
    run = Path(out_root).resolve() / f"{tool}-{stamp}"
    run.parent.mkdir(parents=True, exist_ok=True)
    try:
        run.mkdir()
    except FileExistsError:
        raise SystemExit(f"refusing to write: {run} already exists. The tools never overwrite or delete; "
                         "wait one second for a new run folder, or give a new output path.")
    return run


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("--crop", type=parse_crop, help="x,y,w,h of the token to cut before thresholding")
    ap.add_argument("--threshold", type=int, help="fixed grey level (0-255); default Otsu")
    ap.add_argument("--use-size", type=parse_size, help="WxH the traced path will be used at")
    ap.add_argument("--out-root", default="out")
    a = ap.parse_args(argv)

    img = Image.open(a.image).convert("L")
    if a.crop:
        img = crop(img, a.crop)
    t = a.threshold if a.threshold is not None else otsu_threshold(img)
    mask = threshold(img, t)
    run = create_run_folder("trace", a.out_root)
    img.save(run / "token.png")
    mask.save(run / "mask.png")
    print(f"threshold {t}; ink bounding box {ink_bbox(mask)}; mask -> {run / 'mask.png'}")

    potrace = shutil.which("potrace")
    if not potrace:
        print(POTRACE_ABSENT)
        return 0
    mask.convert("1").save(run / "mask.bmp")
    r = subprocess.run([potrace, "--svg", "--output", str(run / "trace.svg"), str(run / "mask.bmp")],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("potrace failed: " + r.stderr.strip(), file=sys.stderr)
        return 1
    print("trace ->", run / "trace.svg")
    if a.use_size:
        info = framing_sheet(run / "trace.svg", a.use_size, run / "framing.png")
        print("framing sheet ->", run / "framing.png", "margins px", info["margins"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
