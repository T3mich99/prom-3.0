from pathlib import Path
import json
import sys
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) != 4:
    raise SystemExit("usage: compose-product-card-v4.py CONFIG_JSON OUT_DIR SKU")

cfg = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
srcs = [Path(p) for p in cfg["sources"]]
W = H = 1280
FONT = Path(r"C:\Windows\Fonts\arial.ttf")
BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")
INK = tuple(cfg.get("ink", [20, 20, 20])) + (255,)
MUTED = tuple(cfg.get("muted", [52, 52, 52])) + (255,)
ACCENT = tuple(cfg.get("accent", [164, 79, 79])) + (255,)

def ft(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else FONT), size=size)

def square(img):
    img = img.convert("RGB")
    if img.size == (W, H):
        return img
    scale = max(W / img.width, H / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - W) // 2)
    top = max(0, (resized.height - H) // 2)
    return resized.crop((left, top, left + W, top + H))

def add_layer(img, fn):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fn(ImageDraw.Draw(layer))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

def text_block(d, block):
    title = block["title"]
    subtitle = block.get("subtitle")
    layout = block.get("layout", "left-top")
    size = block.get("size", 50)
    color = tuple(block.get("color", cfg.get("ink", [20, 20, 20]))) + (255,)
    muted = tuple(block.get("muted", cfg.get("muted", [52, 52, 52]))) + (255,)
    title_font = ft(size, True)
    sub_font = ft(block.get("subtitle_size", 28), False)
    if layout == "left-bottom":
        x, y = 54, 930
        align = "left"
    elif layout == "right-top":
        x, y = 1228, 52
        align = "right"
    elif layout == "right-bottom":
        x, y = 1228, 900
        align = "right"
    else:
        x, y = 48, 48
        align = "left"
    d.multiline_text((x, y), title, font=title_font, fill=color, spacing=0, align=align, anchor="ra" if align == "right" else None)
    bbox = d.multiline_textbbox((x, y), title, font=title_font, spacing=0, align=align, anchor="ra" if align == "right" else None)
    line_y = bbox[3] + 14
    if align == "right":
        d.rounded_rectangle((x - 76, line_y, x, line_y + 6), radius=3, fill=ACCENT)
    else:
        d.rounded_rectangle((x, line_y, x + 76, line_y + 6), radius=3, fill=ACCENT)
    if subtitle:
        sy = line_y + 18
        d.multiline_text((x, sy), subtitle, font=sub_font, fill=muted, spacing=3, align=align, anchor="ra" if align == "right" else None)

def process(img, block):
    return add_layer(img, lambda d: text_block(d, block))

names = ["01_main.png", "02_result.png", "03_control.png", "04_use.png", "05_detail.png"]
for src, name, block in zip(srcs, names, cfg["blocks"]):
    if not src.exists():
        raise FileNotFoundError(src)
    process(square(Image.open(src)), block).save(out_dir / name, format="PNG", optimize=True)

print(f"created 5 scenario images for {sys.argv[3]} in {out_dir}")
