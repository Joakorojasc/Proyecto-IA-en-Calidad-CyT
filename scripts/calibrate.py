"""Fija los umbrales de cada SKU comparando cada maestro contra el resto (leave-one-out)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import yaml
from PIL import Image

from inspector.checks.color_check import zone_lab_means
from inspector.config import ROOT, list_skus, load_line_config, load_sku_config
from inspector.embedder import get_embedder

MARGIN_DE, FLOOR_DE = 1.5, 3.0
SLACK_SIM = 0.05

if __name__ == "__main__":
    cfg = load_line_config()
    emb = get_embedder(cfg["embedder"])
    for sku in list_skus():
        files = sorted((ROOT / cfg["paths"]["references"] / sku).glob("*"))
        if len(files) < 3:
            print(f"{sku}: muy pocos maestros para calibrar")
            continue
        sc = load_sku_config(sku)
        imgs = [Image.open(f) for f in files]
        labs = np.array([zone_lab_means(i, sc["zones"]) for i in imgs])
        E = np.array([emb(i) for i in imgs])

        des, sims = [], []
        for k in range(len(imgs)):
            rest = np.delete(np.arange(len(imgs)), k)
            ref = labs[rest].mean(axis=0)
            des.append(np.sqrt(((labs[k] - ref) ** 2).sum(axis=1)).max())
            sims.append((E[rest] @ E[k]).max())

        sc["delta_e_max"] = round(max(FLOOR_DE, float(max(des)) * MARGIN_DE), 2)
        sc["sim_min"] = round(float(min(sims)) - SLACK_SIM, 3)
        with open(ROOT / f"configs/skus/{sku}.yaml", "w") as f:
            yaml.safe_dump(sc, f, sort_keys=False, allow_unicode=True)
        print(f"{sku}: ΔE buenas máx={max(des):.2f} -> delta_e_max={sc['delta_e_max']} | "
              f"sim buenas mín={min(sims):.3f} -> sim_min={sc['sim_min']}")
    print("Recuerda volver a correr build_gallery si cambiaste maestros.")
