"""Galería de maestros: embeddings y color patrón de las fotos buenas de cada SKU."""
from pathlib import Path
import numpy as np
from PIL import Image

from .checks.color_check import zone_lab_means
from .config import ROOT, load_sku_config, list_skus

IMG_EXT = {".png", ".jpg", ".jpeg", ".bmp"}


def build_gallery(embedder, references_dir: str, out_path: str) -> dict:
    embs, labels, color_refs = [], [], {}
    for sku in list_skus():
        files = sorted(p for p in (ROOT / references_dir / sku).glob("*") if p.suffix.lower() in IMG_EXT)
        if not files:
            print(f"[gallery] {sku}: sin fotos maestras, se omite")
            continue
        cfg = load_sku_config(sku)
        labs = []
        for f in files:
            img = Image.open(f)
            embs.append(embedder(img))
            labels.append(sku)
            labs.append(zone_lab_means(img, cfg["zones"]))
        color_refs[f"color__{sku}"] = np.mean(labs, axis=0)
        print(f"[gallery] {sku}: {len(files)} maestros")

    out = ROOT / out_path
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, embeddings=np.array(embs), labels=np.array(labels),
             embedder=np.array(embedder.name), **color_refs)
    return load_gallery(out_path)


def load_gallery(path: str) -> dict:
    d = np.load(ROOT / path)
    return {
        "embeddings": d["embeddings"],
        "labels": d["labels"],
        "embedder": str(d["embedder"]),
        "color": {k.split("__", 1)[1]: d[k] for k in d.files if k.startswith("color__")},
    }
