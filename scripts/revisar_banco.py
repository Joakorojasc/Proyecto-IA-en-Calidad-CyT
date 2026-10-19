"""Revisa un banco de imágenes grande sin abrir todas las fotos y arma láminas de muestra.

Por cada carpeta que tenga imágenes: cuántas hay, resolución, brillo, si son a color o en grises,
rango de fechas en el nombre de archivo y una lámina con miniaturas al azar (para la presentación).
En carpetas grandes solo mira una muestra, así que no se demora aunque haya miles de fotos.

Uso:
  python scripts/revisar_banco.py "C:\\Users\\Joaquin\\Desktop\\Ramos\\IPre IA\\IM_ETI_V2\\IM_ETI_V2"
  python scripts/revisar_banco.py RUTA --muestra 300 --miniaturas 24 --salida revision_banco

Deja en la carpeta de salida: resumen.txt, resumen.csv y laminas/<carpeta>.jpg
"""
import argparse
import csv
import os
import random
import re
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

EXT = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
FECHA = re.compile(r"(\d{4}-\d{2}-\d{2})")


def carpetas_con_imagenes(raiz: Path):
    """Recorre el árbol con os.scandir (rápido) y devuelve {carpeta: [archivos]}."""
    out, pila = {}, [raiz]
    while pila:
        d = pila.pop()
        fotos = []
        try:
            with os.scandir(d) as it:
                for e in it:
                    if e.is_dir(follow_symlinks=False):
                        pila.append(Path(e.path))
                    elif Path(e.name).suffix.lower() in EXT:
                        fotos.append(e.name)
        except PermissionError:
            continue
        if fotos:
            out[d] = sorted(fotos)
    return out


def medir(ruta: Path):
    """Resolución, modo, brillo (0-255) y cuánto color tiene (0 = gris puro)."""
    with Image.open(ruta) as im:
        size, modo = im.size, im.mode
        rgb = np.asarray(im.convert("RGB").resize((96, 96)), dtype=np.float32)
    color = float(np.abs(rgb - rgb.mean(axis=2, keepdims=True)).mean())
    return size, modo, float(rgb.mean()), color


def lamina(rutas, destino: Path, titulo: str, lado=180, columnas=6):
    filas = (len(rutas) + columnas - 1) // columnas
    hoja = Image.new("RGB", (columnas * lado, filas * lado + 30), (20, 20, 22))
    ImageDraw.Draw(hoja).text((8, 8), titulo[:110], fill=(230, 230, 230))
    for i, r in enumerate(rutas):
        try:
            with Image.open(r) as im:
                im = im.convert("RGB")
                im.thumbnail((lado - 6, lado - 6))
                x, y = (i % columnas) * lado + 3, (i // columnas) * lado + 33
                hoja.paste(im, (x, y))
        except Exception:
            continue
    destino.parent.mkdir(parents=True, exist_ok=True)
    hoja.save(destino, quality=88)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raiz", type=Path)
    ap.add_argument("--muestra", type=int, default=200, help="fotos a medir por carpeta como máximo")
    ap.add_argument("--miniaturas", type=int, default=24, help="fotos por lámina")
    ap.add_argument("--salida", type=Path, default=Path("revision_banco"))
    a = ap.parse_args()
    random.seed(0)

    print(f"Buscando imágenes en {a.raiz} …")
    grupos = carpetas_con_imagenes(a.raiz)
    if not grupos:
        raise SystemExit("No encontré imágenes.")
    filas = []
    for d, fotos in sorted(grupos.items(), key=lambda kv: -len(kv[1])):
        rel = d.relative_to(a.raiz) if d != a.raiz else Path(".")
        muestra = random.sample(fotos, min(a.muestra, len(fotos)))
        medidas = []
        for f in muestra:
            try:
                medidas.append(medir(d / f))
            except Exception:
                pass
        if not medidas:
            continue
        tamanos = Counter(f"{w}x{h}" for (w, h), *_ in medidas)
        modos = Counter(m for _, m, _, _ in medidas)
        brillo = np.mean([b for *_, b, _ in medidas])
        color = np.array([c for *_, c in medidas])
        fechas = sorted(m.group(1) for f in fotos if (m := FECHA.search(f)))
        nombre_lamina = re.sub(r"[^\w\-]+", "_", str(rel))[:80] or "raiz"
        lamina([d / f for f in muestra[: a.miniaturas]], a.salida / "laminas" / f"{nombre_lamina}.jpg",
               f"{rel}  ·  {len(fotos)} fotos")
        filas.append({
            "carpeta": str(rel), "fotos": len(fotos), "medidas": len(medidas),
            "resolucion": ", ".join(f"{k} ({v})" for k, v in tamanos.most_common(3)),
            "modo": ", ".join(f"{k} ({v})" for k, v in modos.most_common(3)),
            "brillo_0a255": round(float(brillo), 1),
            "color_promedio": round(float(color.mean()), 2),
            "pct_en_grises": round(100 * float((color < 2).mean()), 1),
            "fechas": f"{fechas[0]} a {fechas[-1]}" if fechas else "",
            "lamina": f"laminas/{nombre_lamina}.jpg",
        })
        print(f"  {len(fotos):>7} fotos  {rel}")

    a.salida.mkdir(parents=True, exist_ok=True)
    with open(a.salida / "resumen.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(filas[0]), delimiter=";")
        w.writeheader()
        w.writerows(filas)
    total = sum(f["fotos"] for f in filas)
    with open(a.salida / "resumen.txt", "w", encoding="utf-8") as fh:
        fh.write(f"Banco: {a.raiz}\nCarpetas con imágenes: {len(filas)} · fotos en total: {total}\n\n")
        fh.write("color_promedio: 0 = gris puro; sobre ~5 ya hay color visible. pct_en_grises: % de la muestra sin color.\n")
        fh.write("brillo_0a255: 0 = negro; las fotos muy oscuras quedan bajo ~40.\n\n")
        for f in filas:
            fh.write(f"{f['carpeta']}\n  {f['fotos']} fotos · {f['resolucion']} · modo {f['modo']} · brillo {f['brillo_0a255']}"
                     f" · color {f['color_promedio']} · en grises {f['pct_en_grises']}% · fechas {f['fechas'] or '-'}\n")
    print(f"\nListo: {len(filas)} carpetas, {total} fotos. Revisa {a.salida / 'resumen.txt'} y la carpeta {a.salida / 'laminas'}.")


if __name__ == "__main__":
    main()
