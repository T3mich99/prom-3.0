from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) != 8:
    raise SystemExit("usage: compose-hair-card.py OUT_DIR SRC1 SRC2 SRC3 SRC4 SRC5 SKU")

out_dir = Path(sys.argv[1])
srcs = [Path(p) for p in sys.argv[2:7]]
sku = sys.argv[7]
out_dir.mkdir(parents=True, exist_ok=True)

W = H = 1280
FONT = Path(r"C:\Windows\Fonts\arial.ttf")
BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")

def f(path, size):
    return ImageFont.truetype(str(path), size=size)

def square(img):
    img = img.convert("RGB")
    scale = min(W / img.width, H / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (W, H), (247, 246, 244))
    canvas.paste(resized, ((W - resized.width) // 2, (H - resized.height) // 2))
    return canvas

def tx(draw, xy, value, font, fill, spacing=7):
    draw.multiline_text(xy, value, font=font, fill=fill, spacing=spacing)

def main(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((54, 880, 635, 1194), radius=26, fill=(255, 255, 255, 224))
    tx(d, (86, 918), "ІОНІЗАЦІЯ\nДЛЯ УКЛАДКИ", f(BOLD, 53), (19, 47, 82, 255))
    d.text((88, 1090), "Фен для волосся", font=f(FONT, 32), fill=(45, 60, 76, 255))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

def benefits(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((54, 730, 640, 1190), radius=28, fill=(241, 247, 255, 236), outline=(67, 119, 190, 190), width=3)
    tx(d, (92, 776), "КЛЮЧОВІ\nПЕРЕВАГИ", f(BOLD, 46), (26, 71, 133, 255))
    for y, value in [(936, "Функція іонізації"), (1003, "3 температурні режими"), (1070, "Холодний обдув")]:
        d.ellipse((94, y, 126, y + 32), fill=(55, 112, 192, 255))
        d.text((144, y - 3), value, font=f(FONT, 29), fill=(27, 55, 96, 255))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

def features(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((52, 54, 600, 600), radius=28, fill=(255, 255, 255, 224), outline=(63, 105, 165, 170), width=3)
    d.text((90, 104), "ОСОБЛИВОСТІ", font=f(BOLD, 45), fill=(26, 71, 133, 255))
    rows = [("Потужність", "1000 Вт"), ("Живлення", "Мережа 220 В"), ("Температурні режими", "3"), ("Холодний обдув", "Так")]
    y = 210
    for label, value in rows:
        d.text((92, y), label, font=f(FONT, 27), fill=(59, 67, 80, 255))
        d.text((92, y + 34), value, font=f(BOLD, 31), fill=(28, 99, 164, 255))
        y += 92
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

def use(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((52, 48, 670, 280), radius=24, fill=(255, 255, 255, 210))
    d.text((84, 82), "СУШІННЯ ТА УКЛАДАННЯ", font=f(BOLD, 43), fill=(24, 67, 125, 255))
    d.text((86, 158), "Зручне керування вдома", font=f(FONT, 31), fill=(39, 52, 68, 255))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

processors = [main, benefits, features, use, lambda img: img]
names = ["01_main.png", "02_benefits.png", "03_features.png", "04_use.png", "05_details.png"]
for src, name, processor in zip(srcs, names, processors):
    if not src.exists():
        raise FileNotFoundError(src)
    final = processor(square(Image.open(src)))
    final.save(out_dir / name, format="PNG", optimize=True)

print(f"created {len(names)} images for {sku} in {out_dir}")
