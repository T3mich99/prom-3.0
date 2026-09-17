from pathlib import Path
import json
import sys
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) != 4:
    raise SystemExit("usage: compose-product-card-v2.py CONFIG_JSON OUT_DIR SKU")

cfg = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
srcs = [Path(p) for p in cfg["sources"]]
W = H = 1280
FONT = Path(r"C:\Windows\Fonts\arial.ttf")
BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")
INK = tuple(cfg.get("ink", [24, 24, 24])) + (255,)
MUTED = tuple(cfg.get("muted", [54, 54, 54])) + (255,)
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

def heading(d, title, subtitle=None, x=52, y=42, size=48):
    d.multiline_text((x, y), title, font=ft(size, True), fill=INK, spacing=2)
    bbox = d.multiline_textbbox((x, y), title, font=ft(size, True), spacing=2)
    line_y = bbox[3] + 15
    d.rounded_rectangle((x, line_y, x + 82, line_y + 6), radius=3, fill=ACCENT)
    if subtitle:
        d.multiline_text((x, line_y + 20), subtitle, font=ft(27), fill=MUTED, spacing=4)

def callouts(d, items, x=58, y=260, step=82, size=24):
    for item in items[:4]:
        d.ellipse((x, y, x + 48, y + 48), fill=ACCENT)
        d.arc((x + 13, y + 11, x + 35, y + 34), 205, 510, fill=(255, 255, 255, 255), width=3)
        d.line((x + 16, y + 34, x + 31, y + 19), fill=(255, 255, 255, 255), width=3)
        d.multiline_text((x + 65, y + 2), item, font=ft(size), fill=MUTED, spacing=3)
        y += step

def process_main(img):
    def draw(d):
        heading(d, cfg["main_title"], cfg.get("main_subtitle"), size=49)
        callouts(d, cfg.get("main_benefits", []), y=258, step=83, size=23)
    return add_layer(img, draw)

def process_benefits(img):
    def draw(d):
        heading(d, "КЛЮЧОВІ\nПЕРЕВАГИ", size=46)
        callouts(d, cfg.get("benefits", []), y=236, step=78, size=22)
    return add_layer(img, draw)

def process_features(img):
    def draw(d):
        heading(d, "ОСОБЛИВОСТІ", size=46)
        y = 215
        for label, value in cfg.get("features", [])[:5]:
            d.ellipse((58, y + 5, 102, y + 49), fill=ACCENT)
            d.line((72, y + 27, 88, y + 27), fill=(255, 255, 255, 255), width=3)
            d.multiline_text((123, y), f"{label}\n{value}", font=ft(22), fill=MUTED, spacing=2)
            y += 84
    return add_layer(img, draw)

def process_use(img):
    def draw(d):
        heading(d, cfg["use_title"], cfg.get("use_subtitle"), size=46)
    return add_layer(img, draw)

processors = [process_main, process_benefits, process_features, process_use, lambda img: img]
names = ["01_main.png", "02_benefits.png", "03_features.png", "04_use.png", "05_details.png"]
for src, name, processor in zip(srcs, names, processors):
    if not src.exists():
        raise FileNotFoundError(src)
    processor(square(Image.open(src))).save(out_dir / name, format="PNG", optimize=True)

print(f"created 5 images for {sys.argv[3]} in {out_dir}")
