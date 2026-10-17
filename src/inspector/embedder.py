"""Embeddings normalizados de una etiqueta: DINOv2 (requiere torch) o uno simple sin dependencias."""
import numpy as np
from PIL import Image


class SimpleEmbedder:
    name = "simple"

    def __init__(self, size: int = 32):
        self.size = size

    def __call__(self, img: Image.Image) -> np.ndarray:
        g = np.asarray(img.convert("L").resize((self.size, self.size)), dtype=np.float32)
        gy, gx = np.gradient(g)
        v = np.concatenate([g.ravel(), np.hypot(gx, gy).ravel()])
        v -= v.mean()
        return v / (np.linalg.norm(v) + 1e-8)


class DinoEmbedder:
    name = "dinov2"

    def __init__(self, model: str = "dinov2_vits14"):
        import torch
        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = torch.hub.load("facebookresearch/dinov2", model).to(self.device).eval()
        self.mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)

    def __call__(self, img: Image.Image) -> np.ndarray:
        t = self.torch
        x = np.asarray(img.convert("RGB").resize((224, 224)), dtype=np.float32) / 255.0
        x = (t.from_numpy(x).permute(2, 0, 1) - self.mean) / self.std
        with t.no_grad():
            v = self.model(x.unsqueeze(0).to(self.device))[0].cpu().numpy()
        return v / (np.linalg.norm(v) + 1e-8)


def get_embedder(cfg: dict):
    backend = cfg.get("backend", "auto")
    if backend in ("auto", "dinov2"):
        try:
            return DinoEmbedder(cfg.get("dinov2_model", "dinov2_vits14"))
        except Exception as e:
            if backend == "dinov2":
                raise
            print(f"[embedder] DINOv2 no disponible ({type(e).__name__}); uso SimpleEmbedder")
    return SimpleEmbedder()
