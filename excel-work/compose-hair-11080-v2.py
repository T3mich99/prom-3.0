from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps


out_dir = Path(sys.argv[1])
out_dir.mkdir(parents=True, exist_ok=True)
srcs = [Path(p) for p in sys.argv[2:7]]
if len(srcs) != 5:
    raise SystemExit("expected five source images")

W = H = 1280
FONT = Path(r"C:\Windows\Fonts\arial.ttf")
BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")


def font(path, size):
    return ImageFont.truetype(str(path), size=size)


def fit_square(img):
    img = img.convert("RGB")
    scale = min(W / img.width, H / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (W, H), (248, 246, 243))
    x = (W - resized.width) // 2
    y = (H - resized.height) // 2
    canvas.paste(resized, (x, y))
    return canvas


def text(draw, xy, value, fnt, fill, anchor=None):
    draw.text(xy, value, font=fnt, fill=fill, anchor=anchor, spacing=8)


def overlay_main(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((54, 910, 620, 1195), radius=26, fill=(255, 255, 255, 218))
    text(d, (86, 946), "ПОТУЖНЕ", font(BOLD, 58), (26, 32, 43, 255))
    text(d, (86, 1014), "СУШІННЯ", font(BOLD, 58), (26, 32, 43, 255))
    text(d, (88, 1115), "Фен для волосся", font(FONT, 32), (47, 58, 73, 255))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def overlay_benefits(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((56, 760, 590, 1188), radius=28, fill=(244, 248, 255, 232), outline=(94, 137, 207, 180), width=3)
    text(d, (94, 812), "КЛЮЧОВІ\nПЕРЕВАГИ", font(BOLD, 47), (26, 67, 125, 255))
    bullets = ["2 швидкості", "3 температурні режими", "Холодний обдув"]
    y = 974
    for item in bullets:
        d.ellipse((96, y - 4, 126, y + 26), fill=(55, 111, 191, 255))
        text(d, (142, y - 5), item, font(FONT, 31), (26, 52, 91, 255))
        y += 66
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def overlay_features(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((54, 60, 570, 568), radius=28, fill=(255, 255, 255, 222), outline=(50, 91, 154, 150), width=3)
    text(d, (92, 108), "ОСОБЛИВОСТІ", font(BOLD, 47), (26, 67, 125, 255))
    rows = [("Потужність", "3000 Вт"), ("Живлення", "Мережа 220 В"), ("Швидкості", "2"), ("Температурні режими", "3")]
    y = 220
    for label, value in rows:
        text(d, (94, y), label, font(FONT, 27), (55, 63, 77, 255))
        text(d, (94, y + 34), value, font(BOLD, 32), (24, 97, 156, 255))
        y += 87
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def overlay_use(img):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((52, 52, 630, 260), radius=24, fill=(255, 255, 255, 205))
    text(d, (84, 82), "ЗРУЧНО ВДОМА", font(BOLD, 52), (24, 60, 113, 255))
    text(d, (86, 160), "Для сушіння та укладання волосся", font(FONT, 29), (34, 48, 63, 255))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


processors = [overlay_main, overlay_benefits, overlay_features, overlay_use, lambda x: x]
names = ["01_main.png", "02_benefits.png", "03_features.png", "04_use.png", "05_details.png"]
for src, name, processor in zip(srcs, names, processors):
    final = processor(fit_square(Image.open(src)))
    final.save(out_dir / name, format="PNG", optimize=True)

print(f"created {len(names)} files in {out_dir}")
