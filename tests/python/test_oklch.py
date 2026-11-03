import oklch


def test_known_hex_round_trips():
    for hx in ("#b5483a", "#2f5d62", "#f4efe6", "#000000", "#ffffff"):
        L, C, h = oklch.hex_to_oklch(hx)
        assert oklch.oklch_hex(L, C, h) == hx


def test_out_of_gamut_colour_is_clamped_by_reducing_chroma():
    hx = oklch.oklch_hex(0.7, 0.4, 150)  # far outside sRGB
    assert len(hx) == 7 and hx.startswith("#")
    L, C, h = oklch.hex_to_oklch(hx)
    assert C < 0.4
    assert abs(L - 0.7) < 0.02  # lightness is kept; only chroma gives way


def test_known_pair_returns_its_wcag_ratio():
    assert round(oklch.contrast("#000000", "#ffffff"), 2) == 21.0
    assert round(oklch.contrast("#ffffff", "#ffffff"), 2) == 1.0
    assert round(oklch.contrast("#777777", "#ffffff"), 2) == 4.48


def test_parse_accepts_hex_and_oklch_function():
    assert oklch.parse("#ABCDEF") == "#abcdef"
    assert oklch.parse("oklch(100% 0 0)") == "#ffffff"
    assert oklch.parse("oklch(0 0 0)") == "#000000"
