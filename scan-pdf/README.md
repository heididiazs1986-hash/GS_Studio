# Escanear PDF — exclusivo para celular

Ruta: `/scan-pdf/`. Se accede desde la tarjeta «Escanear PDF» de GS Studio solamente en teléfonos. No forma parte del editor de escritorio. En el navegador se detecta un teléfono mediante las señales `navigator.userAgentData.mobile` o `iPhone/iPod/Android Mobile`.

## Flujo
1. Abrir la cámara (con autorización expresa) o seleccionar fotografías del teléfono.
2. **Detección en vivo** de la hoja: contorno naranja sobre la cámara. Con «Auto» activo, la foto se toma sola cuando la hoja queda quieta ≈0,7 s (el anillo del botón se va llenando). También se puede capturar con el botón. Si el teléfono lo permite aparece la linterna 🔦.
3. Vista previa con el recorte y el acabado ya aplicados. Si no se detectaron bordes con claridad, se abre directamente el ajuste de esquinas (con **lupa** al arrastrar un punto).
4. Acabado: **Auto** (quita sombras y deja el papel blanco), **Original**, **Grises**, **B/N** (texto negro limpio sobre blanco).
5. «↻ Girar la hoja» si quedó de lado. Guardar la página y repetir para documentos multipágina.
6. Ordenar con «↕ Mover», girar o eliminar páginas.
7. Generar PDF: descarga un archivo nuevo y después se liberan los objetos y fotografías en memoria. No se borra el archivo guardado en el teléfono.

## Cómo funciona (`engine.js`)
Sin dependencias ni descargas; todo corre en el teléfono y también sin conexión.
- **Detección:** segmentación del papel por varios umbrales (Otsu, centro vs. borde, filtro de color para mesas de madera), mayor región conectada, casco convexo reducido a 4 vértices y puntuación por el soporte real de borde (que el papel sea más claro por dentro a lo largo de cada lado), solidez, ángulos y proporción. Se descartan candidatos dudosos en lugar de inventar un recorte.
- **Afinado:** sobre una copia de 900 px se busca el borde real a lo largo de cada lado, se ajusta una recta robusta por lado y se recalculan las esquinas (error típico ≈2–3 px en fotos de 3000 px).
- **Perspectiva:** homografía con remuestreo bilineal. La proporción real de la hoja se estima corrigiendo la perspectiva y se ajusta a A4, Carta, Oficio o Legal si coincide (±3,5 %).
- **Acabado:** el «blanco del papel» se estima por bloques (percentil alto + suavizado) y cada píxel se normaliza contra él: se eliminan sombras y degradados de luz y se corrige el tono del papel; después, curva de niveles y nitidez. El B/N usa umbral adaptativo sobre esa misma normalización.
- **Captura:** si el navegador ofrece `ImageCapture`, se usa la foto completa del sensor; si no, un cuadro de video. La resolución de trabajo es de hasta 3200 px y la página final de hasta 2480 px (≈210 ppp en A4).
- **PDF:** cada página queda con tamaño real de hoja (A4 / Carta / Oficio / Legal, o ajustada a A4). El giro de página se aplica en el PDF, sin recomprimir la imagen. `pdf-lib` se incluye en `vendor/` (funciona sin internet).

## Privacidad y limitaciones
- Las fotografías se procesan localmente, sin servicio de OCR, sin API de subida y sin almacenamiento persistente propio.
- Requiere permiso de cámara en navegador seguro HTTPS; si `getUserMedia` no está disponible se ofrece captura con cámara del dispositivo mediante selector.
- La detección sigue siendo *orientativa*: papel blanco sobre mesa blanca, hojas cortadas por el encuadre o fondos con mucho dibujo pueden impedir reconocer los bordes; en ese caso se abre el ajuste manual.
- Linterna, enfoque continuo y foto de sensor completo dependen del navegador y del teléfono (Chrome en Android suele ofrecerlos; Safari en iPhone no).
- No hay integración con escáneres físicos. No edita documentos ya existentes: para eso está «Editar PDF».
- **No OCR** de manera deliberada.
- Una vez iniciada la descarga se limpia la sesión; el navegador no confirma que el archivo haya terminado de guardarse. Verificar el PDF descargado.
- Si se cierra la página antes de generar el PDF, el trabajo sin guardar se pierde.

## Verificaciones previas a publicación definitiva
- Android Chrome y iPhone Safari: permisos de cámara, captura automática, linterna y galería.
- Cuatro esquinas en fotos inclinadas, en retrato y paisaje; páginas con borde poco contrastado.
- Ordenar, girar, eliminar y descargar PDFs de varias páginas; comparar recortes y rotaciones.
- Fluidez de la detección en vivo y del acabado en teléfonos de gama baja.
- Confirmar que el acceso está oculto en computador y que el módulo bloquea el uso directo fuera del móvil.
