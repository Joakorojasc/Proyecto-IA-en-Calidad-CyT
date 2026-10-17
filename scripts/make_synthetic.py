"""Genera etiquetas sintéticas (maestras, buenas, SKU equivocado y color alterado) y sus recetas."""
import random
import shutil
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
H, W = 256, 384
rng = random.Random(42)

SKUS = {
    "FRONTERA_CHARD":  dict(bg=(245, 243, 235), band=(196, 170, 60),  title="FRONTERA", variety="CHARDONNAY"),
    "FRONTERA_CAB":    dict(bg=(245, 243, 235), band=(120, 30, 45),   title="FRONTERA", variety="CABERNET"),
    "CASILLERO_MERLOT": dict(bg=(25, 25, 30),   band=(150, 40, 60),   title="CASILLERO", variety="MERLOT"),
}
# Zonas de color plano, sin texto ni bordes.
ZONES = {
    "fondo":   [0.05, 0.05, 0.12, 0.95],
    "franja":  [0.72, 0.13, 0.78, 0.28],
    "montana": [0.50, 0.40, 0.58, 0.60],
}

try:
    FONT = ImageFont.truetype("DejaVuSans-Bold.ttf", 28)
    FONT_S = ImageFont.truetype("DejaVuSans.ttf", 16)
except OSError:
    FONT = FONT_S = ImageFont.load_default()


def draw_label(spec: dict, band_color=None, bg_color=None) -> Image.Image:
    bg = bg_color or spec["bg"]
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    fg = (20, 20, 20) if sum(bg) > 380 else (235, 235, 235)
    d.text((W // 2, 60), spec["title"], fill=fg, font=FONT, anchor="mm")
    d.polygon([(70, 160), (150, 95), (200, 135), (260, 85), (320, 160)], fill=(70, 75, 80))
    d.rectangle([int(0.10 * W), int(0.70 * H), int(0.90 * W), int(0.80 * H)], fill=band_color or spec["band"])
    d.text((W // 2, int(0.75 * H)), spec["variety"], fill=(250, 250, 250), font=FONT_S, anchor="mm")
    d.text((W // 2, 232), "RESERVA  ·  CHILE  ·  750 ml", fill=fg, font=FONT_S, anchor="mm")
    return img


def camera(img: Image.Image) -> Image.Image:
    """Simula variación normal de cámara/línea: corrimiento, luz, ruido y algo de desenfoque."""
    dx, dy = rng.randint(-4, 4), rng.randint(-3, 3)
    img = img.transform(img.size, Image.AFFINE, (1, 0, dx, 0, 1, dy), fillcolor=img.getpixel((2, 2)))
    a = np.asarray(img, dtype=np.float32) * rng.uniform(0.97, 1.03)
    a += np.random.default_rng(rng.randint(0, 10**6)).normal(0, 3, a.shape)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return img.filter(ImageFilter.GaussianBlur(rng.uniform(0, 0.8)))


def shift_color(c, amount=22):
    """Corre el color lo suficiente para ser defecto (ΔE ~ 8-15)."""
    ch = rng.randrange(3)
    c = list(c)
    c[ch] = int(np.clip(c[ch] + rng.choice([-1, 1]) * amount, 0, 255))
    return tuple(c)


def save(img, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def main(n_refs=15, n_ok=40, n_bad=15):
    for p in ["data/references", "data/test"]:
        shutil.rmtree(ROOT / p, ignore_errors=True)
    for f in (ROOT / "configs/skus").glob("*.yaml"):
        f.unlink()

    names = list(SKUS)
    for sku, spec in SKUS.items():
        cfg = {
            "sku": sku,
            "description": f"{spec['title']} {spec['variety']} (sintético)",
            "zone_names": list(ZONES),
            "zones": list(ZONES.values()),
            "delta_e_max": 5.0,
            "sim_min": 0.80,
        }
        with open(ROOT / f"configs/skus/{sku}.yaml", "w") as f:
            yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)

        for i in range(n_refs):
            save(camera(draw_label(spec)), ROOT / f"data/references/{sku}/ref_{i:02d}.png")
        for i in range(n_ok):
            save(camera(draw_label(spec)), ROOT / f"data/test/ok/{sku}__{i:03d}.png")
        for i in range(n_bad):
            other = SKUS[rng.choice([s for s in names if s != sku])]
            save(camera(draw_label(other)), ROOT / f"data/test/wrong_sku/{sku}__{i:03d}.png")
            if rng.random() < 0.5:
                img = draw_label(spec, band_color=shift_color(spec["band"]))
            else:
                img = draw_label(spec, bg_color=shift_color(spec["bg"]))
            save(camera(img), ROOT / f"data/test/bad_color/{sku}__{i:03d}.png")

    print(f"Listo: {len(SKUS)} SKUs, {n_refs} maestros c/u, test = {n_ok} ok + {n_bad} wrong_sku + {n_bad} bad_color por SKU")


if __name__ == "__main__":
    main(*map(int, sys.argv[1:]))
