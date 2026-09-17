from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(r"C:\Users\Dell\Documents\ChatGPT\пром\outputs\hair-styling-master-prompt-2026-09-08\batch-100-v2")
MANIFEST = ROOT / "batch-100-v2-manifest.json"
RAW = ROOT / "raw"
FINAL = ROOT / "final-1280"
FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"
FONT_REG = r"C:\Windows\Fonts\arial.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def kind(name: str) -> str:
    s = name.lower()
    if "фен-щіт" in s or "фен щіт" in s:
        return "brush"
    if "фен" in s:
        return "dryer"
    if "випрям" in s:
        return "straightener"
    if "плойк" in s:
        return "curler"
    return "styler"


def accent(name: str) -> str:
    s = name.lower()
    if "іонізаці" in s:
        return "ІОНІЗАЦІЯ"
    if "складан" in s:
        return "СКЛАДНИЙ ФОРМАТ"
    if "потрійн" in s:
        return "ПОТРІЙНА ФОРМА"
    if "автоматич" in s:
        return "АВТОМАТИЧНА УКЛАДКА"
    if "кераміч" in s:
        return "КЕРАМІЧНЕ ПОКРИТТЯ"
    if "5 в 1" in s or "6 в 1" in s or "7 в 1" in s or "10 в 1" in s:
        return re.search(r"\d+ в 1", s).group(0).upper()
    return "ЗРУЧНЕ КЕРУВАННЯ"


def copy_for(name: str) -> List[Tuple[str, str]]:
    k = kind(name)
    a = accent(name)
    if k == "dryer":
        return [
            ("ФЕН ДЛЯ ВОЛОССЯ", "СУШІННЯ ТА УКЛАДАННЯ"),
            ("ЗРУЧНО ВДОМА", "ДЛЯ ЩОДЕННОГО СУШІННЯ"),
            (a, "ФУНКЦІЇ ПІД РУКОЮ"),
            ("УКЛАДАННЯ БЕЗ ЗАЙВИХ ЗУСИЛЬ", "КОМФОРТНИЙ РИТМ ЩОДНЯ"),
            ("ПРОДУМАНА КОНСТРУКЦІЯ", "ДЕТАЛІ, ЯКІ ВАЖЛИВІ"),
        ]
    if k == "brush":
        return [
            ("ФЕН-ЩІТКА ДЛЯ ВОЛОССЯ", "СУШІННЯ ТА ФОРМА"),
            ("ОБʼЄМ ОДНИМ РУХОМ", "ЗРУЧНО ДЛЯ ДОМАШНЬОЇ УКЛАДКИ"),
            (a, "ПІДБЕРИ СВІЙ СПОСІБ УКЛАДАННЯ"),
            ("УКЛАДАННЯ ВДОМА", "ДЛЯ РІЗНИХ ОБРАЗІВ"),
            ("НАСАДКИ ПІД ЗАДАЧУ", "КОМПЛЕКТАЦІЯ ТОВАРУ"),
        ]
    if k == "straightener":
        return [
            ("ВИПРЯМЛЯЧ ДЛЯ ВОЛОССЯ", "ГЛАДКЕ ВОЛОССЯ ВДОМА"),
            ("РІВНА УКЛАДКА", "ЗРУЧНО ДЛЯ ЩОДЕННОГО ОБРАЗУ"),
            (a, "ДОГЛЯНУТИЙ ВИГЛЯД ВОЛОССЯ"),
            ("УКЛАДАННЯ БЕЗ ЗАЙВИХ ЗУСИЛЬ", "КОНТРОЛЮЙ КОЖЕН РУХ"),
            ("ДЕТАЛІ МАЮТЬ ЗНАЧЕННЯ", "ФОРМА ТА КЕРУВАННЯ ПІД РУКОЮ"),
        ]
    if k == "curler":
        return [
            ("ПЛОЙКА ДЛЯ ЛОКОНІВ", "СТВОРЮЙ СВІЙ ОБРАЗ ВДОМА"),
            ("ГАРНІ ЛОКОНИ", "ЛЕГКА УКЛАДКА ДЛЯ ЩОДНЯ"),
            (a, "ПІДБЕРИ БАЖАНУ ФОРМУ"),
            ("УКЛАДАННЯ ВДОМА", "КРАСИВИЙ РЕЗУЛЬТАТ У ЗВИЧНОМУ РИТМІ"),
            ("ФОРМА, ЯКА ПОМІТНА", "АКУРАТНІ ДЕТАЛІ ТОВАРУ"),
        ]
    return [
        ("СТАЙЛЕР ДЛЯ ВОЛОССЯ", "УКЛАДАННЯ ВДОМА"),
        ("ОДИН ПРИСТРІЙ", "ДЛЯ РІЗНИХ ОБРАЗІВ"),
        (a, "ЗРУЧНЕ КЕРУВАННЯ"),
        ("ТВІЙ СТИЛЬ ЩОДНЯ", "ПРАКТИЧНЕ РІШЕННЯ ДЛЯ ВОЛОССЯ"),
        ("ПРОДУМАНІ ДЕТАЛІ", "ФОРМА ТА ФУНКЦІОНАЛЬНІСТЬ"),
    ]


