"""Recibe una foto y el SKU en producción, y decide OK o RECHAZO."""
import time
from dataclasses import dataclass, field, asdict
from PIL import Image

from .checks.color_check import check_color
from .checks.sku_check import check_sku
from .config import load_sku_config
from .embedder import get_embedder
from .gallery import load_gallery


@dataclass
class Result:
    bottle_id: str
    expected_sku: str
    decision: str
    reasons: list = field(default_factory=list)
    details: dict = field(default_factory=dict)
    latency_ms: float = 0.0

    def row(self) -> dict:
        d = asdict(self)
        d["reasons"] = "|".join(self.reasons)
        d.update(d.pop("details"))
        return d


class Inspector:
    def __init__(self, line_cfg: dict):
        self.cfg = line_cfg
        self.methods = line_cfg["methods"]
        self.gallery = load_gallery(line_cfg["paths"]["gallery"])
        self.embedder = get_embedder(line_cfg["embedder"])
        if self.embedder.name != self.gallery["embedder"]:
            raise RuntimeError(f"La galería se armó con '{self.gallery['embedder']}' y el embedder actual es "
                               f"'{self.embedder.name}'. Vuelve a correr build_gallery.")
        self._sku_cache = {}

    def sku_cfg(self, sku: str) -> dict:
        if sku not in self._sku_cache:
            self._sku_cache[sku] = load_sku_config(sku)
        return self._sku_cache[sku]

    def inspect(self, img: Image.Image, expected_sku: str, bottle_id: str = "") -> Result:
        t0 = time.perf_counter()
        cfg = self.sku_cfg(expected_sku)
        reasons, details = [], {}

        if self.methods.get("sku_check"):
            r = check_sku(self.embedder(img), self.gallery, expected_sku, cfg)
            details.update(r)
            if not r["sku_ok"]:
                reasons.append("SKU_INCORRECTO" if r["sku_predicted"] != expected_sku else "DISENO_DISTINTO")

        if self.methods.get("color_check"):
            r = check_color(img, self.gallery["color"][expected_sku], cfg)
            details.update(r)
            if not r["color_ok"]:
                reasons.append(f"COLOR_FUERA_DE_TOLERANCIA:{r['worst_zone']}")

        return Result(
            bottle_id=bottle_id,
            expected_sku=expected_sku,
            decision="RECHAZO" if reasons else "OK",
            reasons=reasons,
            details=details,
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
        )
