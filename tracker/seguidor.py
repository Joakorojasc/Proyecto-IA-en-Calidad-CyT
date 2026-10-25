"""Sigue botellas con la webcam y guarda una foto de cada una cuando cruza la línea (fotocélula virtual).

Uso: python tracker/seguidor.py [camara_o_video]
Teclas: q salir | espacio pausar | g guardar sí/no | f reaprender fondo | clic mover la línea
"""
import csv
import sys
import time
from datetime import datetime
from pathlib import Path

import cv2
import yaml

from detector import Detector
from etiqueta import buscar_etiqueta
from tracker import Rastreador

AQUI = Path(__file__).resolve().parent
VERDE, ROJO, AMARILLO, BLANCO = (0, 200, 0), (0, 0, 255), (0, 220, 255), (255, 255, 255)


class Seguidor:
    def __init__(self, cfg: dict, ancho: int, alto: int):
        self.cfg = cfg
        self.linea_x = int(cfg["linea_x"] * ancho)
        self.detector = Detector(cfg["area_minima"], cfg["ancho_maximo"])
        self.rastreador = Rastreador(cfg["max_distancia"] * ancho, cfg["cuadros_perdida"])
        self.carpeta = AQUI / cfg["carpeta_capturas"]
        self.guardar = True
        self.contador = 0

    def procesar(self, frame, t: float):
        """Detecta, sigue y guarda las botellas que cruzan. Devuelve el cuadro con los dibujos."""
        cajas, _ = self.detector(frame)
        visibles = self.rastreador.actualizar(cajas, t)
        cruces = self.rastreador.cruces(self.linea_x, self.cfg["direccion"])
        for p in cruces:
            self.contador += 1
            if self.guardar:
                self._guardar(frame, p)

        vista = frame.copy()
        cv2.line(vista, (self.linea_x, 0), (self.linea_x, vista.shape[0]), AMARILLO, 2)
        for p in visibles:
            x, y, w, h = p.caja
            color = VERDE if p.cruzo else ROJO
            cv2.rectangle(vista, (x, y), (x + w, y + h), color, 2)
            cv2.putText(vista, f"B{p.id:05d}", (x, max(20, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        return vista

    def _guardar(self, frame, p):
        dia = self.carpeta / datetime.now().strftime("%Y-%m-%d")
        dia.mkdir(parents=True, exist_ok=True)
        x, y, w, h = p.caja
        m = self.cfg["margen_recorte"]
        recorte = frame[max(0, y - m):y + h + m, max(0, x - m):x + w + m]
        nombre = f"B{p.id:05d}"
        cv2.imwrite(str(dia / f"{nombre}.jpg"), recorte)
        cv2.imwrite(str(dia / f"{nombre}_completa.jpg"), frame)

        archivo_etiqueta = ""
        et = buscar_etiqueta(frame[y:y + h, x:x + w])
        if et:
            ex, ey, ew, eh = et
            cv2.imwrite(str(dia / f"{nombre}_etiqueta.jpg"), frame[y + ey:y + ey + eh, x + ex:x + ex + ew])
            archivo_etiqueta = f"{dia.name}/{nombre}_etiqueta.jpg"

        registro = self.carpeta / "registro.csv"
        nuevo = not registro.exists()
        with open(registro, "a", newline="") as fh:
            w_csv = csv.writer(fh)
            if nuevo:
                w_csv.writerow(["id", "hora", "x", "y", "ancho", "alto", "velocidad_px_s", "archivo", "etiqueta"])
            w_csv.writerow([nombre, datetime.now().isoformat(timespec="milliseconds"),
                            x, y, w, h, round(p.velocidad(), 1), f"{dia.name}/{nombre}.jpg", archivo_etiqueta])


def main():
    cfg = yaml.safe_load((AQUI / "config.yaml").read_text())
    fuente = sys.argv[1] if len(sys.argv) > 1 else cfg["camara"]
    fuente = int(fuente) if str(fuente).isdigit() else fuente

    cap = cv2.VideoCapture(fuente)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg["ancho"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg["alto"])
    ok, frame = cap.read()
    if not ok and isinstance(fuente, int) and fuente != 0:
        # la numeración cambia según si el iPhone (Cámara de Continuidad) está cerca; 0 siempre existe
        print(f"No se encontró la cámara {fuente}, usando la 0.")
        cap.release()
        cap = cv2.VideoCapture(0)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg["ancho"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg["alto"])
        ok, frame = cap.read()
    if not ok:
        sys.exit(f"No se pudo abrir la cámara o video '{fuente}'. "
                 "En macOS, revisa el permiso de cámara en Configuración > Privacidad y seguridad > Cámara.")

    seg = Seguidor(cfg, frame.shape[1], frame.shape[0])
    ventana = "Seguidor de botellas"
    cv2.namedWindow(ventana)
    cv2.setMouseCallback(ventana, lambda ev, x, y, *_: ev == cv2.EVENT_LBUTTONDOWN and setattr(seg, "linea_x", x))

    pausado, t_prev, fps = False, time.perf_counter(), 0.0
    while True:
        if not pausado:
            ok, frame = cap.read()
            if not ok:
                break
            t = time.perf_counter()
            fps = 0.9 * fps + 0.1 / max(t - t_prev, 1e-6)
            t_prev = t
            vista = seg.procesar(frame, t)
            estado = f"Botellas: {seg.contador}   FPS: {fps:.0f}   Guardar: {'si' if seg.guardar else 'no'}"
            cv2.putText(vista, estado, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, BLANCO, 2)
            cv2.imshow(ventana, vista)

        tecla = cv2.waitKey(1) & 0xFF
        if tecla == ord("q"):
            break
        elif tecla == ord(" "):
            pausado = not pausado
        elif tecla == ord("g"):
            seg.guardar = not seg.guardar
        elif tecla == ord("f"):
            seg.detector.reiniciar()

    cap.release()
    cv2.destroyAllWindows()
    print(f"Botellas contadas: {seg.contador}. Fotos en {seg.carpeta}")


if __name__ == "__main__":
    main()
