# Quality AI: cómo usarlo

Quality AI mira cada botella con una cámara y revisa si tiene etiqueta. Cuando una botella pasa frente a la cámara, el programa la revisa y la anota solo.

> **Importante:** es un prototipo en etapa de prueba y todavía no se ha probado en la línea. Por ahora solo avisa: **no saca botellas de la línea**. Tampoco revisa si la etiqueta es la correcta o si el color está bien, solo si está.

## Qué necesitas

- Un computador con el navegador **Chrome**.
- Una cámara conectada y fija. Si la cámara se mueve, hay que volver a prepararla.
- Algunas botellas **con** etiqueta y otras **sin** etiqueta para enseñarle al programa. Si no tienes botellas sin etiqueta, tapa la etiqueta con un papel oscuro.

Quien te entregó el programa te indicará cómo abrirlo. Se abre en Chrome, como una página web.

## 1. Enséñale cómo se ve la botella

Hazlo la primera vez, y de nuevo si cambias de producto, mueves la cámara o cambia mucho la luz.

1. Entra a **Monitoreo en vivo** y aprieta **Activar cámara**. Si Chrome pide permiso, acepta.
2. Entra a **Calibración** y elige **Frente** o **Reverso**, según el lado que está mirando la cámara.
3. Pon una botella con etiqueta frente a la cámara, dentro del recuadro, y aprieta **Capturar de la cámara** en la sección **Con etiqueta**. Repite moviéndola un poco. Se necesitan al menos 3 fotos, pero lo ideal son 8 o más.
4. Haz lo mismo en la sección **Sin etiqueta**, con al menos 3 fotos.

## 2. Empieza a revisar

1. Vuelve a **Monitoreo en vivo**.
2. Revisa que **La cámara mira** indique el lado correcto y que **Disparo automático** esté encendido.
3. Deja el recuadro vacío unos segundos, hasta que abajo diga **Esperando botella**.
4. Pasa las botellas de a una, de manera que crucen la franja dorada del centro del recuadro.

Cada botella queda anotada como **Con etiqueta** o **Sin etiqueta**. Los resultados y los contadores se ven en la misma pantalla.

También puedes anotar una botella a mano con el botón **Registrar botella** o con la barra espaciadora.

## 3. Revisa y guarda los resultados

Entra a **Registro** para ver cada botella con su foto, su hora y su resultado. Con **Descargar CSV (Excel)** obtienes la lista en un archivo.

El registro queda guardado solo en ese computador. Descárgalo si quieres conservarlo.

## Para que funcione bien

- **Deja la ventana de Quality AI visible.** Si la minimizas o cambias de pestaña, las botellas de ese rato **no se revisan**. Al volver, aparece un aviso.
- **Deja espacio entre las botellas.** Si pasan muy juntas o pegadas, el programa no alcanza a separarlas y puede contar menos.
- **Usa buena luz.** Si la foto sale movida, el programa puede marcar como "Sin etiqueta" una botella que sí la tiene.
- **Mantén la cámara y la luz estables.** Evita que pasen personas o manos por el recuadro, porque también pueden contarse como botellas.

## Si algo no funciona

| Qué pasa | Qué hacer |
|---|---|
| La cámara no se activa | Revisa que esté conectada, permite la cámara en Chrome y cierra otros programas que la usen, como Zoom o Teams. |
| Se ve otra cámara | Elige la correcta en la lista que aparece bajo la imagen. |
| Dice "Falta calibrar" | Haz el paso 1 para el lado que está mirando la cámara. |
| Dice que el recuadro lleva mucho rato ocupado | Saca lo que esté frente a la cámara. Si no hay nada, aprieta **Reaprender fondo**. |
| No cuenta las botellas | Deja el recuadro vacío y aprieta **Reaprender fondo**. Si sigue igual, sube **Sensibilidad del disparo** en Calibración. |
| Cuenta botellas que no pasaron | Aprieta **Reaprender fondo** con el recuadro vacío. Si sigue igual, baja **Sensibilidad del disparo**. |
| Marca "Sin etiqueta" en botellas que sí la tienen | Mejora la luz, pasa las botellas más lento y agrega más fotos en Calibración. |

**Si ves una botella marcada de forma incorrecta,** avísale al equipo del proyecto y, si puedes, indícale el número de la botella que aparece en el Registro. Esos casos ayudan a mejorar el programa.
