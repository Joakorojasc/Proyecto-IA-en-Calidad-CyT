"""Dibuja las zonas de color de un SKU sobre una maestra. Uso: python scripts/preview_zones.py JUICE_BOTTLE"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from PIL import Image, ImageDraw
from inspector.config import ROOT, load_sku_config

sku = sys.argv[1]
cfg = load_sku_config(sku)
ref = sorted((ROOT / "data/references" / sku).glob("*"))[0]
img = Image.open(ref).convert("RGB")
d = ImageDraw.Draw(img)
w, h = img.size
for name, (y0, x0, y1, x1) in zip(cfg["zone_names"], cfg["zones"]):
    box = [x0 * w, y0 * h, x1 * w, y1 * h]
    d.rectangle(box, outline=(255, 200, 0), width=max(2, w // 200))
    d.text((box[0] + 4, box[1] - 14), name, fill=(255, 200, 0))
out = ROOT / f"outputs/zonas_{sku}.png"
out.parent.mkdir(exist_ok=True)
img.save(out)
print(f"Revisa {out.relative_to(ROOT)}")