def fit_text(draw: ImageDraw.ImageDraw, text: str, max_width: int, start: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    fp = FONT_BOLD if bold else FONT_REG
    size = start
    while size > 28:
        f = font(fp, size)
        if draw.textbbox((0, 0), text, font=f)[2] <= max_width:
            return f
        size -= 2
    return font(fp, 28)


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, max_width: int) -> List[str]:
    words = text.split()
    lines: List[str] = []
    cur = ""
    for word in words:
        trial = word if not cur else cur + " " + word
        if draw.textbbox((0, 0), trial, font=f)[2] <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_text_block(im: Image.Image, headline: str, subline: str, scene: int) -> Image.Image:
    im = im.convert("RGB").resize((1280, 1280), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    left = 58
    top = 48
    max_width = 600 if scene != 5 else 500
    # Light translucent panel keeps text readable but leaves the product visible.
    panel_h = 245 if scene in (1, 2, 4) else 220
    d.rounded_rectangle((28, 28, left + max_width + 34, top + panel_h), radius=24, fill=(250, 243, 234, 214))
    d.rounded_rectangle((28, 28, 49, top + panel_h), radius=10, fill=(154, 76, 70, 255))
    badge = font(FONT_BOLD, 28)
    d.rounded_rectangle((left, top, left + 65, top + 42), radius=12, fill=(82, 67, 57, 230))
    d.text((left + 16, top + 4), f"0{scene}", font=badge, fill=(255, 255, 255, 255))
    y = top + 62
    hf = fit_text(d, headline, max_width, 58, True)
    for line in wrap(d, headline, hf, max_width):
        d.text((left, y), line, font=hf, fill=(20, 18, 17, 255), stroke_width=0)
        y += hf.size + 2
    y += 10
    d.rounded_rectangle((left, y, left + 82, y + 8), radius=4, fill=(154, 76, 70, 255))
    y += 22
    sf = fit_text(d, subline, max_width, 29, False)
    for line in wrap(d, subline, sf, max_width):
        d.text((left, y), line, font=sf, fill=(50, 43, 38, 255))
        y += sf.size + 6
    return Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB")


def main() -> None:
    FINAL.mkdir(parents=True, exist_ok=True)
    rows = json.loads(MANIFEST.read_text(encoding="utf-8"))
    made = 0
    for row in rows:
        raw_dir = RAW / f"{row['index']:03d}_{row['bare']}"
        if not raw_dir.exists():
            continue
        out_dir = FINAL / f"{row['index']:03d}_{row['bare']}"
        out_dir.mkdir(parents=True, exist_ok=True)
        captions = copy_for(row["name"])
        for scene, (headline, subline) in enumerate(captions, start=1):
            src = raw_dir / ["01_main.png", "02_benefit.png", "03_feature.png", "04_use.png", "05_detail.png"][scene - 1]
            if not src.exists():
                continue
            out = out_dir / src.name
            draw_text_block(Image.open(src), headline, subline, scene).save(out, format="PNG", optimize=True)
            made += 1
    print(json.dumps({"images_written": made, "final_root": str(FINAL)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
