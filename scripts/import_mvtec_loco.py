"""Importa juice_bottle de MVTec LOCO AD (archivo .tar.xz o carpeta) a data/references y data/test.

Uso: python scripts/import_mvtec_loco.py RUTA/mvtec_loco_anomaly_detection.tar.xz
"""
import argparse
import shutil
import tarfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKU = "JUICE_BOTTLE"
MAP = {"good": "ok", "logical_anomalies": "logica", "structural_anomalies": "estructural"}

# Zonas iniciales supuestas: revisarlas con preview_zones.py.
DEFAULT_CFG = {
    "sku": SKU,
    "description": "MVTec LOCO AD juice_bottle (datos públicos, uso no comercial)",
    "zone_names": ["jugo", "etiqueta_central", "etiqueta_inferior"],
    "zones": [[0.30, 0.42, 0.40, 0.58], [0.50, 0.40, 0.62, 0.60], [0.74, 0.40, 0.84, 0.60]],
    "delta_e_max": 5.0,
    "sim_min": 0.80,
}


def find_category(src: Path) -> Path:
    hits = [p for p in src.rglob("juice_bottle") if (p / "train").is_dir()]
    if not hits:
        raise SystemExit(f"No encontré juice_bottle/train dentro de {src}")
    return hits[0]


def extract_juice(tar_path: Path, dest: Path) -> Path:
    print(f"Descomprimiendo solo juice_bottle de {tar_path.name} (puede tardar)...")
    with tarfile.open(tar_path) as tf:
        members = [m for m in tf.getmembers() if "/juice_bottle/" in f"/{m.name}"]
        tf.extractall(dest, members=members, filter="data")
    return find_category(dest)


def copy_set(files, out_dir: Path, prefix: str):
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(files):
        shutil.copy2(f, out_dir / f"{prefix}__{i:03d}{f.suffix.lower()}")
    return len(files)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path, help="carpeta descomprimida o archivo .tar.xz de MVTec LOCO")
    ap.add_argument("--n-refs", type=int, default=20, help="cuántas fotos buenas usar como maestras")
    args = ap.parse_args()

    src = args.src.expanduser().resolve()
    cat = extract_juice(src, ROOT / "data/_raw") if src.is_file() else find_category(src)

    for p in ["data/references", "data/test"]:
        shutil.rmtree(ROOT / p, ignore_errors=True)

    imgs = lambda d: sorted(p for p in d.glob("*") if p.suffix.lower() in {".png", ".jpg", ".jpeg"})
    n_ref = copy_set(imgs(cat / "train/good")[: args.n_refs], ROOT / f"data/references/{SKU}", "ref")
    counts = {}
    for loco_name, our_name in MAP.items():
        d = cat / "test" / loco_name
        if d.is_dir():
            counts[our_name] = copy_set(imgs(d), ROOT / f"data/test/{our_name}", SKU)

    cfg_path = ROOT / f"configs/skus/{SKU}.yaml"
    if not cfg_path.exists():
        with open(cfg_path, "w") as f:
            yaml.safe_dump(DEFAULT_CFG, f, sort_keys=False, allow_unicode=True)

    print(f"Maestras: {n_ref} | test: {counts}")
    print("Siguiente: python scripts/preview_zones.py JUICE_BOTTLE  (revisar zonas)")
    print("           python scripts/build_gallery.py && python scripts/calibrate.py && python scripts/evaluate.py")


if __name__ == "__main__":
    main()
