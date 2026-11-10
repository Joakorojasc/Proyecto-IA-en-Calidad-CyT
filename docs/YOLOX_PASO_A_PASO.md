# YOLOX en Quality AI: paso a paso

## Qué es

**YOLOX** es un **detector de objetos** con deep learning (una red neuronal). Recibe una imagen y devuelve **rectángulos** con lo que encontró, por ejemplo: "etiqueta frontal en (x, y, ancho, alto), confianza 0,94".

- **No compara con un molde.** Aprende de cientos de ejemplos marcados qué hace que algo sea una etiqueta frontal o una trasera. Por eso la reconoce girada, a medias, en el borde de la botella, con otra luz o con otro fondo.
- Es de la familia **YOLO** ("You Only Look Once"), el estándar para detectar objetos en tiempo real. Lo publicó Megvii en 2021.
- **Licencia Apache 2.0:** uso comercial gratis. La alternativa más conocida, YOLO de Ultralytics, es AGPL: exige comprar licencia o publicar todo el código.
- **Dónde se usa este tipo de modelo:** control de calidad en líneas de producción (piezas faltantes, etiquetas, tapas), conteo de productos, autos autónomos, drones, cámaras de seguridad y retail.

**En Quality AI reemplaza solo "el ojo"** (`motor.js`). El disparo automático, juntar las 2 cámaras, las alertas, el registro y la prueba de capacidad siguen igual.

## Resumen del camino

| # | Paso | Dónde | Tiempo |
|---|---|---|---|
| 1 | Instalar lo necesario | Tu PC | 10 min |
| 2 | Juntar unas 300–400 fotos con un video | Tu PC + cámara | 15 min |
| 3 | Marcar las etiquetas | Roboflow (web, gratis) | 1–2 h |
| 4 | Preparar el dataset | Tu PC | 2 min |
| 5 | Entrenar | Google Colab (GPU gratis) | 30–60 min |
| 6 | Probar y exportar el modelo (.onnx) | Colab | 10 min |
| 7 | Conectarlo a la app | Claude / Manuel | — |

## 1. Instalar

Necesitas Python 3.10 o superior. En la carpeta del proyecto:

```bash
git pull origin mvp-dos-vistas
pip install opencv-python
```

## 2. Juntar fotos (con la cámara Pc02, en vivo)

```bash
python scripts/yolox/capturar_fotos.py --camara 1 --fps 2 --minutos 3
```

- Se abre una ventana con la cámara. El script guarda **2 fotos por segundo** (en 3 minutos, unas 360) en `datos_yolox/fotos/`.
- Descarta solo las fotos **movidas** y las **casi iguales a la anterior**.
- **Espacio** pausa y reanuda; **Q** termina.
- Si se abre la cámara del notebook, prueba `--camara 0` o `--camara 2`.
- Si ya grabaste un video con el celular: `python scripts/yolox/capturar_fotos.py --video mi_video.mp4 --fps 2`.

**Cómo grabar (lo más importante es la VARIEDAD):**

1. **Gira la botella despacio**, varias vueltas completas. **Pasa muchas veces por la posición "de lado"**, que es donde el método actual falla.
2. **Muévela**: más a la izquierda, a la derecha, más cerca y más lejos, deslizándola como si pasara por la línea.
3. **Cambia la luz** cada minuto: luz de techo, ventana, lámpara de costado.
4. **Cambia el fondo** una o dos veces: pared, cartulina, una repisa con cosas.
5. **Tapa una etiqueta con papel** durante unos 30 segundos, y después la otra. Así el modelo aprende que el papel **no** es una etiqueta.
6. Si puedes, pon la cámara en el ángulo y a la altura donde iría en la línea.

Se pueden juntar varias sesiones: cada una se guarda con otro nombre en la misma carpeta.

**Sobre la botella sin etiqueta:** YOLOX **no necesita** fotos de botellas sin etiqueta como una clase aparte. Detecta etiquetas, y si no detecta ninguna, es que no hay. Igual ayuda que un **10% de las fotos no tenga etiquetas visibles** (etiquetas tapadas con papel oscuro, o la foto editada con IA). Así aprende qué **no** es una etiqueta. Para **probar** si detecta la falta de etiqueta, usa la botella con la etiqueta tapada, no una foto hecha con IA.

