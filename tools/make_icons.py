"""
Generates the PNG app icons for both apps.

Run from the project root:   python tools/make_icons.py

Guide 4.7 asks the designer for an SVG plus PNGs at 192, 512 and 1024 on an
opaque background. The SVG masters live in app/icons/*.svg; this script
renders the PNGs from the same shapes so the two never drift apart.

Everything is drawn at 4x and downscaled, which is cheaper than teaching
Pillow to antialias and gives clean edges at 192px.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

ACCENT = (31, 111, 139)        # --accent  #1F6F8B
ACCENT_DARK = (23, 86, 104)    # --accent-strong
INK = (22, 35, 42)             # --ink
PAPER = (255, 255, 255)
LINE = (168, 190, 200)
SUPER = 4                      # supersampling factor


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def worker_icon(size):
    """A notebook page with two columns of figures, and a camera lens."""
    s = size * SUPER
    img = Image.new("RGB", (s, s), ACCENT)
    d = ImageDraw.Draw(img)

    # A single darker sweep in the leading corner. One shape, not two —
    # a slightly smaller ellipse on top of it leaves a ring that reads as
    # a mistake at 192px.
    d.ellipse((-s * 0.30, -s * 0.42, s * 0.72, s * 0.52), fill=ACCENT_DARK)

    # The notebook page, inside the maskable safe zone (80% of the canvas).
    pw, ph = s * 0.46, s * 0.54
    px, py = (s - pw) / 2, (s - ph) / 2 - s * 0.03
    rounded(d, (px, py, px + pw, py + ph), radius=s * 0.045, fill=PAPER)

    # Two columns of ruled figures — cash and mada, the whole data model.
    col_w = pw * 0.30
    gap = pw * 0.12
    left_x = px + (pw - (col_w * 2 + gap)) / 2
    line_h = max(int(s * 0.018), 1)

    for row in range(5):
        y = py + ph * 0.26 + row * ph * 0.125
        for col in range(2):
            x = left_x + col * (col_w + gap)
            w = col_w * (0.95 if row % 2 == 0 else 0.7)
            rounded(d, (x, y, x + w, y + line_h), radius=line_h / 2, fill=LINE)

    # Column heading rule.
    rounded(d, (px + pw * 0.18, py + ph * 0.15,
                px + pw * 0.82, py + ph * 0.15 + line_h * 1.4),
            radius=line_h, fill=ACCENT)

    # Camera lens, bottom-trailing corner.
    r = s * 0.115
    cx, cy = s * 0.735, s * 0.735
    d.ellipse((cx - r * 1.35, cy - r * 1.35, cx + r * 1.35, cy + r * 1.35), fill=ACCENT)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PAPER)
    d.ellipse((cx - r * 0.58, cy - r * 0.58, cx + r * 0.58, cy + r * 0.58), fill=ACCENT_DARK)

    return img.resize((size, size), Image.LANCZOS)


def owner_icon(size):
    """The same page, carrying a bar chart instead of raw figures."""
    s = size * SUPER
    img = Image.new("RGB", (s, s), INK)
    d = ImageDraw.Draw(img)

    d.ellipse((-s * 0.35, -s * 0.45, s * 0.75, s * 0.55), fill=(30, 47, 56))

    pw, ph = s * 0.50, s * 0.50
    px, py = (s - pw) / 2, (s - ph) / 2
    rounded(d, (px, py, px + pw, py + ph), radius=s * 0.045, fill=PAPER)

    # Four bars, rising — the monthly report in one glance.
    heights = [0.36, 0.58, 0.44, 0.78]
    bar_w = pw * 0.14
    gap = (pw - bar_w * 4) / 5
    base = py + ph * 0.82

    for i, h in enumerate(heights):
        x = px + gap + i * (bar_w + gap)
        top = base - ph * 0.62 * h
        colour = ACCENT if i < 3 else ACCENT_DARK
        rounded(d, (x, top, x + bar_w, base), radius=bar_w * 0.35, fill=colour)

    return img.resize((size, size), Image.LANCZOS)


def main():
    for size in (180, 192, 512, 1024):
        worker_icon(size).save(OUT / f"{size}.png", optimize=True)
        owner_icon(size).save(OUT / f"owner-{size}.png", optimize=True)
        print(f"  app/icons/{size}.png, app/icons/owner-{size}.png")
    print(f"done -> {OUT}")


if __name__ == "__main__":
    main()
