"""Simula la línea en tiempo real: cámara -> cola -> inspector -> expulsor, midiendo si la decisión llega a tiempo.

Uso: python scripts/simulate_line.py [n_botellas] [bph] [SKU]
"""
import csv
import queue
import random
import sys
import threading
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from PIL import Image
from inspector.config import ROOT, load_line_config
from inspector.pipeline import Inspector

REJECT_DEADLINE_MS = 300  # viaje cámara -> expulsor, a medir en terreno


def camera_and_photocell(q, files, n, bph, sku_in_production):
    period = 3600.0 / bph
    t_next = time.perf_counter()
    for i in range(n):
        f, truth = random.choice(files)
        q.put((f"B{i:05d}", time.perf_counter(), Image.open(f).copy(), truth))
        t_next += period
        time.sleep(max(0.0, t_next - time.perf_counter()))
    q.put(None)


def main(n=200, bph=None, sku=None):
    cfg = load_line_config()
    bph = bph or cfg["line"]["bottles_per_hour"]
    mode = cfg["line"]["mode"]
    sku = sku or sorted(p.name for p in (ROOT / cfg["paths"]["references"]).iterdir() if p.is_dir())[0]

    test = ROOT / "data/test"
    files = [(f, "ok") for f in (test / "ok").glob(f"{sku}__*")] * 9
    files += [(f, d.name) for d in test.iterdir() if d.name != "ok" for f in d.glob(f"{sku}__*")]

    insp = Inspector(cfg)
    q = queue.Queue(maxsize=50)
    threading.Thread(target=camera_and_photocell, args=(q, files, n, bph, sku), daemon=True).start()

    print(f"Simulando {n} botellas a {bph} bph ({3600/bph*1000:.0f} ms entre botellas), modo={mode}\n")
    log, late = [], 0
    while (item := q.get()) is not None:
        bid, t_shot, img, truth = item
        r = insp.inspect(img, sku, bottle_id=bid)
        total_ms = (time.perf_counter() - t_shot) * 1000
        on_time = total_ms <= REJECT_DEADLINE_MS
        late += not on_time
        action = ("EXPULSAR" if mode == "active" else "habria_expulsado") if r.decision == "RECHAZO" else "-"
        if r.decision == "RECHAZO":
            print(f"  {bid}  {r.decision:8s} {','.join(r.reasons):40s} real={truth:10s} {total_ms:6.1f} ms  {action}")
        log.append({**r.row(), "truth": truth, "total_ms": round(total_ms, 1), "a_tiempo": on_time, "accion": action})

    out = ROOT / cfg["paths"]["results"]
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(log[0]))
        w.writeheader()
        w.writerows(log)

    lat = sorted(x["total_ms"] for x in log)
    rech = sum(x["decision"] == "RECHAZO" for x in log)
    print(f"\nBotellas: {len(log)} | rechazos: {rech} | atrasadas (> {REJECT_DEADLINE_MS} ms): {late}")
    print(f"Latencia foto->decisión: p50={lat[len(lat)//2]:.1f} ms  p95={lat[int(len(lat)*0.95)]:.1f} ms  max={lat[-1]:.1f} ms")
    print(f"Log: {out.relative_to(ROOT)}")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(int(a[0]) if a else 200, int(a[1]) if len(a) > 1 else None, a[2] if len(a) > 2 else None)