## 3. Marcar las etiquetas (Roboflow)

1. Crea una cuenta en roboflow.com, luego **New Project → Object Detection**, con el nombre `etiquetas`.
2. **Upload** la carpeta `datos_yolox/fotos/`.
3. **Annotate:** en cada foto, dibuja un rectángulo sobre cada etiqueta visible y elige la clase:
   - `frontal` o `trasera` (exactamente así, en minúscula).
   - Marca **también las etiquetas parciales o en el borde**, aunque se vea solo un pedazo. Eso es lo que más necesita aprender.
   - **Todas** las etiquetas visibles de cada foto. Una sin marcar le enseña que eso "no es etiqueta".
   - El rectángulo, ajustado al borde de la etiqueta.
   - Si una foto no tiene etiquetas visibles (tapadas con papel), márcala como **Null/sin anotaciones**. No la borres.
   - Roboflow tiene **Label Assist**: después de las primeras ~50 fotos, propone los rectángulos y tú solo corriges.
4. **Generate → Export Dataset → formato "COCO"**. No agregues aumentos de datos ahí; YOLOX los hace solo. Descarga el .zip y descomprímelo en `datos_yolox/export/`.

Alternativa sin cuenta: **Label Studio**, en tu PC con `pip install label-studio`, exportando en "COCO with images".

## 4. Preparar el dataset

```bash
python scripts/yolox/preparar_dataset.py datos_yolox/export/train/_annotations.coco.json datos_yolox/export/valid/_annotations.coco.json
```

Arma `datasets/etiquetas/` con el 85% de las fotos para entrenar y el 15% para validar. Dice cuántas etiquetas hay de cada clase: conviene que frontal y trasera tengan cantidades parecidas.

Comprime esa carpeta (`etiquetas.zip`) y súbela a tu Google Drive.

## 5. Entrenar en Google Colab

1. Entra a colab.research.google.com, crea un **cuaderno nuevo** y ve a **Entorno de ejecución → Cambiar tipo → GPU (T4)**.
2. Pega y corre cada bloque, en orden:

```python
# 1) YOLOX y sus dependencias
!git clone https://github.com/Megvii-BaseDetection/YOLOX.git
%cd YOLOX
!sed -i '/onnx-simplifier/d' requirements.txt
!pip install -q -r requirements.txt && pip install -q -v -e . --no-build-isolation
!pip install -q onnx onnxruntime
```

```python
# 2) Tus datos (desde Drive) y la configuración del proyecto
from google.colab import drive; drive.mount('/content/drive')
!unzip -q /content/drive/MyDrive/etiquetas.zip -d datasets/
!wget -q https://raw.githubusercontent.com/Joakorojasc/Proyecto-IA-en-Calidad-CyT/mvp-dos-vistas/scripts/yolox/exp_etiquetas.py
!wget -q https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.pth
!ls datasets/etiquetas
```

Si el repositorio es privado, el `wget` de `exp_etiquetas.py` falla. En ese caso súbelo a mano con el ícono de carpeta de Colab, a `/content/YOLOX/`.

```python
# 3) Entrenar (30–60 min). Parte del modelo ya entrenado con COCO: aprende rápido con pocas fotos.
!python tools/train.py -f exp_etiquetas.py -d 1 -b 16 --fp16 -o -c yolox_tiny.pth
```

Al terminar, el mejor modelo queda en `YOLOX_outputs/etiquetas/best_ckpt.pth`. En el registro del entrenamiento busca **AP50**: es el porcentaje de etiquetas bien encontradas en las fotos de validación, y la meta es **más de 0,9**.

```python
# 4) Exportar a ONNX (el formato que corre en el navegador) y probar con una foto de validación
!python tools/export_onnx.py --output-name etiquetas.onnx -f exp_etiquetas.py -c YOLOX_outputs/etiquetas/best_ckpt.pth
import glob; foto = sorted(glob.glob('datasets/etiquetas/val2017/*.jpg'))[0]
!python demo/ONNXRuntime/onnx_inference.py -m etiquetas.onnx -i "$foto" -o prueba -s 0.3 --input_shape 416,416
from IPython.display import Image; Image(glob.glob('prueba/*')[0])
```

