"""Arma la galería de maestros (embeddings + color patrón por SKU)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from inspector.config import load_line_config
from inspector.embedder import get_embedder
from inspector.gallery import build_gallery

if __name__ == "__main__":
    cfg = load_line_config()
    emb = get_embedder(cfg["embedder"])
    g = build_gallery(emb, cfg["paths"]["references"], cfg["paths"]["gallery"])
    print(f"Galería: {len(g['labels'])} maestros, embedder={g['embedder']}, dim={g['embeddings'].shape[1]}")
