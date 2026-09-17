from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(r"C:\Users\Dell\Documents\ChatGPT\пром\outputs\bigdrop-hair-50-new-2026-09-09")
MANIFEST = ROOT / "bigdrop-hair-50-manifest.json"
RAW = ROOT / "raw"
FINAL = ROOT / "final"


def font(size: int, bold: bool = False):
    candidates = [
        Path(r"C:\Windows\Fonts\arialbd.ttf") if bold else Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\segoeuib.ttf") if bold else Path(r"C:\Windows\Fonts\segoeui.ttf"),
    ]
    for p in candidates:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def product_kind(name: str) -> str:
    n = name.lower()
    if "праска" in n or "випрям" in n or "straightener" in n:
        return "straightener"
    if "гофре" in n or "гофр" in n:
        return "crimper"
    if "плойка" in n or "curl" in n:
        return "curler"
    if "стайлер" in n or "щітка" in n or "brush" in n or "гребінець" in n:
        return "brush"
    return "dryer"


def captions(item: dict, scene: int):
    name = item["name"]
    kind = product_kind(name)
    n = name.lower()
    if kind == "brush":
        first = ("ФЕН-ЩІТКА ДЛЯ ВОЛОССЯ", "СУШІННЯ ТА УКЛАДАННЯ")
        second = ("ОБ’ЄМ І ФОРМА ВДОМА", "ЗРУЧНО СТВОРЮВАТИ УКЛАДКУ")
    elif kind == "straightener":
        first = ("ВИПРЯМЛЯЧ ДЛЯ ВОЛОССЯ", "ГЛАДКІСТЬ ТА ФОРМА")
        second = ("РІВНЕ ВОЛОССЯ ВДОМА", "КЕРУЙТЕ УКЛАДАННЯМ САМОСТІЙНО")
    elif kind == "crimper":
        first = ("ПЛОЙКА-ГОФРЕ", "ОБ’ЄМ ТА ТЕКСТУРА")
        second = ("ВИРАЗНА ТЕКСТУРА ВОЛОССЯ", "ЗРУЧНИЙ ФОРМАТ ДЛЯ УКЛАДАННЯ")
    elif kind == "curler":
        first = ("ПЛОЙКА ДЛЯ ЛОКОНІВ", "СТВОРЮЙТЕ СВІЙ ОБРАЗ ВДОМА")
        second = ("ГАРНІ ЛОКОНИ ВДОМА", "ДЛЯ РІЗНИХ ВАРІАНТІВ УКЛАДАННЯ")
    else:
        first = ("ФЕН ДЛЯ ВОЛОССЯ", "СУШІННЯ ТА УКЛАДАННЯ")
        second = ("КОМФОРТНЕ СУШІННЯ", "ДЛЯ ДОГЛЯНУТОГО ВИГЛЯДУ ВДОМА")

    if scene == 1:
        return first
    if scene == 2:
        return second
    if scene == 3:
        m = re.search(r"(\d+)\s*[вВ]\s*1", n)
        if m:
            return (f"{m.group(1)} В 1", "ОДИН ПРИСТРІЙ — РІЗНІ ВАРІАНТИ УКЛАДАННЯ")
        if "іонізаці" in n:
            return ("ІОНІЗАЦІЯ", "ФУНКЦІЯ, ЗАЗНАЧЕНА ДЛЯ ЦІЄЇ МОДЕЛІ")
        watts = re.search(r"(\d{3,4})\s*[wWВт]", name)
        if watts:
            return (f"{watts.group(1)} ВТ", "ПІДТВЕРДЖЕНА ПОТУЖНІСТЬ МОДЕЛІ")
        return ("ПРОДУМАНА КОНСТРУКЦІЯ", "УСІ ВАЖЛИВІ ДЕТАЛІ — У КАДРІ")
    if scene == 4:
        return ("УКЛАДАННЯ ВДОМА", "ЗРУЧНО ДЛЯ ЩОДЕННОЇ Б’ЮТІ-РУТИНИ")
    return ("РОЗГЛЯНЬТЕ КОЖНУ ДЕТАЛЬ", "ФОРМА, КЕРУВАННЯ ТА РОБОЧА ЧАСТИНА")


def draw_text(im: Image.Image, item: dict, scene: int) -> Image.Image:
    im = im.convert("RGB").resize((1280, 1280), Image.Resampling.LANCZOS)
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    headline, subline = captions(item, scene)
    # A translucent cream panel keeps the copy readable on any approved scene.
    d.rounded_rectangle((32, 32, 718, 310), radius=26, fill=(247, 239, 226, 226))
    d.rounded_rectangle((52, 54, 116, 102), radius=15, fill=(66, 54, 47, 235))
    d.text((84, 61), f"{scene:02d}", font=font(27, True), anchor="ma", fill=(255, 250, 244, 255))
    d.rectangle((58, 198, 158, 208), fill=(159, 77, 68, 255))
    d.text((58, 122), headline, font=font(49, True), fill=(18, 18, 18, 255), spacing=2)
    d.text((58, 222), subline, font=font(24, False), fill=(45, 39, 35, 255), spacing=4)
    return Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")


def main():
    items = json.loads(MANIFEST.read_text(encoding="utf-8"))
    FINAL.mkdir(parents=True, exist_ok=True)
    done = 0
    missing = []
    for item in items:
        folder = RAW / f"{item['index']:03d}_{re.sub(r'[^A-Za-z0-9_-]', '_', item['code'])}"
        out_folder = FINAL / folder.name
        out_folder.mkdir(parents=True, exist_ok=True)
        for scene, suffix in enumerate(["main", "benefit", "features", "use", "detail"], start=1):
            source = folder / f"{scene:02d}_{suffix}.png"
            if scene == 3 and not source.exists():
                source = folder / "03_feature.png"
            if not source.exists():
                missing.append(str(source))
                continue
            out = out_folder / source.name
            draw_text(Image.open(source), item, scene).save(out, format="PNG", optimize=True)
            done += 1
    (ROOT / "ua-text-report.json").write_text(json.dumps({"rendered": done, "missing": missing}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"rendered={done} missing={len(missing)}")


if __name__ == "__main__":
    main()
