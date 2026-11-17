"""Detector YOLOX en Python (onnxruntime, sin PyTorch). Usa el mismo modelo que la app
(frontend/modelos/etiquetas.onnx) y el mismo pre y post proceso que frontend/yolox.js.

Sirve para probar un modelo fuera del navegador: revisar fotos sueltas o medir cuánto acierta.

    pip install opencv-python onnxruntime
    python scripts/yolox/detector.py foto.jpg                  # imprime las cajas y guarda foto_cajas.jpg
    python scripts/yolox/detector.py foto.jpg otro_modelo.onnx

Desde Python:
    from detector import Detector
    cajas = Detector().detectar(cv2.imread("foto.jpg"))
    # [{"clase": "frontal", "confianza": 0.94, "caja": [x1, y1, x2, y2]}, ...]

El servidor lo ofrece en POST /api/detectar (ver scripts/servidor.py).
Con un modelo de 80 clases (el yolox_s.onnx oficial, sin entrenar) usa los nombres de COCO.
"""
import os
import sys

import cv2
import numpy as np
import onnxruntime as ort

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELO = os.path.join(RAIZ, "frontend", "modelos", "etiquetas.onnx")
CLASES = ["frontal", "trasera"]      # el orden del entrenamiento (preparar_dataset.py)

COCO = ("person,bicycle,car,motorcycle,airplane,bus,train,truck,boat,traffic light,fire hydrant,"
        "stop sign,parking meter,bench,bird,cat,dog,horse,sheep,cow,elephant,bear,zebra,giraffe,"
        "backpack,umbrella,handbag,tie,suitcase,frisbee,skis,snowboard,sports ball,kite,"
        "baseball bat,baseball glove,skateboard,surfboard,tennis racket,bottle,wine glass,cup,fork,"
        "knife,spoon,bowl,banana,apple,sandwich,orange,broccoli,carrot,hot dog,pizza,donut,cake,"
        "chair,couch,potted plant,bed,dining table,toilet,tv,laptop,mouse,remote,keyboard,"
        "cell phone,microwave,oven,toaster,sink,refrigerator,book,clock,vase,scissors,teddy bear,"
        "hair drier,toothbrush").split(",")


class Detector:
    def __init__(self, modelo=MODELO, confianza=0.25, nms=0.45):
        self.sesion = ort.InferenceSession(modelo)
        entrada = self.sesion.get_inputs()[0]
        self.nombre = entrada.name
        self.alto, self.ancho = entrada.shape[2], entrada.shape[3]
        self.confianza, self.nms = confianza, nms
        self.clases = COCO if self.sesion.get_outputs()[0].shape[2] == 85 else CLASES
        # Grilla de YOLOX: cada salida es (cx, cy, w, h) relativo a su celda y su paso (8, 16, 32).
        centros, pasos = [], []
        for paso in (8, 16, 32):
            h, w = self.alto // paso, self.ancho // paso
            xs, ys = np.meshgrid(np.arange(w), np.arange(h))
            centros.append(np.stack([xs, ys], -1).reshape(-1, 2))
            pasos.append(np.full((h * w, 1), paso))
        self.centros = np.concatenate(centros).astype(np.float32)
        self.pasos = np.concatenate(pasos).astype(np.float32)

    def detectar(self, img):
        """img: foto BGR (como la entrega cv2). Devuelve las cajas en píxeles de la foto original."""
        r = min(self.alto / img.shape[0], self.ancho / img.shape[1])
        chica = cv2.resize(img, (int(img.shape[1] * r), int(img.shape[0] * r)))
        lienzo = np.full((self.alto, self.ancho, 3), 114, np.uint8)
        lienzo[:chica.shape[0], :chica.shape[1]] = chica
        entrada = lienzo.transpose(2, 0, 1)[None].astype(np.float32)

        p = self.sesion.run(None, {self.nombre: entrada})[0][0]
        xy = (p[:, :2] + self.centros) * self.pasos
        wh = np.exp(p[:, 2:4]) * self.pasos
        puntajes = p[:, 4:5] * p[:, 5:]
        clase = puntajes.argmax(1)
        conf = puntajes.max(1)

        ok = conf >= self.confianza
        xy, wh, clase, conf = xy[ok], wh[ok], clase[ok], conf[ok]
        cajas = np.concatenate([xy - wh / 2, wh], 1) / r          # x, y, ancho, alto
        quedan = cv2.dnn.NMSBoxesBatched(cajas.tolist(), conf.tolist(), clase.tolist(),
                                         self.confianza, self.nms)
        alto, ancho = img.shape[:2]
        salida = []
        for i in np.array(quedan).flatten():
            x, y, w, h = cajas[i]
            salida.append({"clase": self.clases[clase[i]], "confianza": round(float(conf[i]), 3),
                           "caja": [max(0, round(float(x))), max(0, round(float(y))),
                                    min(ancho, round(float(x + w))), min(alto, round(float(y + h)))]})
        return salida


def dibujar(img, cajas):
    for c in cajas:
        x1, y1, x2, y2 = c["caja"]
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 220, 0), 2)
        cv2.putText(img, f'{c["clase"]} {c["confianza"]:.2f}', (x1, max(18, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 220, 0), 2)
    return img


if __name__ == "__main__":
    ruta = sys.argv[1]
    foto = cv2.imread(ruta)
    cajas = Detector(*sys.argv[2:3]).detectar(foto)
    for c in cajas:
        print(c)
    salida = os.path.splitext(ruta)[0] + "_cajas.jpg"
    cv2.imwrite(salida, dibujar(foto, cajas))
    print("Guardado:", salida)
