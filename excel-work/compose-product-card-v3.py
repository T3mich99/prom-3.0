from pathlib import Path
import json
import sys
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) != 4:
    raise SystemExit("usage: compose-product-card-v3.py CONFIG_JSON OUT_DIR SKU")

cfg = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
srcs = [Path(p) for p in cfg["sources"]]
W = H = 1280
FONT = Path(r"C:\Windows\Fonts\arial.ttf")
BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")
INK = tuple(cfg.get("ink", [22, 22, 22])) + (255,)
MUTED = tuple(cfg.get("muted", [55, 55, 55])) + (255,)
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

def heading(d, title, subtitle=None, x=48, y=44, size=52):
    d.multiline_text((x, y), title, font=ft(size, True), fill=INK, spacing=0)
    bbox = d.multiline_textbbox((x, y), title, font=ft(size, True), spacing=0)
    line_y = bbox[3] + 14
    d.rounded_rectangle((x, line_y, x + 76, line_y + 6), radius=3, fill=ACCENT)
    if subtitle:
        d.multiline_text((x, line_y + 18), subtitle, font=ft(28), fill=MUTED, spacing=3)

def tiny_marker(d, x, y):
    d.ellipse((x, y, x + 34, y + 34), fill=ACCENT)
    d.line((x + 10, y + 17, x + 24, y + 17), fill=(255, 255, 255, 255), width=3)

def one_message(d, title, subtitle=None, x=48, y=44, size=50, marker=False):
    heading(d, title, None, x=x, y=y, size=size)
    if subtitle:
        bbox = d.multiline_textbbox((x, y), title, font=ft(size, True), spacing=0)
        line_y = bbox[3] + 14
        d.rounded_rectangle((x, line_y, x + 76, line_y + 6), radius=3, fill=ACCENT)
        if marker:
            tiny_marker(d, x, line_y + 28)
            d.multiline_text((x + 49, line_y + 26), subtitle, font=ft(28), fill=MUTED, spacing=3)
        else:
            d.multiline_text((x, line_y + 18), subtitle, font=ft(28), fill=MUTED, spacing=3)

def process_main(img):
    return add_layer(img, lambda d: one_message(d, cfg["main_title"], cfg.get("main_subtitle"), size=50))

def process_benefits(img):
    return add_layer(img, lambda d: one_message(d, cfg["benefit_title"], cfg.get("benefit_subtitle"), size=50))

def process_features(img):
    return add_layer(img, lambda d: one_message(d, cfg["feature_title"], cfg.get("feature_subtitle"), size=48, marker=cfg.get("feature_marker", False)))

def process_use(img):
    return add_layer(img, lambda d: one_message(d, cfg["use_title"], cfg.get("use_subtitle"), size=48))

def process_detail(img):
    return add_layer(img, lambda d: one_message(d, cfg["detail_title"], cfg.get("detail_subtitle"), size=44))

processors = [process_main, process_benefits, process_features, process_use, process_detail]
names = ["01_main.png", "02_benefits.png", "03_features.png", "04_use.png", "05_details.png"]
for src, name, processor in zip(srcs, names, processors):
    if not src.exists():
        raise FileNotFoundError(src)
    processor(square(Image.open(src))).save(out_dir / name, format="PNG", optimize=True)

print(f"created 5 images for {sys.argv[3]} in {out_dir}")
