#!/usr/bin/env python3
"""
Generate the G-Container icon set.

Icons are drawn geometrically rather than shipped as opaque binaries, so the
whole set is reproducible from source, reviewable in a diff, and trivially
re-tintable if the branding changes.

Design
------
A bold "G" enclosed in a dashed ring. The ring is the metaphor: a container
boundary that quarantines what is inside it. The dashes read as "isolated /
sandboxed" rather than merely "circled".

Deliberately NOT Google's four-colour palette. Using Google's actual logo
colours on an add-on that is not affiliated with Google invites a trademark
objection during AMO review, so the palette is a distinct indigo/cyan.

Rendering notes
---------------
- Everything is drawn on an 8x supersampled canvas and downsampled with LANCZOS,
  which is what produces clean antialiased curves without a vector rasteriser.
- Detail is size-aware: at 16px a 12-dash ring collapses into visual noise, so
  small sizes use fewer, chunkier dashes and a slightly heavier stroke. This is
  standard optical compensation, not a hack.
"""

import math
import os
from PIL import Image, ImageDraw

SS = 8  # supersampling factor

# Palette
INDIGO = (26, 16, 66, 255)  # background disc
CYAN = (34, 233, 219, 255)  # G + ring
TRANSPARENT = (0, 0, 0, 0)


def draw_g(img, cx, cy, radius, stroke, colour):
    """
    Draw a geometric capital G.

    Construction: a filled outer disc with the counter punched out, the
    aperture wedge removed, then the crossbar and terminal added back. Drawing
    it subtractively (rather than as a stroked arc) is what keeps the counter
    genuinely open at 16px, where a stroked arc closes up into a blob.

    Everything is composited on a scratch layer so the punch-outs cut to
    transparency and let the background plate show through.
    """
    layer = Image.new("RGBA", img.size, TRANSPARENT)
    d = ImageDraw.Draw(layer)

    outer = radius
    inner = radius - stroke

    # Ring of the G.
    d.ellipse([cx - outer, cy - outer, cx + outer, cy + outer], fill=colour)
    d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=TRANSPARENT)

    # Aperture: remove the wedge on the right between roughly 4 and 12 o'clock
    # measured from the horizontal, leaving the classic G opening.
    d.pieslice(
        [cx - outer - 2, cy - outer - 2, cx + outer + 2, cy + outer + 2],
        start=-32,
        end=8,
        fill=TRANSPARENT,
    )

    # Crossbar: horizontal spur entering from the right at the vertical centre.
    bar_h = stroke * 0.92
    bar_top = cy - bar_h / 2.0
    bar_left = cx + radius * 0.06
    d.rectangle([bar_left, bar_top, cx + outer, bar_top + bar_h], fill=colour)

    # Vertical terminal dropping from the bar to close the aperture cleanly.
    d.rectangle(
        [cx + outer - stroke, bar_top, cx + outer, bar_top + bar_h * 1.05],
        fill=colour,
    )

    img.alpha_composite(layer)


def draw_dashed_ring(draw, cx, cy, radius, stroke, colour, dashes, duty=0.58):
    """Draw a dashed circle: `dashes` segments, each covering `duty` of its slot."""
    box = [cx - radius, cy - radius, cx + radius, cy + radius]
    step = 360.0 / dashes
    span = step * duty
    for i in range(dashes):
        start = i * step - span / 2.0
        draw.arc(box, start=start, end=start + span, fill=colour, width=stroke)


def render(size, *, shape="disc"):
    """Render one icon at `size` px."""
    s = size * SS
    img = Image.new("RGBA", (s, s), TRANSPARENT)
    d = ImageDraw.Draw(img)

    cx = cy = s / 2.0

    # Background plate. A filled plate keeps the icon legible on both light and
    # dark Firefox toolbars, which a bare glyph would not.
    if shape == "disc":
        d.ellipse([0, 0, s - 1, s - 1], fill=INDIGO)
    else:  # rounded square, for the larger store/listing sizes
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=INDIGO)

    # Size-aware detail. Below ~32px a fine dashed ring turns to mush, so the
    # ring gets fewer, heavier dashes and the G gets a touch more weight.
    if size <= 20:
        dashes, ring_stroke, g_stroke, g_r, ring_r = 0, 0.070, 0.105, 0.250, 0.400
    elif size <= 40:
        dashes, ring_stroke, g_stroke, g_r, ring_r = 8, 0.058, 0.092, 0.248, 0.408
    elif size <= 64:
        dashes, ring_stroke, g_stroke, g_r, ring_r = 10, 0.050, 0.086, 0.246, 0.412
    else:
        dashes, ring_stroke, g_stroke, g_r, ring_r = 12, 0.045, 0.082, 0.245, 0.416

    ring_px = max(1, int(s * ring_stroke))
    if dashes == 0:
        rr = s * ring_r
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=CYAN, width=ring_px)
    else:
        draw_dashed_ring(d, cx, cy, radius=s * ring_r, stroke=ring_px,
                         colour=CYAN, dashes=dashes)
    draw_g(
        img,
        cx,
        cy,
        radius=s * g_r,
        stroke=max(2, int(s * g_stroke)),
        colour=CYAN,
    )

    return img.resize((size, size), Image.LANCZOS)


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "src", "icons")
    out_dir = os.path.normpath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    for size in (16, 32, 48, 96, 128):
        # Firefox masks/needs square art; the disc reads better small, the
        # rounded square is closer to platform icon conventions when large.
        shape = "disc" if size <= 48 else "rounded"
        img = render(size, shape=shape)
        path = os.path.join(out_dir, f"icon-{size}.png")
        img.save(path, optimize=True)
        print(f"  wrote {path} ({os.path.getsize(path)} bytes)")

    # A large master for the AMO listing and README.
    master = render(512, shape="rounded")
    master_path = os.path.join(out_dir, "icon-512.png")
    master.save(master_path, optimize=True)
    print(f"  wrote {master_path} ({os.path.getsize(master_path)} bytes)")


if __name__ == "__main__":
    print("[icons] rendering G-Container icon set")
    main()
