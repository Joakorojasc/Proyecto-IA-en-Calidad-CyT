# Quality AI: cómo usarlo

Quality AI mira cada botella con una o dos cámaras, una a cada lado de la línea, y revisa que tenga sus **dos etiquetas**: la frontal y la trasera. Las botellas pueden pasar giradas: no importa en qué cámara aparezca cada etiqueta. Basta con que, juntando lo que ven las dos cámaras, aparezcan las dos.

> **Importante:** es un prototipo en etapa de prueba. Por ahora solo avisa: **no saca botellas de la línea**. Tampoco revisa si la etiqueta es la correcta (SKU) ni el color, solo si está.

## Qué necesitas

- Un computador con **Chrome**.
- Una o dos cámaras USB fijas, **cada una en un puerto USB distinto**.
- Una botella con sus dos etiquetas y una botella **sin etiquetas**, para enseñarle al programa.

Para abrirlo, en la carpeta del proyecto ejecuta `python3 scripts/servidor.py` y abre `http://localhost:8000/frontend/producto.html` en Chrome. Si después de una actualización ves la versión antigua, recarga con **Cmd + Shift + R** (Mac) o **Ctrl + Shift + R** (Windows).

## 1. Elige la fuente de cada cámara

En **Monitoreo en vivo** hay dos cuadros: **Cámara A** y **Cámara B**. Arriba de cada imagen hay un menú:

- **Cámara real**: elige la cámara por su nombre. El programa la recuerda para la próxima vez.
- **Simulada**: una cámara de mentira que ve la botella girada al azar. Sirve mientras haya una sola cámara. Si eliges **Simulada** en las dos, la línea simulada parte cuando aprietas **Comenzar simulación** (y se detiene con **Detener simulación**).
- **Video de prueba…**: un video grabado, para probar sin estar en la línea.
- **No hay (1 cámara con espejo)** (solo en la B): una sola cámara que ve las dos etiquetas gracias a un espejo detrás de la botella.

Conectar la segunda cámara es solo elegirla en el menú de la Cámara B.

## 2. Calibra (la primera vez, y si cambias de producto, mueves la cámara o cambia la luz)

Entra a **Calibración**. Se calibra por **tipo de etiqueta**, no por cámara.

**Misma posición y encuadre, solo cambia la etiqueta:** la cámara, la luz y el recuadro no se mueven entre una foto y otra. La botella va siempre en el mismo lugar, al centro del recuadro. Lo único que cambia es qué etiqueta mira a la cámara y cuánto está girada.

1. Ajusta el recuadro para que la botella quede al centro y ocupe casi todo su ancho.
2. Sigue los 14 pasos de la guía. Cada paso muestra un dibujo visto desde arriba: la etiqueta frontal en dorado, la trasera en azul y la cámara abajo.
   - Frontal de frente, girada 30° y 60° a cada lado.
   - Trasera de frente, girada 30° y 60° a cada lado.
   - De lado, con la frontal a la derecha y después a la izquierda.
   - Botella sin etiquetas, de frente y girada.
3. En cada paso aprieta **Capturar** (o la barra espaciadora). La guía pasa sola al siguiente.
4. Bajo la imagen aparece **Ahora ve:**. Gira la botella y revisa que reconozca bien cada etiqueta.

## 3. Empieza a revisar

1. Vuelve a **Monitoreo en vivo** con **Disparo automático** encendido.
2. Deja los recuadros vacíos unos segundos, hasta que diga **Esperando botella**.
3. Las botellas se registran solas al cruzar la franja dorada.

Cada botella queda como:

- **OK · las 2**: entre las dos cámaras se vieron la frontal y la trasera.
- **Rechazo** (o **Marcada**, en modo sombra): falta una etiqueta. Se indica cuál.
- **No revisada**: una cámara no vio la botella. **Cuenta como rechazo**, nunca como OK.

## 4. La alerta

Cuando falta una etiqueta, la pantalla se pone **roja** y suena un pitido hasta que aprietas **Reconocer** (o Enter). Si se juntan varios rechazos seguidos aparece **Revisar etiquetadora**: puede que se haya acabado un rollo o que la etiquetadora esté atascada.

### Cámara sin visión

