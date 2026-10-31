#!/usr/bin/env python3
"""Regenerate the subtitle line of docs/assets/free-credits-banner.png in place.

Why this exists: the banner's text is baked into pixels (no layered source
file, e.g. Figma/PSD, is checked into this repo). This script patches ONLY
the subtitle row using a flat-color background fill + re-rendered text, so a
future copy change is a one-line edit instead of a full re-export.

Measured from the original banner (2560x640 PNG):
  - Background behind the subtitle (x 85-1400, y 375-455) is a FLAT solid
    fill, RGB(247, 229, 255) -- verified via pixel sampling, not a gradient
    in this region (the diagonal lighter panel only starts around x~1420+).
  - Subtitle font: Inter, Regular (weight 400), size 47px, color
    RGB(84, 75, 138). Matched by rendering the OLD subtitle string at
    several size/weight combos and comparing both the ink bounding-box
    width (target ~1078px for the original copy) and a visual overlay --
    47px/400 reproduced the original string at 1078px wide (target 1079),
    pixel-for-pixel indistinguishable from the source banner.
  - Left edge of the subtitle ink: x=103. Baseline: y=429.

Usage:
    python3 free-credits-banner.py "New subtitle text here"

If no argument is given, re-renders the current approved copy
(see NEW_TEXT below). Edits the banner PNG in place at
docs/assets/free-credits-banner.png (relative to the repo this file lives
in: docs/assets/src/ -> docs/assets/).

Font dependency: Inter (variable font, needs the Weight axis) is NOT vendored
in this repo. The script searches a few common local locations (see
FONT_SEARCH_PATHS) and falls back to $INTER_VARIABLE_TTF. If none is found,
it exits with instructions instead of guessing a substitute font.
"""
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_DOCS_ASSETS = Path(__file__).resolve().parents[1]  # docs/assets/
BANNER_PATH = REPO_DOCS_ASSETS / "free-credits-banner.png"

BG_COLOR = (247, 229, 255)
TEXT_COLOR = (84, 75, 138)
NEW_TEXT = "$10 in free credits · usage billed to your Novada account"

# x0, y0, x1, y1 -- verified flat-background region large enough for the
# current copy; widen x1 if a future subtitle needs more room (stay left of
# the "Get your free key" button, which starts at x~1832 at this banner size).
PATCH_BOX = (85, 375, 1400, 455)
LEFT_X = 103
BASELINE_Y = 429
FONT_SIZE = 47
FONT_WEIGHT = 400  # Inter "Regular"

FONT_SEARCH_PATHS = [
    os.environ.get("INTER_VARIABLE_TTF", ""),
    str(Path.home() / "Library/Fonts/Inter-Variable.ttf"),
    "/tmp/Inter-Variable.ttf",
]


def find_font() -> str:
    for p in FONT_SEARCH_PATHS:
        if p and Path(p).is_file():
            return p
    raise SystemExit(
        "Inter-Variable.ttf not found. Set INTER_VARIABLE_TTF=/path/to/Inter-Variable.ttf "
        "(download from https://rsms.me/inter/ or Google Fonts) and re-run."
    )


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1].startswith("-"):
        # Writes the banner in place, so never treat a flag (e.g. --help) as subtitle text.
        raise SystemExit(__doc__)
    text = sys.argv[1] if len(sys.argv) > 1 else NEW_TEXT

    font_path = find_font()
    src = Image.open(BANNER_PATH)
    dpi = src.info.get("dpi")
    im = src.convert("RGB")
    draw = ImageDraw.Draw(im)

    draw.rectangle(PATCH_BOX, fill=BG_COLOR)

    font = ImageFont.truetype(font_path, FONT_SIZE)
    font.set_variation_by_axes([14, FONT_WEIGHT])  # [Optical size, Weight]
    draw.text((LEFT_X, BASELINE_Y), text, font=font, fill=TEXT_COLOR, anchor="ls")

    save_kwargs = {"dpi": dpi} if dpi else {}
    im.save(BANNER_PATH, **save_kwargs)
    print(f"Wrote {BANNER_PATH} ({im.size[0]}x{im.size[1]}) with subtitle: {text!r}")


if __name__ == "__main__":
    main()
