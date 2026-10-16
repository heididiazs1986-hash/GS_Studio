# GS Studio — herramientas PDF generales

**GS Studio es una herramienta independiente para trabajar con cualquier PDF.** Abrir documentos externos (contratos, facturas, certificados, formularios, informes) **no requiere pasar por GS Editor**.

## Entrada habitual (independiente)
Abrir `gs-studio/index.html` servido desde el mismo sitio que GS Documentos. Elegir Unir, Organizar, Dividir o Firmar; cargar cualquier PDF con el selector de archivos y generar un nuevo PDF. Para convertir fotografías, elegir Imágenes a PDF y cargar JPG o PNG.

## Entrada opcional desde GS Editor
La tarjeta GS Editor abre el editor existente dentro de GS Studio. Al pulsar Generar ZIP corregido, mantiene la descarga original y envía una **copia** a Studio. El módulo extrae únicamente los PDF para su organización o firma. Los soportes y el manifiesto permanecen **exclusivamente en el ZIP corregido original**, no en el PDF que Studio genera.

## Garantías de aislamiento
- `GS Documentos` de campo continúa en la ruta principal; GS Studio está en una ruta nueva y separada.
- Los originales seleccionados no se sobreescriben. Las herramientas descargan un documento nuevo.
- No hay dependencia funcional entre las herramientas PDF generales y la apertura de ZIP.
- La conexión entre el editor incrustado y Studio comprueba el origen del mensaje y la ventana remitente.
- No hay transmisión de documentos a una API del producto; el trabajo PDF se realiza en memoria del navegador.

## Limitaciones conocidas / pendiente de aprobación
- **En desarrollo: no usar con documentos sensibles de producción hasta validar las pruebas.**
- Las bibliotecas se cargan actualmente desde CDN; aún no está garantizado trabajar sin internet. Antes del lanzamiento se deben empaquetar y servir localmente.
- El tamaño máximo práctico depende de la memoria disponible en navegador/computador; no hay un límite comercial impuesto.
- La firma incorporada es una **imagen manuscrita visual**, no una firma digital criptográfica. No debe insertarse fuera de los límites de página; las páginas giradas exigen exportar y reabrir antes de firmar.
- Organizar y añadir firma no equivalen a modificar texto existente; edición de texto y compresión avanzada requieren una fase posterior.
- Al unir PDFs con campos AcroForm interactivos, verificar los campos/visualización: `pdf-lib.copyPages` no garantiza preservación de interactividad en todos los PDF.
- Los soportes y demás archivos de los ZIP GS no se incluyen en PDFs fusionados; se conservan en el ZIP original.
- Las pruebas automatizadas propuestas (`tests/studio.browser.cjs`) deben pasar en Chromium, junto con regresiones previas del editor y GS Documentos.

## Comprobaciones esperadas
1. Iniciar GS Studio y abrir un PDF de cualquier origen sin pasar por GS Editor.
2. Unir dos PDF y verificar orden y número de páginas.
3. Organizar, girar, eliminar y dividir páginas; generar un archivo diferente al original.
4. Convertir PNG a PDF, firmar con PNG o dibujo y comprobar que el resultado se abre.
5. Abrir ZIP en GS Editor, corregir y descargar; recibir en Studio sus PDF y conservar todos los soportes en el ZIP corregido.
6. Ejecutar `npm ci`, `node --test tests/studio.browser.cjs`, `npm test` y `npm run test:browser`.