Si una cámara queda **tapada, a oscuras, encandilada, congelada, desenfocada, movida de su lugar o desconectada** por más de 2 segundos, aparece la alerta roja **CÁMARA A SIN VISIÓN** (o B), su cuadro se marca en rojo y suena el pitido. Mientras dure, las botellas que pasen **no se revisan** y quedan como **No revisadas**: nunca como OK. Cuando la cámara vuelve a ver, se avisa cuánto tiempo estuvo ciega. Todo queda anotado en **Registro → Eventos de las cámaras**.

Si dice que **muchas fotos salen movidas**, es solo un aviso: acorta la exposición o sube la luz.

Para probarlo, tapa la cámara con la mano unos segundos. Con las dos cámaras simuladas, usa **Ajustes → Cámara sin visión → Simular 8 segundos**. Si moviste la cámara a propósito, aprieta **Reaprender fondo** (y recalibra si cambió el encuadre).

## 5. Revisa y guarda los resultados

En **Registro** hay una fila por botella: qué vio cada cámara, el resultado y el motivo. Con **Descargar CSV (Excel)** obtienes la lista en un archivo.

**Respaldo en disco.** Si abriste la página con `python3 scripts/servidor.py`, cada botella se guarda además en la carpeta **`datos/`** del proyecto:

- `datos/registro.sqlite`: todas las botellas y los eventos de las cámaras.
- `datos/fotos/AAAA-MM-DD/`: la foto de cada botella **rechazada, no revisada o dudosa**, de las dos cámaras. Sirve de evidencia: con el número de la botella (B00012) se encuentra su foto. Las botellas OK no guardan foto.

El indicador **Respaldo en disco** de arriba dice si se está guardando. Si el servidor se cae, las botellas quedan pendientes y se mandan cuando vuelva. En **Registro** está el enlace **foto A / foto B** de cada rechazo y los botones **CSV del disco (hoy)** y **CSV de eventos**. Para otras fechas: `http://localhost:8000/api/registro.csv?desde=2026-11-01&hasta=2026-11-06`. Si queda menos de 500 MB libres, se dejan de guardar fotos (las filas sí).

## Ajustes de cámara

- **Exposición corta** (1/1000 s o menos), para que la botella en movimiento no salga movida. En **Ajustes** puedes pedírsela a la cámara; si la cámara no lo permite, usa más luz.
- **Buena luz**, pareja y fija, sin reflejos directos sobre la etiqueta.
- **720p** a 30 cuadros por segundo.
- **Cada cámara en un puerto USB distinto**, idealmente de otro controlador. Dos cámaras en el mismo hub pierden cuadros.
- En el registro, la columna **foto movida** avisa cuando una foto salió borrosa. Si aparece seguido, acorta la exposición o sube la luz.

## Para que funcione bien

- **Deja la ventana de Quality AI visible.** Si la minimizas o cambias de pestaña, las botellas de ese rato **no se revisan**.
- **Deja espacio entre las botellas**: el hueco tiene que ser mayor que la franja dorada más lo que avanza la botella en 2 cuadros.
- **Mantén la cámara y la luz estables.** Evita que pasen manos por el recuadro.

## Si algo no funciona

| Qué pasa | Qué hacer |
|---|---|
| La cámara no se activa | Revisa que esté conectada, permite la cámara en Chrome y cierra otros programas que la usen, como Zoom o Teams. |
| Se ve otra cámara | Elige la correcta en el menú de esa cámara. |
| Dice "Falta calibrar" | Haz el paso 2. |
| Dice que el recuadro lleva mucho rato ocupado | Saca lo que esté frente a la cámara. Si no hay nada, aprieta **Reaprender fondo**. |
| No cuenta las botellas | Deja el recuadro vacío y aprieta **Reaprender fondo**. Si sigue igual, sube **Sensibilidad del disparo** en Calibración. |
| Muchas botellas **No revisadas** | Una cámara no está viendo todas las botellas, o el **desfase** entre cámaras no corresponde (Ajustes → Juntar las 2 cámaras). |
| Alerta **SIN VISIÓN** | Lee la causa en la alerta: destapa o limpia el lente, revisa la luz, el foco y el cable USB. Si moviste la cámara a propósito, **Reaprender fondo**. |
| Dice **Sin respaldo en disco** | Abre la página con `python3 scripts/servidor.py` (no con `python -m http.server`). |
| Rechaza botellas buenas | Mejora la luz, revisa **Ahora ve** en Calibración y agrega fotos en los pasos donde falla. |

**Si ves una botella marcada de forma incorrecta,** avísale al equipo del proyecto con el número de la botella que aparece en el Registro.
