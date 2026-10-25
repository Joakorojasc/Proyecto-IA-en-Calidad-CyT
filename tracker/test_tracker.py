"""Prueba sin cámara: rectángulos que cruzan la imagen deben contarse una vez cada uno y guardarse.

Uso: python tracker/test_tracker.py
"""
import csv
import tempfile
from pathlib import Path

import numpy as np

import seguidor
from seguidor import Seguidor

ANCHO, ALTO = 640, 360
CFG = {"linea_x": 0.5, "direccion": "ambas", "area_minima": 0.01, "ancho_maximo": 0.6, "max_distancia": 0.15,
       "cuadros_perdida": 10, "carpeta_capturas": "capturas", "margen_recorte": 20}


def fondo(rng):
    return rng.integers(40, 60, (ALTO, ANCHO, 3), dtype=np.uint8)


def correr(botellas, cfg=CFG, etiqueta=False):
    """botellas: lista de (cuadro_inicio, x_inicio, paso_px). Devuelve el seguidor y la carpeta de capturas.

    Con etiqueta=True la botella es oscura con una franja del mismo tono que el fondo, como una
    etiqueta blanca frente a una pared blanca: la resta de fondo la ve partida en dos.
    """
    rng = np.random.default_rng(0)
    tmp = Path(tempfile.mkdtemp())
    seguidor.AQUI = tmp
    seg = Seguidor(cfg, ANCHO, ALTO)
    for i in range(30):  # fondo vacío para que lo aprenda
        seg.procesar(fondo(rng), i / 30)
    for i in range(120):
        frame = fondo(rng)
        for inicio, x0, paso in botellas:
            if i >= inicio:
                x = x0 + (i - inicio) * paso
                if -60 < x < ANCHO and etiqueta:
                    frame[60:330, max(0, x):max(0, x + 60)] = (10, 10, 10)
                    frame[150:240, max(0, x):max(0, x + 60)] = (50, 50, 50)
                elif -60 < x < ANCHO:
                    frame[120:300, max(0, x):max(0, x + 60)] = (30, 160, 220)
        seg.procesar(frame, (30 + i) / 30)
    return seg, tmp / "capturas"


def test_una_botella():
    seg, carpeta = correr([(0, -40, 12)])
    assert seg.contador == 1, seg.contador
    filas = list(csv.DictReader(open(carpeta / "registro.csv")))
    assert len(filas) == 1
    assert float(filas[0]["velocidad_px_s"]) > 0
    assert (carpeta / filas[0]["archivo"]).exists()


def test_tres_botellas_seguidas():
    seg, _ = correr([(0, -40, 12), (25, -40, 12), (50, -40, 12)])
    assert seg.contador == 3, seg.contador


def test_botella_con_etiqueta_clara():
    seg, carpeta = correr([(0, -40, 12)], etiqueta=True)
    assert seg.contador == 1, seg.contador
    fila = next(csv.DictReader(open(carpeta / "registro.csv")))
    assert int(fila["alto"]) >= 250, fila  # la caja cubre la botella entera, no solo un trozo
    assert fila["etiqueta"] and (carpeta / fila["etiqueta"]).exists()


def test_ida_y_vuelta_cuenta_por_direccion():
    seg, _ = correr([(0, -40, 12), (10, ANCHO, -12)], {**CFG, "direccion": "derecha"})
    assert seg.contador == 1, seg.contador


if __name__ == "__main__":
    for nombre, f in list(globals().items()):
        if nombre.startswith("test_"):
            f()
            print(f"ok  {nombre}")
