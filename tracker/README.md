# Seguidor de botellas (prototipo con webcam)

Programa aparte del inspector. Mira la webcam, detecta lo que se mueve, le pone un ID a cada botella y le saca una foto a color cuando cruza la línea amarilla, que hace de **fotocélula virtual**. Todavía no inspecciona nada: solo junta las fotos que después podría revisar `Inspector.inspect()`.

## Cómo usarlo

Desde la carpeta del repo:

```bash
python3 -m venv .venv
.venv/bin/pip install -r tracker/requirements.txt
.venv/bin/python tracker/seguidor.py
```

La primera vez, macOS pide permiso de cámara para la app desde la que lo corres (Terminal, VS Code, etc.).

1. Deja la cámara quieta, mirando un fondo vacío, y espera un par de segundos para que aprenda el fondo.
2. Pasa una botella de un lado a otro, cruzando la línea amarilla.
3. La caja se pone roja mientras la sigue y verde cuando ya cruzó y quedó registrada.

También funciona con un video: `.venv/bin/python tracker/seguidor.py ruta/al/video.mp4`.

| Tecla | Qué hace |
|---|---|
| `q` | salir |
| `espacio` | pausar |
| `g` | activar o desactivar el guardado de fotos |
| `f` | volver a aprender el fondo (si cambió la luz o se movió la cámara) |
| clic | mover la línea a ese punto |

## Qué guarda

```
tracker/capturas/
  registro.csv                id, hora, posición, tamaño, velocidad (px/s), archivo y etiqueta
  2026-10-25/B00001.jpg       recorte de la botella
  2026-10-25/B00001_etiqueta.jpg   recorte de la etiqueta (si la encontró)
  2026-10-25/B00001_completa.jpg   cuadro completo
```

`capturas/` está ignorada en git.

## Cómo funciona

- **Detección** ([detector.py](detector.py)): resta de fondo (MOG2 de OpenCV). Aprende cómo se ve la escena vacía y marca lo que cambia; se descartan sombras, manchas chicas y cajas casi del ancho del cuadro (la cámara ajustando la exposición). Una etiqueta blanca frente a una pared blanca no se detecta, así que los trozos que quedan uno encima del otro (cuello y base) se unen en una sola caja.
- **Etiqueta** ([etiqueta.py](etiqueta.py)): dentro de la caja de la botella, busca el tramo más largo de filas claras entre el vidrio oscuro. Solo encuentra la parte clara de la etiqueta: zonas oscuras o grises del diseño quedan fuera.
- **Seguimiento** ([tracker.py](tracker.py)): en cada cuadro, cada detección se empareja con la pista más cercana del cuadro anterior. Si una pista no aparece por `cuadros_perdida` cuadros, se borra.
- **Fotocélula** ([seguidor.py](seguidor.py)): cuando el centro de una pista cruza la línea en la dirección configurada, se guarda una vez.

Todos los parámetros están en [config.yaml](config.yaml).

## Limitaciones conocidas

- Detecta todo lo que se mueve: si la botella va en la mano, la mano sale en la misma caja.
- Dos botellas pegadas se ven como una sola.
- Si una botella queda quieta mucho rato (~15 s), pasa a ser parte del fondo.
- Una webcam a 30 FPS desenfoca a la velocidad real de la línea (una botella cada 360 ms). Para la línea hará falta una cámara industrial.

## Prueba sin cámara

```bash
.venv/bin/python tracker/test_tracker.py
```

Genera botellas simuladas moviéndose y revisa que cada una se cuente una vez y se guarde su foto.
