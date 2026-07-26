"""Generate the Waypoint app icon.

Draws the same mark as the web's `frontend/src/components/BrandMark.tsx` — an
ascending line ending in a filled destination dot — in white over the default
theme's sky -> fuchsia brand gradient, matching the login header's
`brandGradient` in Views/Auth/LoginView.swift.

Like gen_palettes.py this writes a generated asset; don't hand-edit the PNG.
Stdlib only (no Pillow): the raster is built with a signed-distance field and
encoded straight to PNG with zlib.

    python3 ios/scripts/gen_appicon.py
"""

import math
import struct
import zlib
from pathlib import Path

OUT = (
    Path(__file__).resolve().parents[1]
    / "FinanceTracker/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
)

SIZE = 1024

# Default theme accents (User.primary_color="sky", secondary_color="fuchsia"),
# sourced from Support/ThemePalettes.swift shade 600.
GRAD_FROM = (0x00, 0x84, 0xD1)  # sky-600
GRAD_TO = (0xC8, 0x00, 0xDE)  # fuchsia-600

# The mark, on the same 24x24 grid the SVG uses.
POLYLINE = [(3.0, 18.0), (9.0, 12.0), (13.0, 16.0), (19.0, 7.0)]
DOT = (19.0, 7.0)
DOT_R = 2.5
STROKE_W = 2.0

# Inset the 24-unit grid so the mark doesn't crowd the icon's edges (iOS also
# masks the corners, so keep well clear of them).
GLYPH_SCALE = 0.72

# Centre on the mark's inked bounds, not on (12,12) — the stroke and the dot
# push the drawn shape off the nominal grid centre.
_XS = [p[0] for p in POLYLINE]
_YS = [p[1] for p in POLYLINE]
CENTER = (
    ((min(_XS) - STROKE_W / 2) + max(max(_XS) + STROKE_W / 2, DOT[0] + DOT_R)) / 2,
    (min(min(_YS) - STROKE_W / 2, DOT[1] - DOT_R) + (max(_YS) + STROKE_W / 2)) / 2,
)


def grid_to_px(x, y):
    unit = SIZE / 24.0 * GLYPH_SCALE
    return SIZE / 2.0 + (x - CENTER[0]) * unit, SIZE / 2.0 + (y - CENTER[1]) * unit


def dist_to_segment(px, py, ax, ay, bx, by):
    """Distance from (px,py) to segment a->b."""
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def build_pixels():
    unit = SIZE / 24.0 * GLYPH_SCALE
    segments = [
        (*grid_to_px(*POLYLINE[i]), *grid_to_px(*POLYLINE[i + 1]))
        for i in range(len(POLYLINE) - 1)
    ]
    dot_x, dot_y = grid_to_px(*DOT)
    dot_r = DOT_R * unit
    # Round caps/joins come for free: a stroked polyline is just "within
    # half a stroke-width of any segment".
    half_stroke = STROKE_W / 2.0 * unit

    rows = []
    for y in range(SIZE):
        # Gradient runs top-leading -> bottom-trailing, same as brandGradient.
        row = bytearray()
        py = y + 0.5
        for x in range(SIZE):
            px = x + 0.5
            t = (x + y) / (2.0 * (SIZE - 1))
            bg = tuple(
                round(GRAD_FROM[c] + (GRAD_TO[c] - GRAD_FROM[c]) * t) for c in range(3)
            )

            d = min(
                min(dist_to_segment(px, py, *s) for s in segments) - half_stroke,
                math.hypot(px - dot_x, py - dot_y) - dot_r,
            )
            # 1px linear ramp across the edge for anti-aliasing.
            alpha = max(0.0, min(1.0, 0.5 - d))
            row += bytes(round(bg[c] + (255 - bg[c]) * alpha) for c in range(3))
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 per scanline

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    # 8-bit RGB, no alpha: App Store icons must be fully opaque.
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    write_png(OUT, build_pixels())
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
