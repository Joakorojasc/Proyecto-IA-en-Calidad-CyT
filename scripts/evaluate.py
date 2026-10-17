"""Corre el inspector sobre data/test y compara los métodos: falsos rechazos y detección por tipo."""
import csv
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from PIL import Image
from inspector.config import ROOT, load_line_config
from inspector.pipeline import Inspector

COMBOS = {
    "solo_sku":   {"sku_check": True,  "color_check": False},
    "solo_color": {"sku_check": False, "color_check": True},
    "ambas":      {"sku_check": True,  "color_check": True},
}


def load_test_set():
    items = []
    for truth_dir in sorted((ROOT / "data/test").iterdir()):
        for f in sorted(truth_dir.glob("*.png")) + sorted(truth_dir.glob("*.jpg")):
            items.append((f, truth_dir.name, f.stem.split("__")[0]))
    return items


def run(combo_name, methods, items, base_cfg, detail):
    cfg = {**base_cfg, "methods": methods}
    insp = Inspector(cfg)
    by_truth = defaultdict(lambda: [0, 0])
    lat = []
    for f, truth, sku in items:
        r = insp.inspect(Image.open(f), sku, bottle_id=f.name)
        by_truth[truth][0] += r.decision == "RECHAZO"
        by_truth[truth][1] += 1
        lat.append(r.latency_ms)
        detail.append({"combo": combo_name, "truth": truth, **r.row()})

    ok_rej, ok_tot = by_truth["ok"]
    bad = [(t, *v) for t, v in by_truth.items() if t != "ok"]
    return {
        "metodo": combo_name,
        "falso_rechazo": f"{ok_rej}/{ok_tot} ({100*ok_rej/ok_tot:.1f}%)",
        **{f"detecta_{t}": f"{rej}/{tot} ({100*rej/tot:.0f}%)" for t, rej, tot in bad},
        "latencia_media_ms": f"{sum(lat)/len(lat):.1f}",
    }


if __name__ == "__main__":
    base = load_line_config()
    items = load_test_set()
    out = ROOT / "outputs/eval_detalle.csv"
    rows, detail = [], []
    for name, m in COMBOS.items():
        rows.append(run(name, m, items, base, detail))

    fields = list(dict.fromkeys(k for d in detail for k in d))
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(detail)

    cols = list(rows[0])
    widths = [max(len(c), *(len(r[c]) for r in rows)) for c in cols]
    print("  ".join(c.ljust(n) for c, n in zip(cols, widths)))
    for r in rows:
        print("  ".join(r[c].ljust(n) for c, n in zip(cols, widths)))
    print(f"\nDetalle por botella: {out.relative_to(ROOT)}")
