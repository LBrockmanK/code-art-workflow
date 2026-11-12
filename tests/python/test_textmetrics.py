from fontTools.pens.boundsPen import BoundsPen
from fontTools.svgLib.path import parse_path

import textmetrics


def path_bounds(d):
    pen = BoundsPen(None)
    parse_path(d, pen)
    return pen.bounds  # x0, y0, x1, y1 (svg y-down, as written)


def test_one_word_in_one_shipped_font_outlines_to_a_path_matching_the_metrics():
    d, x0, total = textmetrics.text_path("Hello", 100, x=0, y=0, file="Lora[wght].ttf", wght=400)
    assert d and d.startswith("M")
    xs, width = textmetrics.advances("Hello", 100, file="Lora[wght].ttf", wght=400)
    # kerning can only move glyphs a little: the outlined width stays close to the plain advance sum
    assert abs(total - width) < 0.05 * width
    bx0, by0, bx1, by1 = path_bounds(d)
    assert bx0 > -0.2 * 100 and bx1 < total + 0.2 * 100  # outline sits within the advance width
    assert by0 < 0 < by1 + 1  # ascenders above the baseline (y up is negative)


def test_glyph_box_matches_the_outline_bounds_of_a_single_letter():
    x0, y0, x1, y1 = textmetrics.glyph_box("H", 100, file="Lora[wght].ttf")
    d, _, _ = textmetrics.text_path("H", 100, file="Lora[wght].ttf")
    bx0, by0, bx1, by1 = path_bounds(d)
    assert abs(bx0 - x0) < 0.5 and abs(bx1 - x1) < 0.5
    assert abs(by0 - y0) < 0.5 and abs(by1 - y1) < 0.5


def test_fonts_are_found_by_file_name_in_the_plugin_font_folder():
    assert textmetrics.find_font("Cinzel[wght].ttf").is_file()
    assert textmetrics.find_font("ShareTechMono-Regular.ttf").is_file()
