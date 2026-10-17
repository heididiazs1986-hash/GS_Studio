# Escanear PDF — exclusivo para celular

Ruta: `/scan-pdf/`. Se accede desde la tarjeta «Escanear PDF» de GS Studio solamente en teléfonos. No forma parte del editor de escritorio. En el navegador se detecta un teléfono mediante las señales `navigator.userAgentData.mobile` o `iPhone/iPod/Android Mobile`.

## Flujo
1. Abrir cámara tras autorización expresa, o seleccionar fotografías en el teléfono.
2. Detectar aproximadamente las cuatro esquinas; ajustar los cuatro puntos naranjas arrastrándolos (siempre revisar el resultado).
3. Elegir acabado Color / Mejorado / Grises / Blanco y negro.
4. Añadir la hoja. Repetir para documentos multipágina.
5. Ordenar mediante el control «↕ Mover», girar/eliminar páginas.
6. Generar PDF: descarga un archivo nuevo y después se liberan los objetos y fotografías en memoria. No se borra el archivo guardado en el teléfono.

## Privacidad y limitaciones
- Las fotografías se procesan localmente, sin servicio de OCR, sin API de subida y sin almacenamiento persistente propio.
- Requiere permiso de cámara en navegador seguro HTTPS; si `getUserMedia` no está disponible se ofrece captura con cámara del dispositivo mediante selector.
- Detección automática *orientativa*: fondos complejos o luz irregular pueden impedir reconocer los bordes; el usuario controla el recorte final.
- Conversión por perspectiva usando homografía y remuestreo bilineal; la resolución de salida se limita para reducir problemas de memoria en teléfonos.
- No hay integración con escáneres físicos. No edita documentos ya existentes: para eso está «Editar PDF».
- **No OCR** de manera deliberada.
- `pdf-lib` se carga desde un CDN; abrir la interfaz sin conexión a internet no garantiza que funcione la exportación. No utilizar fotografías sensibles hasta completar las pruebas móviles de cámara, recorte y descarga.
- Una vez iniciada la descarga se limpia la sesión; el navegador no confirma que el archivo haya terminado de guardarse. Verificar el PDF descargado.
- Si se cierra la página antes de generar el PDF, el trabajo sin guardar se pierde.

## Verificaciones previas a publicación definitiva
- Android Chrome y iPhone Safari: permisos de cámara, captura y galería.
- Cuatro esquinas en fotos inclinadas, en retrato y paisaje; páginas con borde poco contrastado.
- Ordenar, girar, eliminar y descargar PDFs de varias páginas; comparar recortes y rotaciones.
- Confirmar que el acceso está oculto en computador y que el módulo bloquea el uso directo fuera del móvil.
