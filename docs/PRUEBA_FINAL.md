# Prueba final con cámara real

Guion para comprobar el MVP frente a la cámara Pc02. Anotar todo con números.

## Antes de empezar

- Abrir `http://localhost:8000/frontend/producto.html` en Chrome (con `python -m http.server 8000` en la carpeta del proyecto).
- Cámara fija, buena luz, 720p. En **Ajustes**, encender **Pedir exposición corta a las cámaras** y anotar lo que responde.
- Revisar que las pruebas sin cámara sigan pasando:
  ```bash
  node scripts/test_disparo.js && node scripts/test_botella.js && node scripts/test_detector.js && node scripts/test_capacidad.js
  ```

## Con una sola cámara: cómo se cubre la 2.ª vista

| Opción | Cámara B | Sirve para |
|---|---|---|
| **Espejo** detrás de la botella | **No hay (1 cámara con espejo)** | Comprobar de verdad botellas sin frontal o sin trasera: la cámara ve las dos caras. |
| **Simulación** | **Simulada** | Probar el conteo, el emparejamiento y la alerta. La vista simulada **no mira la botella real**: no sirve para decidir si a una botella real le falta la etiqueta del lado que la cámara no ve. |

## 1. Calibrar girando la botella

1. **Calibración**: ajustar el recuadro a la botella y seguir los 14 pasos de la guía.
2. Con **Ahora ve**, girar a mano una botella con sus 2 etiquetas una vuelta completa. Anotar en qué ángulos deja de ver alguna etiqueta.

## 2. Conteo: 30 botellas con giro al azar

1. **Monitoreo en vivo**, **Disparo automático** encendido, **Reiniciar contadores**.
2. Pasar 30 botellas, cada una girada al azar, de a una y cruzando la franja dorada.
3. Anotar: botellas pasadas (30), contadas, duplicadas y no contadas. **Meta: 30 de 30, 0 duplicados.**

## 3. Detección: 20 botellas mezcladas

Preparar 20 botellas y anotar en papel el orden: 8 con las 2 etiquetas, 6 sin frontal y 6 sin trasera. Pasarlas mezcladas, con giro al azar (con espejo, Cámara B = **No hay**).

| | Cantidad | Rechazadas | Aprobadas |
|---|---|---|---|
| Con las 2 etiquetas | 8 | (buenas rechazadas) | |
| Sin frontal | 6 | (detectadas) | **(se pasaron: meta 0)** |
| Sin trasera | 6 | (detectadas) | **(se pasaron: meta 0)** |

Comparar con el **Registro** (descargar el CSV) y revisar que la alerta roja haya aparecido en cada rechazo.

## 4. Capacidad

En **Prueba de capacidad**, correr 10 minutos a 10.000 botellas por hora con la pestaña visible. Descargar el informe. **Meta:** conteo exacto, 0 duplicados, 0 emparejamientos fallidos, 0 sin etiqueta aprobadas, menos de 2 % de buenas rechazadas.

## Métricas de éxito

- 0 botellas sin una etiqueta aprobadas (prioridad, por las multas).
- Menos de 2 % de buenas rechazadas.
- Conteo exacto a 10.000 por hora.
- Detección correcta con cualquier giro de la botella.
