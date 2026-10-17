"""¿El color está bien? ΔE (CIE76) por zona contra el color patrón: sqrt(ΔL² + Δa² + Δb²)."""
import numpy as np
from PIL import Image
from skimage.color import rgb2lab


def zone_lab_means(img: Image.Image, zones: list[list[float]]) -> np.ndarray:
    """Color promedio (L, a, b) de cada zona. Devuelve array (n_zonas, 3)."""
    lab = rgb2lab(np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0)
    h, w = lab.shape[:2]
    out = []
    for y0, x0, y1, x1 in zones:
        patch = lab[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
        out.append(patch.reshape(-1, 3).mean(axis=0))
    return np.array(out)


def check_color(img: Image.Image, ref_lab: np.ndarray, sku_cfg: dict) -> dict:
    """Compara el color de cada zona contra la referencia del SKU."""
    lab = zone_lab_means(img, sku_cfg["zones"])
    de = np.sqrt(((lab - ref_lab) ** 2).sum(axis=1))
    worst = int(de.argmax())
    ok = bool(de.max() <= sku_cfg["delta_e_max"])
    return {
        "color_ok": ok,
        "delta_e_max": round(float(de.max()), 2),
        "worst_zone": sku_cfg.get("zone_names", [str(i) for i in range(len(de))])[worst],
    }
