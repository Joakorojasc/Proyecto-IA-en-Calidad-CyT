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

## 6. Conectarlo a la app (ya está programado)

1. Copia `etiquetas.onnx` a **`frontend/modelos/etiquetas.onnx`**.
2. Solo la primera vez, con internet, baja el motor para que funcione sin conexión en la línea: `python scripts/yolox/bajar_ort.py`. Sin este paso, la página lo descarga de internet cada vez.
3. Abre la app y ve a **Calibración → Detector de etiquetas → YOLOX (modelo entrenado)**. Debe decir "modelo cargado · entrada 416 px · 2 clases". También puedes elegir otro archivo con **Cargar otro modelo**.
4. Con YOLOX **no se usan los 14 pasos**: se ocultan. Solo ajusta el recuadro a la botella y revisa con **Ahora ve**, girándola una vuelta. Sobre la imagen se dibujan las cajas que encontró: **dorada = frontal, azul = trasera**. Las cajas tenues son de botellas vecinas y no cuentan.
5. En **Monitoreo**, con el disparo apagado (modo prueba), cada cámara muestra en vivo "Frontal: sí (94%)" y cuántos ms tarda YOLOX por foto.

Para volver al método anterior, elige **Clásico**: la calibración de 14 pasos sigue guardada.

**Probado sin modelo real:** el pre y post proceso tiene pruebas automáticas (`node scripts/test_yolox.js`). Además, la app completa se probó en Chrome con un modelo de prueba de la misma forma que YOLOX: carga el motor desde `frontend/vendor/ort/`, detecta la frontal (94%), descarta la etiqueta de una botella vecina y rechaza por falta de trasera. Con el modelo entrenado de verdad falta medir cuánto acierta y cuánto tarda en tu PC.

## Cómo se decide con 2 cámaras (decisión conjunta, ya programada)

Las dos cámaras miran la línea desde lados opuestos. **La decisión es de las dos juntas** (`frontend/botella.js`): no importa qué cámara vea qué etiqueta.

- Para cada etiqueta, YOLOX da en cada cámara la probabilidad de que esté (pA, pB). Se juntan: **P = 1 − (1 − pA) × (1 − pB)**.
  - A ve la frontal con 0,96 y B no la ve: P = 0,96 → la frontal está.
  - Botella de lado: A y B ven la misma etiqueta a medias, cada una con 0,7: P = 1 − 0,3 × 0,3 = **0,91** → está. Dos vistas parciales que coinciden suman confianza.
- **OK** si P ≥ 90% en la frontal **y** en la trasera.
- **Dudosa** si alguna queda entre 50% y 90%: se rechaza, se marca "dudosa" y se guarda la foto de las dos cámaras para revisarla.
- **Rechazo** si alguna queda bajo 50%: falta esa etiqueta (el motivo dice cuál y con qué probabilidad).
- **No revisada** si una cámara no vio la botella: rechazo, nunca OK.
- Solo cuentan las etiquetas de la botella del centro del recuadro, no las de las botellas vecinas.

Los umbrales (90% y 50%) se cambian en **Calibración → Detector de etiquetas**. Se ajustan con la prueba real: la meta es **0 botellas sin etiqueta aprobadas**.

## Dónde poner las 2 cámaras (todas las posiciones de la botella)

`python scripts/cobertura_camaras.py` calcula, para cada giro posible de la botella, qué parte de cada etiqueta alcanza a ver la mejor cámara. Supone una botella de 75 mm de diámetro, una frontal de ~90 mm de ancho (140° de la vuelta), una trasera de ~70 mm (105°) y que una cámara ve bien hasta ±70° de su eje. Con tus medidas reales: `--frontal` y `--trasera`.

| Montaje | Giros donde una etiqueta se ve a menos de la mitad | Peor caso |
|---|---|---|
| **2 cámaras enfrentadas** (una a cada lado de la línea, a la misma altura, apuntando al centro de la botella) | **22%** de los giros | botella de lado (90°): cada cámara ve ~31% de cada etiqueta |
| 2 cámaras enfrentadas + 2 espejos (4 vistas) | 0% | 68% visible |
| 3 cámaras a 120° | 0% | 57% visible |
| 4 cámaras a 90° | 0% | 68% visible |

**Qué significa:**

1. **Con 2 cámaras enfrentadas, el caso difícil es la botella de lado.** Ninguna cámara ve una etiqueta completa: cada una ve un pedazo en el borde. La salida es que **YOLOX reconozca etiquetas parciales** (por eso hay que **marcar también los pedazos** al etiquetar) y que **la decisión conjunta sume las dos vistas** (0,7 + 0,7 → 0,91).
2. Si en la prueba real las botellas de lado salen como **dudosas** muy seguido, hay dos arreglos baratos: **2 espejos** (un espejo detrás de la botella, en ángulo, frente a cada cámara: cada una ve además el costado) o **una 3.ª cámara**. Es una decisión de montaje. Con espejos, el recuadro de cada cámara tiene que abarcar la botella y sus reflejos, y la "zona central" que descarta botellas vecinas hay que ampliarla para que cuenten las etiquetas del espejo. Ese ajuste todavía no está programado: se hace si la prueba real lo pide.
3. **Montaje recomendado para las 2 Pc02:**
   - Una a cada lado de la cinta, **enfrentadas** (180°), a la altura del centro de la etiqueta y a 25–40 cm.
   - **Cada una en un puerto USB distinto**, a 720p.
   - Las dos con el mismo tipo de fondo liso detrás de la botella (por ejemplo, una plancha mate en la baranda del frente) y **luz difusa** sin reflejos directos.
   - Si se puede, una pequeña separación entre botellas, para que la fotocelda virtual las distinga.

## Dos cámaras iguales

Las dos Pc02 tienen el mismo nombre. En el menú de cada cámara aparecen como **"Web Camera (6211:e904) · n.º 1 (ab12)"** y **"n.º 2 (cd34)"**. El número entre paréntesis es el comienzo de su identificador. Para saber cuál es cuál, tapa una con la mano y mira qué imagen se oscurece. El programa recuerda cada una por su identificador. Si cambias una de puerto USB, puede que tengas que elegirla de nuevo. Si las dos estaciones quedan con la misma cámara, la app avisa.

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
