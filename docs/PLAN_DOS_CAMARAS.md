# Plan de trabajo · Quality AI con 1 cámara real + 1 simulada (lista para 2 cámaras)

## Contexto (léelo primero)

**Objetivo del MVP:** asegurar que cada botella tenga sus **2 etiquetas** (frente y reverso). La viña recibe multas por botellas sin etiqueta. **No** se revisa SKU ni color por ahora.

**Situación:** tenemos **1 cámara** (webcam USB "Pc02 4K"). El reverso se **simula** con reglas realistas. Cuando llegue la 2.ª cámara, se conecta **sin reescribir código**.

**Dónde está el código** (rama `mejoras-simulador`):

| Archivo | Qué hace |
|---|---|
| `frontend/producto.html` | App final: Monitoreo en vivo, Frente y reverso (prueba con fotos), Calibración, Registro (CSV). |
| `frontend/motor.js` | Cerebro de inspección. Funciones puras: `rasgos()`, `calibrar()`, `presencia()`. **Reutilizar, no duplicar.** |
| `frontend/index.html` | Simulador/demo antiguo (no tocar salvo enlaces). |
| `scripts/convertir_heic.py` | Convierte fotos HEIC del iPhone a JPG. |
| `tracker/` (rama `seguidor-webcam`, de Manuel) | Seguidor en Python/OpenCV: resta de fondo + fotocelda virtual. Sirve de referencia para el paso 4. |

**Cómo correrlo:**
```bash
python -m http.server 8000
# abrir http://localhost:8000/frontend/producto.html  (no con doble clic: la cámara exige localhost)
```

**Cómo decide hoy el motor si hay etiqueta:** exige **dos señales a la vez**:
1. **Textura** (densidad de bordes): la etiqueta tiene texto y dibujo; el vidrio es liso.
2. **Parecido** con las fotos de referencia (vecino más cercano entre "con etiqueta" y "sin etiqueta").

La tolerancia (por defecto 30) mueve ambas señales.

**Reglas del proyecto:**
- Solo navegador, **sin frameworks ni build** (HTML + JS + CSS planos).
- Textos en español chileno neutro, simples.
- Cambios mínimos y probados antes de decir que funcionan, con números.
- Estilo visual ya definido en `producto.html`: barra lateral azul muy oscura con dorado, títulos Fraunces y texto Geist. No agregar modo oscuro.

---

## Idea central

La app trabaja siempre con **dos estaciones: Frente y Reverso**. Cada estación tiene una **fuente** intercambiable:

```
Estación Frente  ── fuente: Cámara real (Pc02)
Estación Reverso ── fuente: Simulada   → (más adelante) Cámara real
```

Cambiar de simulada a real es elegir otra opción en un menú.

---

## Paso 1 — Fuentes de imagen intercambiables
- Crear `frontend/fuentes.js` con una interfaz común:
  ```js
  fuente.iniciar()   // Promise
  fuente.foto()      // devuelve canvas/ImageBitmap del cuadro actual
  fuente.detener()
  fuente.tipo        // "camara" | "simulada" | "archivo"
  ```
- Implementar las tres fuentes:
  - **Cámara real:** `getUserMedia` con `deviceId`.
  - **Simulada:** usa las reglas del paso 3.
  - **Archivo:** carpeta de fotos o video (`.mov`/`.mp4`) reproducido en bucle.
- En **Calibración**, poner un selector de fuente por estación y guardar la elección en `localStorage` (`qa-cfg`).
- **Listo cuando:** la app funciona igual con cualquier combinación (real+simulada, archivo+archivo, etc.).

## Paso 2 — La botella como unidad
- Modelo:
  ```js
  { id, hora, frente: {presente, motivo, textura, parecido} | null,
              reverso: {...} | null, final: "OK" | "RECHAZO" | "NO_REVISADA" }
  ```
- **Regla:** `OK` solo si **frente.presente && reverso.presente**. Si un lado falta, la botella se rechaza y se indica cuál lado fue.
- Registro y CSV con **una fila por botella**. Columnas: id, hora, frente, reverso, final, motivo, fuente de cada lado.
- **Listo cuando:** el CSV abre bien en Excel (separador `;`, con BOM) y cuadra con los contadores.

## Paso 3 — Reverso simulado con reglas realistas
Configurable en un panel; cada regla con su porcentaje:
- **Correlación:** las fallas vienen en **rachas**, por ejemplo cuando se acaba un rollo o se atasca la etiquetadora. Modelarlo como una cadena de Markov (estado normal ↔ estado de falla).
- **Tipos de falla:**
  - falta de etiqueta (la más común)
  - corrida/desplazada
  - doblada o arrugada
  - pegada a medias
  - botella girada (se ve el costado)
