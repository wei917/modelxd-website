#!/usr/bin/env python3
"""Typographic preview cards for TEXT templates.

    python3 scripts/make-text-cards.py            # all cards below
    python3 scripts/make-text-cards.py video-understand

A text template has no natural photograph — "ask a model about a video" is not
a picture of anything — so these are DESIGNED cards in the site's own type
system, not AI-generated images. That is the existing convention: see
public/templates/text-decimals.jpg and text-earnings-analysis.jpg, whose
palette this samples exactly (--bg #fdfdfb, --white #0f0f0f, --red #d63b32).

Fonts are the real ones, vendored in scripts/fonts/ (both OFL) rather than
downloaded per run, so anyone can regenerate these and get the same output.
PIL cannot read the .woff2 that next/font compiles.

NOT in public/fonts/. That directory is XCut's ffmpeg font source, and
lib/xcut-render.ts bundledFont() takes the FIRST .ttf in readdir order —
"ArchivoBlack" sorts before "NotoSansTC", so parking these there made every
subtitle burn pick a font with no CJK glyphs and Chinese subtitles silently
drew nothing. These files are build-time tooling; they must never be web-served
or discoverable by that scan.
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

W = H = 400
BG, INK, RED = "#fdfdfb", "#0f0f0f", "#d63b32"
MARGIN = 34

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DISPLAY = os.path.join(ROOT, "scripts/fonts/ArchivoBlack-Regular.ttf")
MONO = os.path.join(ROOT, "scripts/fonts/JetBrainsMono-Bold.ttf")
OUT = os.path.join(ROOT, "public/templates")

# The pair. These two templates take the SAME input file and differ only in
# which sense the model uses — the template copy says so, but two flat colour
# swatches could not. Side by side the cards now read WATCHES / LISTENS, which
# is the one thing a user needs to tell them apart.
CARDS = {
    # Headlines are kept to ~7 characters a line on purpose: the reference
    # cards set "QUARTER?" at 66px, and every extra character shrinks the type
    # that carries the card. The detail belongs in the caption.
    "video-understand": {
        "eyebrow": "// THE MODEL WATCHES",
        "lines": ["ASK THE", "VIDEO."],
        "caption": "WHAT HAPPENS AT 0:47? ASK TWO MODELS.",
    },
    "audio-transcribe": {
        "eyebrow": "// THE MODEL LISTENS",
        "lines": ["WORDS,", "TIMED."],
        "caption": "PASTE THE LYRICS. TIMESTAMPS SNAP.",
    },
}


def mono(size):
    f = ImageFont.truetype(MONO, size)
    try:
        f.set_variation_by_name("Bold")   # JetBrains Mono ships as a variable font
    except Exception:
        pass
    return f


def tracked(draw, xy, text, font, fill, tracking):
    """PIL has no letter-spacing; the house mono is tracked, so draw per glyph."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


def tracked_width(draw, text, font, tracking):
    return sum(draw.textlength(c, font=font) for c in text) + tracking * max(0, len(text) - 1)


def fit_display(draw, line_sets, max_w):
    """Largest size at which EVERY line of EVERY card fits the measure.

    Shared across the whole set on purpose. Sizing each card independently gave
    the pair two different headline sizes (36px and 42px), which is exactly what
    stops two cards reading as a pair when they sit side by side in the picker.
    """
    for size in range(74, 24, -1):
        f = ImageFont.truetype(DISPLAY, size)
        if all(draw.textlength(l, font=f) <= max_w for lines in line_sets for l in lines):
            return f, size
    return ImageFont.truetype(DISPLAY, 24), 24


def build(card_id, spec, hl_font, hl_size):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    eb_font = mono(12)
    cap_font = mono(11)

    line_h = int(hl_size * 1.02)          # Archivo Black is tight; keep it tight
    block_h = 22 + 14 + line_h * len(spec["lines"]) + 16 + 4 + 16 + 14

    y = (H - block_h) // 2
    tracked(d, (MARGIN, y), spec["eyebrow"], eb_font, RED, 1.6)
    y += 22 + 14

    for line in spec["lines"]:
        d.text((MARGIN, y), line, font=hl_font, fill=INK)
        y += line_h

    # The red rule, as wide as the longest headline line — it underscores the
    # words rather than spanning the card, which is what the existing two do.
    y += 16
    rule_w = max(d.textlength(l, font=hl_font) for l in spec["lines"])
    d.rectangle([MARGIN, y, MARGIN + rule_w, y + 4], fill=RED)
    y += 4 + 16

    tracked(d, (MARGIN, y), spec["caption"], cap_font, INK, 0.9)

    path = os.path.join(OUT, f"{card_id}.jpg")
    img.save(path, "JPEG", quality=92, subsampling=0)   # 4:4:4: red type on
    print(f"  {card_id}.jpg  headline {hl_size}px")     # off-white must not smear


if __name__ == "__main__":
    want = sys.argv[1:] or list(CARDS)
    unknown = [c for c in want if c not in CARDS]
    for c in unknown:
        print(f"  unknown card: {c}")
    want = [c for c in want if c in CARDS]

    # One size for the whole set, measured across every card — even when only
    # one is being regenerated, so a single rebuild cannot desync the pair.
    probe = ImageDraw.Draw(Image.new("RGB", (W, H)))
    hl_font, hl_size = fit_display(probe, [CARDS[c]["lines"] for c in CARDS], W - MARGIN * 2)
    print(f"  shared headline size: {hl_size}px")
    for cid in want:
        build(cid, CARDS[cid], hl_font, hl_size)
