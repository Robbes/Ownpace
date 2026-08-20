#!/usr/bin/env python3
# Copyright 2026 The Ownpace authors (Apache-2.0)
#
# make-logo.py — generate the Ownpace app mark as SVG and PNG from ONE set of
# geometry constants.
#
# WHY GENERATED, AND WHY IN PYTHON WITH NO LIBRARIES.
#
# Google's OAuth verification requires an app logo of at least 120x120 in PNG
# or JPG (docs/google-oauth-verification.md). This repository had no brand
# asset at all and the build environment has no PIL, no sharp, no ImageMagick
# and no rsvg — so a hand-waved "export it from Figma" step would have left the
# one required artefact as the only thing nobody could reproduce.
#
# Encoding a PNG by hand is about forty lines (signature, IHDR, one zlib'd
# IDAT of filter-0 scanlines, IEND) and buys the property that matters: the
# mark is DERIVED from the constants below, at every size, so a 512 and a 120
# can never drift into being different drawings.
#
# The SVG is emitted from the same constants for the same reason. Edit the
# constants, run the script, commit all three files.
#
#   python3 scripts/make-logo.py
#
# WHAT IT DRAWS, and why this rather than a wordmark: a ring that is not
# closed, with a dot at its leading end. Migration in progress, at the pace the
# customer chose — the product's whole claim in one shape. It survives being
# rendered at 24px in a browser tab, which a wordmark does not, and it carries
# no text to re-draw if the service is ever renamed again.

import math
import struct
import zlib
from pathlib import Path

# ---------------------------------------------------------------- constants --
# All lengths are fractions of the canvas edge, so every size is the same
# drawing. All angles are degrees, clockwise from twelve o'clock.

BG = (0x0E, 0x4F, 0x4A)  # deep teal — calm, not corporate-blue, not eco-green
RING = (0xFF, 0xFF, 0xFF)
DOT = (0x7F, 0xD4, 0xC1)  # mint, the one accent

CORNER_R = 0.2200  # rounded-square background
RING_R = 0.2900  # ring centreline radius
RING_W = 0.0850  # ring stroke width
DOT_R = 0.0575  # leading dot radius
ARC_START = -110.0  # gap sits lower-left, so the dot rises to the right
ARC_SWEEP = 260.0

SS = 4  # supersampling factor per axis; 16 samples per pixel
SIZES = (120, 512)  # 120 is Google's floor; 512 for everything else

OUT = Path(__file__).resolve().parent.parent / "site" / "brand"


def _arc_end_xy() -> tuple[float, float]:
    """Centre of the leading dot, in unit coordinates."""
    a = math.radians(ARC_START + ARC_SWEEP - 90.0)
    return 0.5 + RING_R * math.cos(a), 0.5 + RING_R * math.sin(a)


def _in_rounded_square(x: float, y: float) -> bool:
    r = CORNER_R
    cx = min(max(x, r), 1.0 - r)
    cy = min(max(y, r), 1.0 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _arc_start_xy() -> tuple[float, float]:
    a = math.radians(ARC_START - 90.0)
    return 0.5 + RING_R * math.cos(a), 0.5 + RING_R * math.sin(a)


def _in_arc(x: float, y: float) -> bool:
    dx, dy = x - 0.5, y - 0.5
    d = math.hypot(dx, dy)
    half = RING_W / 2.0
    if abs(d - RING_R) <= half:
        # Degrees clockwise from twelve o'clock, normalised into [0, 360).
        ang = (math.degrees(math.atan2(dy, dx)) + 90.0) % 360.0
        if ((ang - ARC_START) % 360.0) <= ARC_SWEEP:
            return True
    # Round caps, so the raster matches the SVG's stroke-linecap="round".
    # Without these the two outputs are different drawings.
    for cx, cy in (_arc_start_xy(), _arc_end_xy()):
        if (x - cx) ** 2 + (y - cy) ** 2 <= half * half:
            return True
    return False


def _in_dot(x: float, y: float) -> bool:
    ex, ey = _arc_end_xy()
    return (x - ex) ** 2 + (y - ey) ** 2 <= DOT_R * DOT_R


def _sample(x: float, y: float) -> tuple[int, int, int, int] | None:
    """Colour at a unit-coordinate point, or None for transparent."""
    if not _in_rounded_square(x, y):
        return None
    if _in_dot(x, y):
        return (*DOT, 255)
    if _in_arc(x, y):
        return (*RING, 255)
    return (*BG, 255)


def render(size: int) -> bytes:
    """RGBA rows, supersampled. Averaging premultiplied channels keeps the
    edge against transparency clean instead of haloed."""
    rows = bytearray()
    step = 1.0 / (size * SS)
    for py in range(size):
        rows.append(0)  # PNG filter type 0 (None) for this scanline
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                y = (py * SS + sy + 0.5) * step
                for sx in range(SS):
                    x = (px * SS + sx + 0.5) * step
                    s = _sample(x, y)
                    if s is not None:
                        r += s[0]
                        g += s[1]
                        b += s[2]
                        a += s[3]
            n = SS * SS
            if a == 0:
                rows += b"\x00\x00\x00\x00"
            else:
                # Un-premultiply: the colour is the average over COVERED
                # samples, the alpha is the average over all of them.
                cov = a / 255
                rows += bytes((round(r / cov), round(g / cov), round(b / cov), round(a / n)))
    return bytes(rows)


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def png(size: int) -> bytes:
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(render(size), 9))
        + _chunk(b"IEND", b"")
    )


def svg() -> str:
    def hexof(c: tuple[int, int, int]) -> str:
        return "#%02X%02X%02X" % c

    a0 = math.radians(ARC_START - 90.0)
    a1 = math.radians(ARC_START + ARC_SWEEP - 90.0)
    x0, y0 = 50 + 100 * RING_R * math.cos(a0), 50 + 100 * RING_R * math.sin(a0)
    x1, y1 = 50 + 100 * RING_R * math.cos(a1), 50 + 100 * RING_R * math.sin(a1)
    large = 1 if ARC_SWEEP > 180 else 0
    ex, ey = _arc_end_xy()
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120" role="img" aria-label="Ownpace">
  <title>Ownpace</title>
  <rect width="100" height="100" rx="{CORNER_R * 100:g}" fill="{hexof(BG)}"/>
  <path d="M {x0:.3f} {y0:.3f} A {RING_R * 100:g} {RING_R * 100:g} 0 {large} 1 {x1:.3f} {y1:.3f}"
        fill="none" stroke="{hexof(RING)}" stroke-width="{RING_W * 100:g}" stroke-linecap="round"/>
  <circle cx="{ex * 100:.3f}" cy="{ey * 100:.3f}" r="{DOT_R * 100:g}" fill="{hexof(DOT)}"/>
</svg>
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "logo.svg").write_text(svg(), encoding="utf-8")
    print(f"wrote {OUT / 'logo.svg'}")
    for size in SIZES:
        p = OUT / f"logo-{size}.png"
        p.write_bytes(png(size))
        print(f"wrote {p} ({p.stat().st_size} bytes, {size}x{size})")


if __name__ == "__main__":
    main()
