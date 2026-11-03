import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

import trace_token

SCRIPT = Path(trace_token.__file__)


def test_a_grey_gradient_thresholds_to_the_expected_mask():
    w, h = 256, 4
    img = Image.new("L", (w, h))
    img.putdata([x for _ in range(h) for x in range(w)])  # 0..255 left to right
    t = trace_token.otsu_threshold(img)
    mask = trace_token.threshold(img, t)
    assert 120 <= t <= 135  # a uniform gradient splits at about the middle
    # ink (dark) is on the left, paper on the right
    assert mask.getpixel((5, 0)) == 0
    assert mask.getpixel((250, 0)) == 255


def test_a_crop_yields_a_mask_whose_bounding_box_is_the_expected_one():
    img = Image.new("L", (100, 80), 255)
    for x in range(30, 50):
        for y in range(20, 40):
            img.putpixel((x, y), 0)  # one black token
    cropped = trace_token.crop(img, (20, 10, 50, 40))  # x, y, w, h
    mask = trace_token.threshold(cropped, trace_token.otsu_threshold(cropped))
    assert mask.size == (50, 40)
    assert trace_token.ink_bbox(mask) == (10, 10, 30, 30)  # left, top, right, bottom


def test_parse_crop_and_use_size():
    assert trace_token.parse_crop("1,2,30,40") == (1, 2, 30, 40)
    assert trace_token.parse_size("640x480") == (640, 480)
    with pytest.raises(ValueError):
        trace_token.parse_crop("1,2,3")


@pytest.mark.skipif(shutil.which("potrace"), reason="potrace is installed; the absent-potrace path is not reachable")
def test_the_trace_step_is_skipped_with_a_plain_message_when_potrace_is_absent(tmp_path):
    src = tmp_path / "token.png"
    img = Image.new("L", (60, 60), 255)
    for x in range(10, 30):
        for y in range(10, 30):
            img.putpixel((x, y), 0)
    img.save(src)
    r = subprocess.run([sys.executable, str(SCRIPT), str(src), "--out-root", str(tmp_path / "out")],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "potrace is not installed" in r.stdout
    run = next((tmp_path / "out").iterdir())
    assert (run / "mask.png").is_file()  # the mask is still written
    assert not list(run.glob("*.svg"))


def test_a_run_folder_is_never_reused(tmp_path):
    src = tmp_path / "token.png"
    Image.new("L", (20, 20), 255).save(src)
    out = tmp_path / "out"
    env_stamp = {"CODE_ART_RUN_STAMP": "20260101-000000"}
    import os
    env = {**os.environ, **env_stamp}
    a = subprocess.run([sys.executable, str(SCRIPT), str(src), "--out-root", str(out)], capture_output=True, text=True, env=env)
    b = subprocess.run([sys.executable, str(SCRIPT), str(src), "--out-root", str(out)], capture_output=True, text=True, env=env)
    assert a.returncode == 0, a.stderr
    assert b.returncode != 0
    assert "refusing to write" in b.stderr


@pytest.mark.skipif(not shutil.which("resvg"), reason="resvg is not on PATH")
def test_the_framing_sheet_reports_margins_against_the_intended_box(tmp_path):
    svg = tmp_path / "t.svg"
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
                   '<rect x="20" y="30" width="40" height="20" fill="#000"/></svg>')
    sheet = tmp_path / "framing.png"
    info = trace_token.framing_sheet(svg, (200, 200), sheet)
    # drawing bbox in a 200x200 render: x 40..120, y 60..100
    assert info["ink_bbox"] == (40, 60, 120, 100)
    assert info["margins"] == {"left": 40, "top": 60, "right": 80, "bottom": 100}
    assert sheet.is_file()
