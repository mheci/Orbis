#!/usr/bin/env python3
"""
Generate the Orbis icon set.

Icons are drawn geometrically rather than shipped as opaque binaries, so the
whole set is reproducible from source, reviewable in a diff, and trivially
re-tintable if the branding changes.

Design
------
An orb held in a tilted orbit ring, with a small satellite riding the lower
ring. The ring is the container boundary: everything on it stays quarantined
in its own orbit. The satellite gives the mark a sense of motion and reads as
"watched / contained" at a glance.

Deliberately NOT Google's four-colour palette. Using Google's actual logo
colours on an add-on that is not affiliated with Google invites a trademark
objection during AMO review, so the palette is a distinct indigo/cyan.

Rendering notes
---------------
- Everything is drawn on an 8x supersampled canvas and downsampled with
  LANCZOS, which is what produces clean antialiased curves without a vector
  rasteriser.
- Detail is size-aware: at 16px the satellite and fine ring collapse into
  noise, so small sizes use a thicker ring, no satellite and a solid plate.
  This is standard optical compensation, not a hack.
"""

import math
import os
from PIL import Image, ImageDraw

SS = 8  # supersampling factor

# Palette
INDIGO_TOP = (104, 88, 255, 255)    # plate gradient, top
INDIGO_BOTTOM = (42, 28, 150, 255)  # plate gradient, bottom
CYAN = (34, 233, 219, 255)          # ring + satellite
ORB_TOP = (240, 238, 255, 255)      # orb gradient, top
ORB_BOTTOM = (198, 191, 255, 255)   # orb gradient, bottom
HIGHLIGHT = (255, 255, 255, 90)     # soft sheen on the orb
TRANSPARENT = (0, 0, 0, 0)

TILT = -24  # orbit ring tilt, degrees (counterclockwise)


def vertical_gradient(width, height, top, bottom):
    """An RGBA image with a vertical gradient from `top` to `bottom`."""
    grad = Image.new("RGBA", (width, height), TRANSPARENT)
    d = ImageDraw.Draw(grad)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(4))
        d.line([(0, y), (width - 1, y)], fill=color)
    return grad


def render(size, *, shape="disc"):
    """Render one icon at `size` px."""
    s = size * SS
    img = Image.new("RGBA", (s, s), TRANSPARENT)
    cx = cy = s / 2.0

    # Background plate: vertical indigo gradient, disc (small) or rounded
    # square (large). A filled plate keeps the icon legible on both light and
    # dark Firefox toolbars, which a bare glyph would not.
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    if shape == "disc":
        md.ellipse([0, 0, s - 1, s - 1], fill=255)
    else:  # rounded square, for the larger store/listing sizes
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=255)
    plate = vertical_gradient(s, s, INDIGO_TOP, INDIGO_BOTTOM)
    img.alpha_composite(
        Image.composite(plate, Image.new("RGBA", (s, s), TRANSPARENT), mask)
    )

    # Size-aware detail. Below ~24px the satellite and ring tilt turn to mush,
    # so small sizes get a chunkier ring and a solid plate instead.
    if size <= 20:
        ring_rx, ring_ry, ring_w, orb_r, satellite = 0.34, 0.145, 0.065, 0.215, False
    elif size <= 40:
        ring_rx, ring_ry, ring_w, orb_r, satellite = 0.35, 0.15, 0.052, 0.215, True
    else:
        ring_rx, ring_ry, ring_w, orb_r, satellite = 0.36, 0.15, 0.042, 0.215, True

    ring_px = max(2, round(s * ring_w))
    rx, ry = s * ring_rx, s * ring_ry
    box = [cx - rx, cy - ry, cx + rx, cy + ry]

    def ring_layer(start=None, end=None):
        """The orbit ring, tilted; optionally just one arc of it."""
        layer = Image.new("RGBA", (s, s), TRANSPARENT)
        d = ImageDraw.Draw(layer)
        if start is None:
            d.ellipse(box, outline=CYAN, width=ring_px)
        else:
            d.arc(box, start=start, end=end, fill=CYAN, width=ring_px)
        return layer.rotate(TILT, resample=Image.Resampling.BICUBIC, center=(cx, cy))

    # Full ring behind the orb.
    img.alpha_composite(ring_layer())

    # Orb with a soft vertical gradient and a top-left sheen.
    orb = Image.new("RGBA", (s, s), TRANSPARENT)
    orb_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(orb_mask).ellipse(
        [cx - s * orb_r, cy - s * orb_r, cx + s * orb_r, cy + s * orb_r], fill=255
    )
    orb_grad = vertical_gradient(s, s, ORB_TOP, ORB_BOTTOM)
    orb.alpha_composite(
        Image.composite(orb_grad, Image.new("RGBA", (s, s), TRANSPARENT), orb_mask)
    )
    hl = Image.new("RGBA", (s, s), TRANSPARENT)
    hx, hy = cx - s * orb_r * 0.42, cy - s * orb_r * 0.55
    hrx, hry = s * orb_r * 0.55, s * orb_r * 0.38
    ImageDraw.Draw(hl).ellipse(
        [hx - hrx, hy - hry, hx + hrx, hy + hry], fill=HIGHLIGHT
    )
    orb.alpha_composite(hl)
    img.alpha_composite(orb)

    # Lower half of the ring drawn in front of the orb (the "containing" arc)
    # and the satellite riding it. The satellite is placed on the lower-left
    # ring in the unrotated frame, so it tilts together with the ring.
    front = ring_layer(start=180, end=360)
    if satellite:
        theta = math.radians(120)
        px = cx + rx * math.cos(theta)
        py = cy + ry * math.sin(theta)
        rad = math.radians(TILT)
        dx, dy = px - cx, py - cy
        px = cx + dx * math.cos(rad) - dy * math.sin(rad)
        py = cy + dx * math.sin(rad) + dy * math.cos(rad)
        r = max(2, round(s * 0.042))
        ImageDraw.Draw(front).ellipse([px - r, py - r, px + r, py + r], fill=CYAN)
    img.alpha_composite(front)

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
    print("[icons] rendering Orbis icon set")
    main()
