"""¿Qué tanto de cada etiqueta alcanzan a ver las cámaras, según cómo gire la botella?

Modelo simple, visto desde arriba: la botella es un cilindro; la etiqueta frontal está centrada en el ángulo θ (el giro
al azar con que pasa) y la trasera en θ + 180°. Una cámara ve bien la superficie hasta ±70° de su eje: más allá la
etiqueta queda tan aplastada contra el borde que no sirve. Para cada giro se calcula qué fracción de cada etiqueta
ve la mejor cámara.

Uso: python scripts/cobertura_camaras.py [--frontal 140] [--trasera 105] [--max 70] [--min 0.5]
  --frontal / --trasera: ancho de cada etiqueta en grados de la vuelta (ancho en mm / perímetro × 360)
  --min: fracción de la etiqueta que una cámara tiene que ver para reconocerla (YOLOX entrenado con etiquetas a medias: ~0,4-0,5)
"""
import argparse


def visible(centro, mitad, camara, amax):
    """Fracción de la etiqueta [centro ± mitad] dentro de [camara ± amax] (en grados, con vuelta)."""
    paso, dentro, total = 0.5, 0, 0
    a = centro - mitad
    while a <= centro + mitad:
        d = (a - camara + 180) % 360 - 180
        dentro += abs(d) <= amax
        total += 1
        a += paso
    return dentro / total


CONFIGS = {
    "2 cámaras enfrentadas (una a cada lado)": [0, 180],
    "2 cámaras enfrentadas + 2 espejos (4 vistas)": [0, 90, 180, 270],
    "3 cámaras a 120°": [0, 120, 240],
    "4 cámaras a 90°": [0, 90, 180, 270],
}

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--frontal", type=float, default=140, help="ancho de la etiqueta frontal en grados (90 mm en una botella de 75 mm ≈ 140°)")
    p.add_argument("--trasera", type=float, default=105, help="ancho de la etiqueta trasera en grados (70 mm ≈ 105°)")
    p.add_argument("--max", type=float, default=70, help="hasta qué ángulo del eje de la cámara la superficie se ve útil")
    p.add_argument("--min", type=float, default=0.5, help="fracción mínima de la etiqueta que una cámara tiene que ver")
    a = p.parse_args()
    print(f"Etiquetas: frontal {a.frontal:.0f}°, trasera {a.trasera:.0f}° · zona útil ±{a.max:.0f}° · reconoce desde {a.min:.0%} visible\n")
    for nombre, camaras in CONFIGS.items():
        malos, peor = [], (1, None)
        for theta in range(0, 360):
            vf = max(visible(theta, a.frontal / 2, c, a.max) for c in camaras)
            vt = max(visible(theta + 180, a.trasera / 2, c, a.max) for c in camaras)
            m = min(vf, vt)
            if m < peor[0]:
                peor = (m, theta)
            if m < a.min:
                malos.append(theta)
        print(f"{nombre}:")
        print(f"   giros donde alguna etiqueta no alcanza a verse lo suficiente: {len(malos)} de 360 ({len(malos) / 3.6:.0f} %)")
        print(f"   peor caso: la botella girada {peor[1]}°, la mejor cámara ve solo el {peor[0]:.0%} de una etiqueta\n")
