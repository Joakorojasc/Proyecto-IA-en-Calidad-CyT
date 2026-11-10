"""Junta fotos para entrenar YOLOX: desde la cámara en vivo o desde un video ya grabado.

Cámara en vivo (gira la botella frente a la cámara; guarda una foto cada 1/fps segundos):
    python scripts/yolox/capturar_fotos.py --camara 1 --fps 2 --minutos 3
    (en la ventana: Espacio pausa/sigue, Q termina. --camara 0 suele ser la del notebook; prueba 1 o 2 para la Pc02)

Video ya grabado (por ejemplo, del celular):
    python scripts/yolox/capturar_fotos.py --video IMG_4175.MOV --fps 2

Las fotos quedan en datos_yolox/fotos/ (o en --salida). Se descartan las fotos movidas y las casi idénticas
a la anterior, para no marcar 50 veces lo mismo.

Requiere: pip install opencv-python
"""
import argparse
import os
import sys
import time

import cv2
import numpy as np


def nitidez(gris):
    """Varianza del Laplaciano: una foto movida da un número bajo."""
    return cv2.Laplacian(gris, cv2.CV_64F).var()


def huella(gris):
    """Miniatura normalizada, para saber si una foto es casi igual a la anterior."""
    m = cv2.resize(gris, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    m -= m.mean()
    return m / (np.linalg.norm(m) + 1e-6)


class Guardador:
    def __init__(self, salida, prefijo, min_nitidez, max_parecido, lado):
        os.makedirs(salida, exist_ok=True)
        self.salida, self.prefijo, self.min_nitidez, self.max_parecido, self.lado = salida, prefijo, min_nitidez, max_parecido, lado
        self.anterior = None
        self.guardadas = self.movidas = self.repetidas = 0
        self.n = len([f for f in os.listdir(salida) if f.startswith(prefijo)])   # no pisa fotos de una sesión anterior

    def ofrecer(self, cuadro):
        gris = cv2.cvtColor(cuadro, cv2.COLOR_BGR2GRAY)
        if nitidez(gris) < self.min_nitidez:
            self.movidas += 1
            return "movida"
        h = huella(gris)
        if self.anterior is not None and float((h * self.anterior).sum()) > self.max_parecido:
            self.repetidas += 1
            return "repetida"
        self.anterior = h
        alto, ancho = cuadro.shape[:2]
        if self.lado and max(alto, ancho) > self.lado:   # achica fotos 4K: YOLOX entrena a 416-640 px
            f = self.lado / max(alto, ancho)
            cuadro = cv2.resize(cuadro, (round(ancho * f), round(alto * f)), interpolation=cv2.INTER_AREA)
        self.n += 1
        cv2.imwrite(os.path.join(self.salida, f"{self.prefijo}_{self.n:05d}.jpg"), cuadro, [cv2.IMWRITE_JPEG_QUALITY, 92])
        self.guardadas += 1
        return "guardada"

    def resumen(self):
        return f"{self.guardadas} fotos guardadas en {self.salida} · descartadas: {self.movidas} movidas, {self.repetidas} casi iguales a la anterior"


def desde_video(ruta, fps, g):
    cap = cv2.VideoCapture(ruta)
    if not cap.isOpened():
        sys.exit(f"No pude abrir el video {ruta}. Si es .MOV del iPhone, conviértelo: ffmpeg -i {ruta} -c:v libx264 video.mp4")
    fps_video = cap.get(cv2.CAP_PROP_FPS) or 30
    cada = max(1, round(fps_video / fps))
    i = 0
    while True:
        ok, cuadro = cap.read()
        if not ok:
            break
        if i % cada == 0:
            g.ofrecer(cuadro)
        i += 1
    cap.release()


def desde_camara(indice, fps, minutos, ancho, alto, g):
    cap = cv2.VideoCapture(indice, cv2.CAP_DSHOW) if os.name == "nt" else cv2.VideoCapture(indice)
    if not cap.isOpened():
        sys.exit(f"No pude abrir la cámara {indice}. Prueba otro número (0, 1, 2) y cierra Chrome, Zoom o Teams si la están usando.")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, ancho)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, alto)
    print("Gira la botella despacio. Espacio: pausa/sigue · Q: terminar.")
    fin, proxima, pausa, ultimo = time.time() + minutos * 60, 0.0, False, ""
    while time.time() < fin:
        ok, cuadro = cap.read()
        if not ok:
            print("La cámara dejó de entregar imagen.")
            break
        ahora = time.time()
        if not pausa and ahora >= proxima:
            proxima = ahora + 1 / fps
            ultimo = g.ofrecer(cuadro)
        vista = cuadro.copy()
        txt = f"{'PAUSA' if pausa else 'GRABANDO'} · {g.guardadas} fotos · {int(fin - ahora)} s · ultima: {ultimo}"
        cv2.putText(vista, txt, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255) if pausa else (0, 200, 0), 2)
        cv2.imshow("Quality AI - fotos para YOLOX", vista)
        k = cv2.waitKey(1) & 0xFF
        if k in (ord("q"), ord("Q"), 27):
            break
        if k == ord(" "):
            pausa = not pausa
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    fuente = p.add_mutually_exclusive_group(required=True)
    fuente.add_argument("--camara", type=int, help="número de la cámara (0, 1, 2...)")
    fuente.add_argument("--video", help="ruta a un video ya grabado")
    p.add_argument("--fps", type=float, default=2, help="fotos por segundo (por defecto 2)")
    p.add_argument("--minutos", type=float, default=3, help="solo cámara: cuánto rato graba (por defecto 3)")
    p.add_argument("--salida", default="datos_yolox/fotos", help="carpeta de salida")
    p.add_argument("--prefijo", default=None, help="inicio del nombre de cada foto (por defecto, según la fuente y la hora)")
    p.add_argument("--min-nitidez", type=float, default=40, help="descarta fotos más movidas que esto (0 = no descarta)")
    p.add_argument("--max-parecido", type=float, default=0.985, help="descarta fotos más parecidas que esto a la anterior (1 = no descarta)")
    p.add_argument("--lado", type=int, default=1280, help="achica las fotos a este lado mayor (0 = tamaño original)")
    p.add_argument("--ancho", type=int, default=1280, help="solo cámara: resolución pedida")
    p.add_argument("--alto", type=int, default=720)
    a = p.parse_args()
    prefijo = a.prefijo or (("cam" if a.camara is not None else "video") + time.strftime("_%m%d_%H%M"))
    g = Guardador(a.salida, prefijo, a.min_nitidez, a.max_parecido, a.lado)
    if a.video:
        desde_video(a.video, a.fps, g)
    else:
        desde_camara(a.camara, a.fps, a.minutos, a.ancho, a.alto, g)
    print(g.resumen())
