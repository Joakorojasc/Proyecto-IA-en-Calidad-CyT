"""Carga de configuración de línea y de recetas por SKU."""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]


def load_line_config(path: str = "configs/line.yaml") -> dict:
    with open(ROOT / path) as f:
        return yaml.safe_load(f)


def load_sku_config(sku: str) -> dict:
    """Zonas de color en fracciones [y0, x0, y1, x1] y umbrales del SKU."""
    with open(ROOT / "configs" / "skus" / f"{sku}.yaml") as f:
        return yaml.safe_load(f)


def list_skus() -> list[str]:
    return sorted(p.stem for p in (ROOT / "configs" / "skus").glob("*.yaml"))