- **Captura:**
  - cambio de luz (±brillo)
  - desenfoque por movimiento
  - reflejos
  - desplazamiento de la zona de la etiqueta
- **Desfase:** el reverso llega entre 50 y 300 ms después que el frente (aleatorio). Esto prepara el emparejamiento del paso 5.
- Las imágenes salen de **fotos reales de reverso**: la de "con etiqueta" se usa tal cual y la de "sin etiqueta" es vidrio, real o generado (ya existe `vidrioSimulado()` en `producto.html`).
- La simulación **conoce la verdad**: cada botella simulada guarda si realmente tenía etiqueta, para medir aciertos.
- **Listo cuando:** se corren 1.000 botellas y se obtiene la tabla verdad vs. decisión (detectadas / se pasaron / buenas rechazadas).

## Paso 4 — Disparo automático (fotocelda virtual)
- Detectar el paso de la botella por la zona, con resta de fondo o diferencia entre cuadros. Ver `tracker/` de Manuel.
- Elegir el **cuadro más nítido** mientras la botella está centrada (varianza del Laplaciano).
- Antirrebote: no contar la misma botella dos veces.
- Ajustar la sensibilidad en Calibración.
- Mantener el botón **Registrar** y la barra espaciadora como respaldo.
- **Listo cuando:** pasando 50 botellas a mano frente a la Pc02, cuenta 50 (±0) y sin duplicados.

## Paso 5 — Emparejar frente y reverso
- Cola por estación. Cada lectura del reverso se une con la botella del frente más antigua que todavía no tenga reverso, dentro de una **ventana de tiempo** configurable.
- Si la ventana vence sin lectura, ese lado queda `null` y la botella queda **NO_REVISADA**, que se trata como rechazo y **nunca** como OK.
- **Listo cuando:** con el desfase simulado, el 100% de las botellas se empareja bien y el registro no muestra cruces.

## Paso 6 — Pantalla del operador
- Dos vistas lado a lado, Frente y Reverso, con el sello **"SIMULADA"** en la que corresponda.
- Alerta grande en rojo + sonido cuando falta una etiqueta, que el operador tiene que reconocer con un clic o tecla.
- Contadores del turno y aviso de **racha** (por ejemplo, 3 rechazos seguidos → "Revisar etiquetadora").
- Debe verse bien en 1366×768 y en 1920×1080.

## Paso 7 — Calibración y ajuste con datos reales
- Guía paso a paso por estación: 3+ fotos con etiqueta y 3+ sin etiqueta, más un checklist.
- Guardar los **casos dudosos** (confianza baja) para revisarlos después.
- Fijar la tolerancia con **fotos reales de botellas sin etiqueta**. Meta: **0 botellas sin etiqueta aprobadas** y **< 2 % de buenas rechazadas**.

## Paso 8 — Prueba de aceptación
- Correr 1.000 botellas simuladas más una sesión real con la Pc02, siguiendo un guion escrito.
- Informe corto (una página) con: faltantes, detectadas, se pasaron y buenas rechazadas, más capturas de pantalla.

## Paso 9 — Conectar la 2.ª cámara (cuando llegue)
1. Conectarla en **otro puerto USB**, idealmente de otro controlador, y usar 720p para no saturar el ancho de banda.
2. En Calibración → estación Reverso → fuente "Cámara real" → elegir el dispositivo.
3. Calibrar el reverso.
4. Repetir la prueba del paso 8.

---

## Orden sugerido

| Etapa | Pasos | Para qué sirve |
|---|---|---|
| Primero | 1 y 2 | Base que todo lo demás necesita |
| Segundo | 3 | El reverso simulado se vuelve realista |
| Tercero | 4 y 5 | La app funciona sola, sin apretar botones |
| Cuarto | 6 | Pantalla lista para el operador |
| Quinto | 7 y 8 | Ajuste con fotos reales y prueba final |
| Después | 9 | Cuando llegue la segunda cámara |

## Cómo probar cada cambio
- **Sin cámara física:** Chromium con cámara falsa:
  ```bash
  chromium --use-fake-device-for-media-stream --use-file-for-fake-video-capture=video.y4m
  ```
  Un `.y4m` se genera con `ffmpeg -i foto.jpg -pix_fmt yuv420p video.y4m`.
- Abrir la consola del navegador: no debe haber errores.
- Reportar siempre con números: botellas, detectadas, se pasaron, buenas rechazadas.

## Fuera de alcance por ahora
SKU, colorimetría, usuarios/roles, servidor o base de datos, integración con SAP o con la máquina FT.

**Nunca** modificar el software de la máquina FT.
