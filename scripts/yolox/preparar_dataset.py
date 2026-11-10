"""Deja las fotos marcadas listas para entrenar YOLOX.

Toma una o varias exportaciones en formato COCO (Roboflow: "COCO JSON"; Label Studio: "COCO with images"),
se queda solo con las clases frontal y trasera, separa entrenamiento y validación, y arma la carpeta que YOLOX espera:

    datasets/etiquetas/
        annotations/train.json   annotations/val.json
        train2017/*.jpg          val2017/*.jpg

Uso:
    python scripts/yolox/preparar_dataset.py export/train/_annotations.coco.json export/valid/_annotations.coco.json
    python scripts/yolox/preparar_dataset.py label_studio/result.json --val 0.15

Las imágenes se buscan junto a cada .json (también en su subcarpeta images/). Las fotos sin ninguna etiqueta marcada
se conservan: le enseñan al modelo qué NO es una etiqueta (vidrio, fondo).
"""
import argparse
import json
import os
import random
import shutil
import sys

CLASES = ["frontal", "trasera"]   # el orden define el número de clase del modelo: 0 = frontal, 1 = trasera


def buscar_imagen(carpeta, nombre):
    for cand in (os.path.join(carpeta, nombre), os.path.join(carpeta, os.path.basename(nombre)),
                 os.path.join(carpeta, "images", os.path.basename(nombre))):
        if os.path.isfile(cand):
            return cand
    return None


def leer(rutas):
    imagenes, sin_archivo, otras = [], 0, set()
    for ruta in rutas:
        d = json.load(open(ruta, encoding="utf-8"))
        carpeta = os.path.dirname(os.path.abspath(ruta))
        nombre_cat = {c["id"]: c["name"].strip().lower() for c in d["categories"]}
        por_img = {}
        for an in d.get("annotations", []):
            clase = nombre_cat.get(an["category_id"], "")
            if clase not in CLASES:
                otras.add(clase)
                continue
            x, y, w, h = an["bbox"]
            if w > 1 and h > 1:
                por_img.setdefault(an["image_id"], []).append((CLASES.index(clase), [x, y, w, h]))
        for im in d["images"]:
            archivo = buscar_imagen(carpeta, im["file_name"])
            if not archivo:
                sin_archivo += 1
                continue
            imagenes.append({"archivo": archivo, "w": im["width"], "h": im["height"], "cajas": por_img.get(im["id"], [])})
    if otras - {""}:
        print(f"Aviso: se ignoraron clases que no son frontal/trasera: {sorted(otras - {''})}")
    if sin_archivo:
        print(f"Aviso: {sin_archivo} imágenes del .json no se encontraron en disco y se saltaron.")
    return imagenes


def escribir(imagenes, carpeta_img, ruta_json):
    os.makedirs(carpeta_img, exist_ok=True)
    out = {"images": [], "annotations": [], "categories": [{"id": i + 1, "name": c} for i, c in enumerate(CLASES)]}
    nombres = set()
    for i, im in enumerate(imagenes, 1):
        base = os.path.basename(im["archivo"])
        nombre = base if base not in nombres else f"{i:05d}_{base}"   # dos exportaciones pueden repetir nombres
        nombres.add(nombre)
        shutil.copy2(im["archivo"], os.path.join(carpeta_img, nombre))
        out["images"].append({"id": i, "file_name": nombre, "width": im["w"], "height": im["h"]})
        for clase, (x, y, w, h) in im["cajas"]:
            out["annotations"].append({"id": len(out["annotations"]) + 1, "image_id": i, "category_id": clase + 1,
                                       "bbox": [x, y, w, h], "area": w * h, "iscrowd": 0})
    json.dump(out, open(ruta_json, "w", encoding="utf-8"))
    return out


def contar(out):
    n = {c: 0 for c in CLASES}
    for an in out["annotations"]:
        n[CLASES[an["category_id"] - 1]] += 1
    vacias = len(out["images"]) - len({an["image_id"] for an in out["annotations"]})
    return f"{len(out['images'])} imágenes · frontal {n['frontal']} · trasera {n['trasera']} · sin etiqueta {vacias}"


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("json", nargs="+", help="exportaciones COCO (.json)")
    p.add_argument("--salida", default="datasets/etiquetas")
    p.add_argument("--val", type=float, default=0.15, help="fracción para validación (por defecto 15 %%)")
    p.add_argument("--semilla", type=int, default=7)
    a = p.parse_args()
    imgs = leer(a.json)
    if len(imgs) < 10:
        sys.exit(f"Solo encontré {len(imgs)} imágenes: revisa las rutas.")
    random.Random(a.semilla).shuffle(imgs)
    n_val = max(1, round(len(imgs) * a.val))
    if os.path.isdir(a.salida):
        shutil.rmtree(a.salida)
    os.makedirs(os.path.join(a.salida, "annotations"))
    tr = escribir(imgs[n_val:], os.path.join(a.salida, "train2017"), os.path.join(a.salida, "annotations", "train.json"))
    va = escribir(imgs[:n_val], os.path.join(a.salida, "val2017"), os.path.join(a.salida, "annotations", "val.json"))
    print("Entrenamiento:", contar(tr))
    print("Validación:   ", contar(va))
    print(f"Listo en {a.salida}")
