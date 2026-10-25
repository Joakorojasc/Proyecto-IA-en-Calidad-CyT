"""Encuentra lo que se mueve frente a la cámara con resta de fondo."""
import cv2


class Detector:
    def __init__(self, area_minima: float, ancho_maximo: float = 1.0):
        self.area_minima = area_minima
        self.ancho_maximo = ancho_maximo
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        self.reiniciar()

    def reiniciar(self):
        """Vuelve a aprender el fondo desde cero (útil si cambió la luz o se movió la cámara)."""
        self.fondo = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=True)

    def __call__(self, frame):
        """Devuelve las cajas (x, y, w, h) de los objetos en movimiento y la máscara usada."""
        mascara = self.fondo.apply(frame)
        mascara = cv2.threshold(mascara, 200, 255, cv2.THRESH_BINARY)[1]  # las sombras quedan en 127
        mascara = cv2.morphologyEx(mascara, cv2.MORPH_OPEN, self.kernel)
        mascara = cv2.dilate(mascara, self.kernel, iterations=2)
        contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_px = self.area_minima * frame.shape[0] * frame.shape[1]
        cajas = unir_apiladas([cv2.boundingRect(c) for c in contornos if cv2.contourArea(c) >= min_px])
        # cajas casi del ancho del cuadro suelen ser la cámara ajustando la exposición, no una botella
        cajas = [c for c in cajas if c[2] <= self.ancho_maximo * frame.shape[1]]
        return cajas, mascara


def unir_apiladas(cajas):
    """Une cajas que se traslapan en horizontal (una encima de otra).

    Una etiqueta clara sobre un fondo claro no se detecta, así que la botella aparece partida
    en cuello y base; esto las vuelve a juntar en una sola caja.
    """
    cajas = sorted(cajas)
    unidas = []
    for x, y, w, h in cajas:
        if unidas:
            ux, uy, uw, uh = unidas[-1]
            if x < ux + uw:  # se traslapan en x
                x0, y0 = min(ux, x), min(uy, y)
                x1, y1 = max(ux + uw, x + w), max(uy + uh, y + h)
                unidas[-1] = (x0, y0, x1 - x0, y1 - y0)
                continue
        unidas.append((x, y, w, h))
    return unidas
