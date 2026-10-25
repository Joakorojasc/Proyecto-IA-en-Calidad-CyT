"""Busca la etiqueta dentro del recorte de una botella: la franja clara entre el vidrio oscuro."""
import cv2
import numpy as np


def buscar_etiqueta(botella, alto_minimo: float = 0.1):
    """Devuelve la caja (x, y, w, h) de la etiqueta dentro de `botella`, o None si no encuentra una."""
    gris = cv2.cvtColor(botella, cv2.COLOR_BGR2GRAY)
    h, w = gris.shape
    if h < 20 or w < 10:
        return None

    # Brillo de cada fila mirando solo el centro de la botella, para no contar la pared de los lados.
    filas = gris[:, w // 4: 3 * w // 4].mean(axis=1).astype(np.uint8)
    umbral, _ = cv2.threshold(filas.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    claras = filas > umbral

    # El tramo más largo de filas claras seguidas es la etiqueta.
    mejor, inicio = (0, 0), None
    for i, c in enumerate(np.append(claras, False)):
        if c and inicio is None:
            inicio = i
        elif not c and inicio is not None:
            if i - inicio > mejor[1] - mejor[0]:
                mejor = (inicio, i)
            inicio = None
    y0, y1 = mejor
    if y1 - y0 < alto_minimo * h or claras.all():
        return None

    # Ancho: columnas donde el vidrio (filas fuera de la etiqueta) es oscuro.
    vidrio = np.concatenate([gris[:y0], gris[y1:]])
    oscuras = np.where(vidrio.mean(axis=0) <= umbral)[0] if len(vidrio) else []
    x0, x1 = (oscuras[0], oscuras[-1] + 1) if len(oscuras) else (0, w)
    return int(x0), int(y0), int(x1 - x0), int(y1 - y0)
