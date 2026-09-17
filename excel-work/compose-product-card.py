from pathlib import Path
import json
import sys
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) != 4:
    raise SystemExit("usage: compose-product-card.py CONFIG_JSON OUT_DIR SKU")

config_path = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
sku = sys.argv[3]
cfg = json.loads(config_path.read_text(encoding="utf-8"))
srcs = [Path(p) for p in cfg["sources"]]
out_dir.mkdir(parents=True, exist_ok=True)

W = H = 1280
FONT = Path(r"C:\Windows\Fonts\arial.ttf")
BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")

def font(path, size):
    return ImageFont.truetype(str(path), size=size)

def square(img):
    img = img.convert("RGB")
    scale = min(W / img.width, H / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (W, H), (247, 246, 244))
    canvas.paste(resized, ((W - resized.width) // 2, (H - resized.height) // 2))
    return canvas

def text(draw, xy, value, size, fill, bold=False, spacing=7):
    draw.multiline_text(xy, value, font=font(BOLD if bold else FONT, size), fill=fill, spacing=spacing)

def composite(img, draw_fn):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

def main(img):
    def draw(d):
        d.rounded_rectangle((54, 864, 650, 1190), radius=28, fill=(255, 255, 255, 232))
        text(d, (88, 905), cfg["main_title"], 52, (18, 46, 82, 255), True)
        text(d, (90, 1080), cfg.get("main_subtitle", ""), 31, (45, 60, 76, 255))
    return composite(img, draw)

def benefits(img):
    def draw(d):
        d.rounded_rectangle((52, 710, 650, 1190), radius=28, fill=(241, 247, 255, 236), outline=(67, 119, 190, 190), width=3)
        text(d, (90, 754), "КЛЮЧОВІ\nПЕРЕВАГИ", 46, (26, 71, 133, 255), True)
        y = 908
        for value in cfg.get("benefits", [])[:4]:
            d.ellipse((94, y, 132, y + 38), fill=(55, 112, 192, 255))
            text(d, (151, y - 3), value, 28, (27, 55, 96, 255))
            y += 66
    return composite(img, draw)

def features(img):
    def draw(d):
        d.rounded_rectangle((52, 50, 500, 650), radius=28, fill=(255, 255, 255, 246), outline=(63, 105, 165, 170), width=3)
        text(d, (90, 100), "ОСОБЛИВОСТІ", 45, (26, 71, 133, 255), True)
        y = 196
        for label, value in cfg.get("features", [])[:5]:
            text(d, (92, y), label, 25, (59, 67, 80, 255))
            text(d, (92, y + 31), value, 29, (28, 99, 164, 255), True)
            y += 92
    return composite(img, draw)

def use(img):
    def draw(d):
        d.rounded_rectangle((52, 48, 680, 335), radius=24, fill=(255, 255, 255, 222))
        text(d, (84, 82), cfg["use_title"], 40, (24, 67, 125, 255))
        text(d, (86, 220), cfg.get("use_subtitle", ""), 30, (39, 52, 68, 255))
    return composite(img, draw)

processors = [main, benefits, features, use, lambda img: img]
names = ["01_main.png", "02_benefits.png", "03_features.png", "04_use.png", "05_details.png"]
for src, name, processor in zip(srcs, names, processors):
    if not src.exists():
        raise FileNotFoundError(src)
    final = processor(square(Image.open(src)))
    final.save(out_dir / name, format="PNG", optimize=True)

print(f"created {len(names)} images for {sku} in {out_dir}")
