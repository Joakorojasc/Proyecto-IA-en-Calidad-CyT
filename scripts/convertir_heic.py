"""Convierte las fotos HEIC del iPhone a JPG, porque el navegador no las puede leer.

Respeta la orientación de la foto y, por defecto, la achica a 1600 px por lado (sobra para calibrar).
Deja los JPG en la carpeta de salida con la misma estructura de subcarpetas.

Uso:
  pip install pillow pillow-heif
  python scripts/convertir_heic.py "C:\\ruta\\a\\las\\fotos"
  python scripts/convertir_heic.py CARPETA --salida fotos_jpg --lado 2000
"""
import argparse
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    raise SystemExit("Falta una librería. Instálala con:  pip install pillow-heif")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("carpeta", type=Path)
    ap.add_argument("--salida", type=Path, default=None, help="por defecto: <carpeta>_jpg")
    ap.add_argument("--lado", type=int, default=1600, help="lado más largo en píxeles (0 = no achicar)")
    a = ap.parse_args()

    origen = a.carpeta.resolve()
    salida = (a.salida or origen.with_name(origen.name + "_jpg")).resolve()
    fotos = [p for p in origen.rglob("*") if p.suffix.lower() in {".heic", ".heif"}]
    if not fotos:
        raise SystemExit(f"No encontré fotos HEIC en {origen}")

    for i, p in enumerate(fotos, 1):
        destino = salida / p.relative_to(origen).with_suffix(".jpg")
        destino.parent.mkdir(parents=True, exist_ok=True)
        im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        if a.lado:
            im.thumbnail((a.lado, a.lado))
        im.save(destino, quality=90)
        print(f"  [{i}/{len(fotos)}] {p.name} -> {destino.relative_to(salida)}")
    print(f"\nListo: {len(fotos)} fotos en {salida}")


if __name__ == "__main__":
    main()