La demo de YOLOX escribe nombres de clases de COCO ("person", "bicycle"). Ignóralos: la clase 0 es **frontal** y la 1 es **trasera**. Lo que importa es que los rectángulos caigan sobre las etiquetas.

```python
# 5) Guardar todo en Drive
!cp etiquetas.onnx YOLOX_outputs/etiquetas/best_ckpt.pth /content/drive/MyDrive/
```

Si un paso da error, copia el mensaje completo y mándalo: la instalación de YOLOX a veces necesita ajustes según la versión de Colab.

## 6. Conectarlo a la app

Con `etiquetas.onnx` listo, se conecta a Quality AI (se deja en `frontend/modelos/`). En el navegador corre con ONNX Runtime Web y en **Calibración** aparece la opción **"Detector: YOLOX"**. YOLOX ya no necesita los 14 pasos; Calibración queda solo para el recuadro y la prueba "Ahora ve". Ese paso lo hacemos juntos cuando tengas el modelo.

## Cómo se decide con 2 cámaras (decisión conjunta)

La decisión **ya es conjunta** (`frontend/botella.js`): una botella es **OK si, sumando las dos cámaras, aparecen la frontal y la trasera**. Si la cámara A ve solo la frontal y la B solo la trasera, la botella **pasa**. Se rechaza solo si **ninguna** de las dos cámaras vio alguna de las etiquetas.

Con YOLOX se puede mejorar usando la **confianza** de cada cámara:

- Para cada etiqueta, la probabilidad de que exista es **P = 1 − (1 − pA) × (1 − pB)**. Si A la ve con 0,6 y B con 0,7, entonces P = 1 − 0,4 × 0,3 = **0,88**. Dos vistas dudosas que coinciden suman confianza.
- **OK** si P ≥ 0,90 para la frontal **y** para la trasera.
- **Dudosa** si P queda entre 0,50 y 0,90. En modo sombra se marca para revisión, con la foto guardada. En producción cuenta como rechazo: mejor revisar que pagar una multa.
- **Rechazo** si P < 0,50 en alguna de las dos: falta esa etiqueta.
- **No revisada** si una cámara no vio la botella: cuenta como rechazo, nunca como OK.
- Solo cuentan las etiquetas **de la botella del centro**: se usa el rectángulo de YOLOX que cae dentro del recuadro, no el de las botellas vecinas.

Los umbrales (0,90 y 0,50) se ajustan con la prueba real. Lo que manda es la meta de **0 botellas sin etiqueta aprobadas**.

## Futuro: colorimetría (fuera del alcance del MVP)

YOLOX dice **dónde** está cada etiqueta, pero **no compara colores**. Para eso haría falta una **tercera capa**:

1. YOLOX encuentra la etiqueta y se recorta.
2. Se corrige la perspectiva: la etiqueta curva se "aplana".
3. Se compara contra una **etiqueta maestra** (la referencia aprobada por Calidad) por zonas, en espacio de color **CIELAB**, midiendo la diferencia **ΔE**. Sobre ~2–3 se considera una diferencia visible.

Requisitos que hacen que hoy quede fuera:

- **Luz controlada y constante** (una caja de luz o un LED difuso) y **balance de blancos fijo** en la cámara. Una webcam con ajuste automático cambia los colores.
- Una **carta de color de referencia** (tipo ColorChecker) visible para calibrar cada cámara.
- Una **etiqueta maestra por SKU**: requiere identificar el SKU primero, que también está fuera del MVP.

**Propuesta para la reunión:** "La colorimetría queda fuera del alcance del MVP. Se puede agregar como tercera capa sobre YOLOX, comparando la etiqueta recortada contra una etiqueta maestra en CIELAB (ΔE), pero exige luz controlada, cámaras calibradas con una carta de color y una etiqueta maestra por SKU."
