# Guion de reunión · Quality AI

## Antes de entrar (5 min)

```bash
git checkout mvp-dos-vistas
git pull origin mvp-dos-vistas
python scripts/servidor.py
```

1. Abrir `http://localhost:8000/frontend/producto.html` en Chrome y recargar con **Ctrl + Shift + R**.
2. Cámara A = **Pc02**, Cámara B = **Simulada**. La calibración ya está guardada: no hay que repetirla.
3. Dejar el **Disparo automático apagado** (modo prueba) y la botella a mano.

## 1. El problema (1 min)

- La viña recibe **multas por botellas sin etiqueta**.
- **Objetivo del MVP:** asegurar que cada botella tenga sus **2 etiquetas** (frontal y trasera), aunque pase **girada**.
- **Fuera del MVP por ahora:** SKU y color.

## 2. Demo en vivo (5–7 min)

| Paso | Qué hacer | Qué decir |
|---|---|---|
| **Monitoreo en vivo, modo prueba** (disparo apagado) | Girar la botella frente a la cámara | "Bajo la cámara dice en vivo qué etiqueta ve: frontal sí o no, trasera sí o no." |
| Tapar la etiqueta con la mano o un papel | Muestra "no" | "Si no ve la etiqueta, lo dice." |
| **Calibración** | Mostrar los 14 pasos y "Ahora ve" | "Le enseñamos cómo se ve cada etiqueta en 5 ángulos, de lado y sin etiqueta. Toma unos 5 minutos y se hace una vez por producto." |
| **Monitoreo**, con las 2 cámaras en **Simulada** y **Comenzar simulación** | Dejar correr 20 s | "Así funciona en línea: detecta cada botella sola, junta las 2 cámaras y marca OK o Rechazo. Cada rechazo dispara la alerta roja." |
| **Registro** | Mostrar la tabla y el CSV | "Cada botella queda registrada, con la foto de evidencia de cada rechazo." |
| **Prueba de capacidad** | Correr 1 minuto a 10.000 por hora | "Aguanta 10.000 botellas por hora: unos 15 ms por botella de 360 ms disponibles." |
| **Ajustes** | Solo mostrar | "Parámetros de la línea: tiempo entre cámaras, rachas y exposición. No hay que tocarlos para operar." |

**Qué hace cada página:**
- **Monitoreo:** operar la línea.
- **Calibración:** enseñarle las etiquetas.
- **Ajustes:** los parámetros de la línea.
- **Registro:** la evidencia.
- **Prueba de capacidad:** el test de velocidad.
- **Prueba sin cámara:** probar con fotos.

## 3. Cómo funciona por dentro (2 min)

1. **Disparo automático:** aprende el fondo vacío. Cuando una botella cruza la franja central, toma la foto más nítida.
2. **Detector:** "desenrolla" la botella (es un cilindro) y la recorre por franjas verticales. Cada franja se compara con trozos de las fotos de calibración: ¿se parece a la frontal, a la trasera o al vidrio? Además mide la textura (letras y dibujos).
3. **Regla de seguridad:** si hay duda, **no** se da la etiqueta por vista. Preferimos rechazar a dejar pasar una botella sin etiqueta.
4. **Juntar las 2 cámaras:** la misma botella se empareja en ambas cámaras. Es **OK** solo si entre las dos se ven la frontal y la trasera. Si una cámara no la vio, queda como **No revisada**, que cuenta como rechazo.
5. Encima de todo esto van la alerta, el vigilante de cámara (tapada, a oscuras, desconectada) y el registro con evidencia.

**Mensaje honesto:**
- Es **visión por computador clásica** con aprendizaje por ejemplos, a partir de unas 14 fotos.
- **A favor:** rápido, sin necesidad de datos para partir, y explica por qué decidió algo.
- **En contra:** es sensible a la luz, los reflejos y el fondo, y no está probado en la planta.

## 4. Próximo paso: IA con un detector de objetos (2 min)

- **Modelo propuesto: YOLOX**, un detector open source con licencia **Apache 2.0**: uso comercial gratis.
  - YOLO de Ultralytics es AGPL: exige comprar licencia (precio por cotización) o publicar todo el código.
- **Cómo se entrena:** se marcan rectángulos sobre cada etiqueta (`frontal` / `trasera`) en imágenes de la línea, y se entrena en Google Colab con GPU gratis.
- **Cuántas imágenes hacen falta:**
  - **Prototipo: 200–300 imágenes.** Cada cuadro trae varias botellas, así que son más de 1.000 etiquetas marcadas.
  - **Producción: unas 1.500 imágenes**, variadas en turnos, luz y lotes.
  - Pasar de 100 a 500 imágenes mejora mucho; sobre ~600 la mejora es poca.
  - Importa más la **variedad** que la cantidad.
- Se cambia **solo el "ojo"**. El disparo, juntar las 2 cámaras, las alertas y el registro ya están hechos.
- **Plan:** comparar el método actual contra YOLOX con la misma prueba y con números.

## 5. Qué necesitamos de la viña

1. Permiso para **grabar 10–15 minutos en la línea**, en distintos momentos, desde donde irían las cámaras.
2. Un tramo donde las botellas pasen **separadas** y sin barandas delante de la etiqueta.
3. **Botellas sin etiqueta o rechazadas** para fotografiar.
4. Saber si después de la etiquetadora las botellas salen **orientadas o al azar**.
5. Un **PC** en la línea y, más adelante, una **2.ª cámara** (unos 30–40 mil pesos).

## Preguntas probables

- **¿Y si la botella pasa girada?** Las 2 cámaras, una a cada lado, ven casi los 360°. La etiqueta puede aparecer en cualquiera de las dos.
- **¿Saca botellas de la línea?** No. Por ahora está en **modo sombra**: solo marca y avisa.
- **¿Cuánto cuesta?** El software es open source. Las cámaras cuestan unos 30–40 mil pesos cada una, más un PC.
- **¿Qué tan confiable es?** En simulación, 0 botellas sin etiqueta aprobadas. Falta la prueba real en la línea. Por eso pedimos el video y las botellas.
