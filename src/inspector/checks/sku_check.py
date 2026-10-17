"""¿Es el SKU correcto? kNN contra toda la galería de maestros."""
import numpy as np


def check_sku(emb: np.ndarray, gallery: dict, expected_sku: str, sku_cfg: dict, k: int = 3) -> dict:
    sims = gallery["embeddings"] @ emb
    top = np.argsort(-sims)[:k]
    top_labels = gallery["labels"][top]
    nearest = str(top_labels[0])

    labels, counts = np.unique(top_labels, return_counts=True)
    voted = str(labels[counts.argmax()])

    sim_expected = float(sims[gallery["labels"] == expected_sku].max())
    ok = voted == expected_sku and sim_expected >= sku_cfg["sim_min"]
    return {
        "sku_ok": bool(ok),
        "sku_predicted": voted,
        "sim_expected": round(sim_expected, 4),
        "nearest": nearest,
    }
