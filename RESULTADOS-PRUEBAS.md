# Resultados de las pruebas — MegaFlow 3.3.0

Fecha de ejecución: 5 de noviembre de 2026. Entorno: Linux, Node.js 22, **Chromium 153** (Playwright 1.63) contra un servidor HTTP estático que publica la app en la subruta `/megaflow/` (equivalente a GitHub Pages).

## Cambio de la v3.3: expediente en A4 horizontal, 2 páginas por hoja

- Con el lote real de 28 pedidos el PDF tiene **56 hojas A4 horizontales (841,89 × 595,28 pt) y 112 páginas**.
- En los 28 pedidos, comprobado hoja por hoja: **hoja 1 = factura | copia idéntica**, **hoja 2 = orden de compra | prevalidación**, y ningún texto cruza la línea central.
- Reducción proporcional: factor 0,7070 en ancho y en alto respecto del original, desvío 0 pt (sin deformar ni recortar).
- Línea de corte punteada al centro (cubre el 57 % de la altura, trazo 4/3); con la casilla desactivada desaparece.
- El QR de la prevalidación y el código de barras de la factura se siguen leyendo en el PDF final.
- El formato A5 (una página por hoja, 112 páginas) sigue disponible como opción y también se probó.

## Resumen

| Prueba | Resultado |
|---|---|
| Unitarias (`npm test`) | **46/46 correctas** |
| E2E, lote real 30/10/2026, Chromium | **87/88 correctas** |
| E2E, lote real, emulación de Safari | **88/89 correctas** |
| E2E, documentos sintéticos | **85/88 correctas**, 2 no ejecutadas (los sintéticos no tienen QR/código de barras reales) |
| Rendimiento 100 pedidos | 200 hojas A4 (400 páginas) generadas y revisadas en 4.0 s; 2 Excel en 0.9 s |

## Lote real del 30 de octubre de 2026 (Chromium)

Documentos reales usados solo localmente; no forman parte del proyecto. Se omite la columna de detalle por privacidad.

| Grupo | Comprobación | Resultado |
|---|---|---|
| Arranque | La app inicia en un servidor HTTP estático con subruta /megaflow/ | OK |
| Arranque | Sin librerías externas al cargar (PDF.js, pdf-lib y ExcelJS se cargan bajo demanda desde vendor/) | OK |
| Tema | Cambia a oscuro (fondo #11151D, tarjetas #1B2230, texto claro) | OK |
| Tema | Logo con texto blanco en oscuro y logo original en claro | OK |
| Tema | Vuelve a claro (fondo #F6F8FC) | OK |
| Tema | La preferencia de tema persiste al recargar (única preferencia guardada) | OK |
| Carga | Botón "Seleccionar PDF" abre el explorador y el archivo aparece en pantalla | OK |
| Carga | Lectura real: 28 pedidos detectados tras seleccionar | OK |
| Carga | Se muestran nombre, tamaño y páginas detectadas | OK |
| Carga | Evita agregar el mismo archivo dos veces | OK |
| Carga | Eliminar un archivo individualmente | OK |
| Carga | Agregar nuevamente el mismo archivo después de eliminarlo | OK |
| Carga | Accesible con teclado: Enter sobre el área abre el explorador | OK |
| Carga | Detecta el mismo contenido con otro nombre (huella SHA-256) | OK |
| Carga | Arrastrar: resalta el área y muestra "Suelta tus archivos aquí" | OK |
| Carga | Arrastrar: el evento drop se gestiona (preventDefault) y se quita el resaltado | OK |
| Errores | Archivo que no es PDF → error comprensible | OK |
| Errores | Archivo vacío → error | OK |
| Errores | PDF dañado → error | OK |
| Errores | PDF escaneado → aviso "parece escaneado" | OK |
| Errores | PDF con contraseña → error | OK |
| Errores | Con archivos inválidos el análisis se bloquea y explica el motivo | OK |
| Carga | El botón no queda en "Procesando" tras un error | OK |
| Carga | Quedan solo los archivos válidos tras eliminar los inválidos | OK |
| Errores | Factura colocada en el área de órdenes → aviso "parecen factura" | OK |
| Fechas | Tres meses calendario: 01/11/2026 → 01/02/2027 | OK |
| Fechas | 90 días exactos: 01/11/2026 → 30/01/2027 | OK |
| Fechas | La fecha manual no se sobrescribe al cambiar la fecha de factura | OK |
| Proceso 1 | Resumen: 28 órdenes | OK |
| Proceso 1 | 28 facturas a generar | OK |
| Proceso 1 | Tabla con 28 filas (una por orden, sin agrupar tiendas) | OK |
| Proceso 1 | Validaciones superadas (sin diferencias) | OK |
| Proceso 1 | Progreso termina en "Finalizado" solo con archivos generados | OK |
| Proceso 1 | Lista de comprobaciones: todas correctas | OK |
| Descargas | Botón "Descargar ambos" descarga los dos Excel | OK |
| Descargas | Descarga del Excel Odoo con nombre facturas_odoo_coral_[fecha].xlsx | OK |
| Descargas | Descarga del Excel de control con nombre pedidos_coral_[fecha].xlsx | OK |
| Excel Odoo | Columnas exactas del importador probado | OK |
| Excel Odoo | 28 facturas independientes (filas con cliente) | OK |
| Excel Odoo | Sin líneas huérfanas antes de la primera factura | OK |
| Excel Odoo | Display Type = product en productos y line_note en notas (nunca vacío) | OK |
| Excel Odoo | Impuesto por Database ID = 5 en todas las líneas de producto | OK |
| Excel Odoo | Cuenta 410101 Venta de bienes | OK |
| Excel Odoo | Diario Ventas 001-001, cliente Gerardo Ortiz e Hijos Cia. Ltda. | OK |
| Excel Odoo | Fecha 2026-11-01 y vencimiento 2027-02-01 | OK |
| Excel Odoo | Sin nombre textual de impuesto ni identificadores externos | OK |
| Excel Odoo | Productos, cantidades, precios, notas y referencias = facturas reales emitidas (28) | OK |
| Excel Odoo | Sin pedidos duplicados ni fusionados | OK |
| Excel control | Exactamente 8 columnas en el orden pedido | OK |
| Excel control | 28 filas (una por orden) | OK |
| Excel control | Tabla de Excel llamada PedidosCoral | OK |
| Excel control | Encabezado azul oscuro, texto blanco y negrita; primera fila congelada | OK |
| Excel control | Tallas (columna Cantidad, no X10/X5), valor, tienda y fórmula H por fila = facturas reales | OK |
| Excel control | Fórmulas recalculadas por LibreOffice sin #NAME?/#REF!/#VALUE! y con el texto esperado | OK |
| Carga | 28 PDF individuales arrastrados de una vez | OK |
| Proceso 1 | PDF individuales producen exactamente el mismo Excel Odoo que el PDF consolidado | OK |
| Carga | Agregar archivos por partes (10 primero, el resto después) | OK |
| Navegación | Al cambiar de pestaña se conservan los archivos cargados | OK |
| Navegación | Los archivos del proceso 1 siguen cargados al volver | OK |
| Proceso 2 | Contadores: 28 pedidos, 28 facturas, 28 prevalidaciones detectadas | OK |
| Proceso 2 | No se genera el PDF sin mostrar antes el matching | OK |
| Matching | 28 coincidencias, 0 errores, 0 faltantes, 56 hojas A4 (órdenes, facturas y prevalidaciones desordenadas) | OK |
| Matching | Todos los registros en estado "Correcto" (sin ambiguos) | OK |
| Matching | Se puede expandir un registro y revisar los tres documentos | OK |
| Descargas | Descarga del PDF con nombre expedientes_coral_[dia]_[mes]_A4.pdf | OK |
| PDF final | 56 hojas A4 horizontal (297×210 mm) con 2 páginas cada una: hoja 1 = factura | copia idéntica, hoja 2 = orden |
| PDF final | Orden predeterminado = orden de carga de las órdenes de compra | OK |
| PDF final | Cada página A4 reducida proporcionalmente a media hoja (factor 0.7070 en ancho y alto), sin deformar ni recortar | OK |
| PDF final | Páginas vectoriales (no imágenes): tamaño razonable | OK |
| PDF final | Línea de corte punteada al centro de la hoja (activada por defecto) | OK |
| PDF final | QR de la prevalidación legible (200 dpi) e idéntico al original | OK |
| PDF final | Código de barras de la factura legible (300 dpi) = clave de acceso | OK |
| PDF final | Opción "orden por número de factura" sin alterar el matching | OK |
| PDF final | Opción para quitar la línea de corte | OK |
| PDF final | Al cambiar el formato se pide generar de nuevo | OK |
| PDF final | Formato opcional A5 vertical: 112 páginas (expedientes_coral_[dia]_[mes]_A5.pdf) | OK |
| Faltantes | Identifica el SAP sin prevalidación (pedido cuya página se retiró) con estado "Falta prevalidación" | OK |
| Faltantes | Bloquea la generación de un PDF incompleto | OK |
| Faltantes | Botón "Reemplazar" sustituye el archivo incompleto por el corregido | OK |
| Faltantes | Facturas cargadas dos veces → estado "Duplicado" y generación bloqueada | OK |
| Faltantes | Tras quitar el archivo duplicado el matching vuelve a ser válido | OK |
| Botones | Reiniciar limpia las tres áreas del proceso 2 | OK |
| Botones | Ayuda y Diagnóstico abren y cierran | OK |
| Privacidad | Ninguna solicitud a otros dominios durante todas las pruebas | OK |
| Privacidad | El servidor solo recibió GET de archivos de la app (ningún envío de documentos) | OK |
| Privacidad | Sin documentos en localStorage, sessionStorage, IndexedDB ni cookies (solo el tema) | OK |
| Privacidad | Política CSP activa sin violaciones (connect-src self) | OK |
| Estabilidad | Sin errores de JavaScript en la consola | OK |

## Documentos sintéticos (reproducibles por cualquiera)

Generados con `node tests/make-synthetic.mjs tests/fixtures` y ejecutados con `node tests/e2e.mjs --data tests/fixtures`.

| Grupo | Comprobación | Resultado | Detalle |
|---|---|---|---|
| Arranque | La app inicia en un servidor HTTP estático con subruta /megaflow/ | OK | http://127.0.0.1:36825/megaflow/ |
| Arranque | Sin librerías externas al cargar (PDF.js, pdf-lib y ExcelJS se cargan bajo demanda desde vendor/) | OK |  |
| Tema | Cambia a oscuro (fondo #11151D, tarjetas #1B2230, texto claro) | OK | {"theme":"dark","bg":"rgb(17, 21, 29)","card":"rgb(27, 34, 48)","text":"rgb(248, 250, 252)","logoDark":"block","logoLight":"none","aria":"true","stored":"dark"} |
| Tema | Logo con texto blanco en oscuro y logo original en claro | OK |  |
| Tema | Vuelve a claro (fondo #F6F8FC) | OK | inicial: light |
| Tema | La preferencia de tema persiste al recargar (única preferencia guardada) | OK |  |
| Carga | Botón "Seleccionar PDF" abre el explorador y el archivo aparece en pantalla | OK | 11 KB · 6 pág. · 6 reconocidas Listo |
| Carga | Lectura real: 6 pedidos detectados tras seleccionar | OK | 6 pedidos detectados |
| Carga | Se muestran nombre, tamaño y páginas detectadas | OK | 11 KB · 6 pág. · 6 reconocidas Listo |
| Carga | Evita agregar el mismo archivo dos veces | OK | "ordenes.pdf" ya estaba cargado en Órdenes (Preparar facturas); no se agregó de nuevo. |
| Carga | Eliminar un archivo individualmente | OK |  |
| Carga | Agregar nuevamente el mismo archivo después de eliminarlo | OK |  |
| Carga | Accesible con teclado: Enter sobre el área abre el explorador | OK |  |
| Carga | Detecta el mismo contenido con otro nombre (huella SHA-256) | OK | ordenes.pdf |
| Carga | Arrastrar: resalta el área y muestra "Suelta tus archivos aquí" | OK | {"cls":true,"visible":true,"text":"Suelta tus archivos aquí","border":"oklab(0.593463 -0.0282294 -0.163442)"} |
| Carga | Arrastrar: el evento drop se gestiona (preventDefault) y se quita el resaltado | OK |  |
| Errores | Archivo que no es PDF → error comprensible | OK | No es un archivo PDF. Solo se aceptan documentos .pdf. |
| Errores | Archivo vacío → error | OK | El archivo está vacío (0 bytes). |
| Errores | PDF dañado → error | OK | El archivo no es un PDF válido o está dañado. |
| Errores | PDF escaneado → aviso "parece escaneado" | OK | 1 página(s) parecen escaneadas y no contienen texto seleccionable. |
| Errores | PDF con contraseña → error | OK | El PDF está protegido con contraseña. Guarda una copia sin contraseña y vuelve a cargarla. |
| Errores | Con archivos inválidos el análisis se bloquea y explica el motivo | OK |  |
| Carga | El botón no queda en "Procesando" tras un error | OK |  |
| Carga | Quedan solo los archivos válidos tras eliminar los inválidos | OK |  |
| Errores | Factura colocada en el área de órdenes → aviso "parecen factura" | OK | 1 página(s) parecen factura, no órdenes de compra. |
| Fechas | Tres meses calendario: 01/11/2026 → 01/02/2027 | OK | 2027-02-01 |
| Fechas | 90 días exactos: 01/11/2026 → 30/01/2027 | OK | 2027-01-30 |
| Fechas | La fecha manual no se sobrescribe al cambiar la fecha de factura | OK | 2027-02-15 |
| Proceso 1 | Resumen: 6 órdenes | OK |  |
| Proceso 1 | 6 facturas a generar | OK |  |
| Proceso 1 | Tabla con 6 filas (una por orden, sin agrupar tiendas) | OK | 6 |
| Proceso 1 | Validaciones superadas (sin diferencias) | OK |  |
| Proceso 1 | Progreso termina en "Finalizado" solo con archivos generados | OK | 7/7 · Finalizado100 % Archivos listos: facturas_odoo_coral_2026_10_30.xlsx y pedidos_coral_2026_10_30.xlsx |
| Proceso 1 | Lista de comprobaciones: todas correctas | OK | 18/18 |
| Descargas | Botón "Descargar ambos" descarga los dos Excel | OK | facturas_odoo_coral_2026_10_30.xlsx, pedidos_coral_2026_10_30.xlsx |
| Descargas | Descarga del Excel Odoo con nombre facturas_odoo_coral_[fecha].xlsx | OK | facturas_odoo_coral_2026_10_30.xlsx |
| Descargas | Descarga del Excel de control con nombre pedidos_coral_[fecha].xlsx | OK | pedidos_coral_2026_10_30.xlsx |
| Excel Odoo | Columnas exactas del importador probado | OK | Partner / Invoice Bill Date / Due Date / Payment Terms / Journal* / Invoice Lines/Product / Invoice Lines/Account* / Invoice Lines/Quantity / Invoice Lines/Unit Price / Invoice Lines/Taxes/Database ID / Reference / Invoi |
| Excel Odoo | 6 facturas independientes (filas con cliente) | OK | 6 |
| Excel Odoo | Sin líneas huérfanas antes de la primera factura | OK |  |
| Excel Odoo | Display Type = product en productos y line_note en notas (nunca vacío) | OK |  |
| Excel Odoo | Impuesto por Database ID = 5 en todas las líneas de producto | OK |  |
| Excel Odoo | Cuenta 410101 Venta de bienes | OK |  |
| Excel Odoo | Diario Ventas 001-001, cliente Gerardo Ortiz e Hijos Cia. Ltda. | OK |  |
| Excel Odoo | Fecha 2026-11-01 y vencimiento 2027-02-01 | OK |  |
| Excel Odoo | Sin nombre textual de impuesto ni identificadores externos | OK |  |
| Excel Odoo | Productos, cantidades, precios, notas y referencias = facturas reales emitidas (6) | OK |  |
| Excel Odoo | Sin pedidos duplicados ni fusionados | OK |  |
| Excel control | Exactamente 8 columnas en el orden pedido | OK | Nombre tienda / Número de orden / Pedido compra / Talla M / Talla L / Talla XL / Valor orden (USD) / Detalle pedido |
| Excel control | 6 filas (una por orden) | OK | 6 |
| Excel control | Tabla de Excel llamada PedidosCoral | OK | PedidosCoral |
| Excel control | Encabezado azul oscuro, texto blanco y negrita; primera fila congelada | OK |  |
| Excel control | Tallas (columna Cantidad, no X10/X5), valor, tienda y fórmula H por fila = facturas reales | OK |  |
| Excel control | Fórmulas recalculadas por LibreOffice sin #NAME?/#REF!/#VALUE! y con el texto esperado | OK | H2 = "TIENDA CORAL NORTE PRUEBA / GUAYAQUIL\nSAP: NT100001\nOC: 5609000001" |
| Carga | 6 PDF individuales arrastrados de una vez | OK | 6 pedidos detectados |
| Proceso 1 | PDF individuales producen exactamente el mismo Excel Odoo que el PDF consolidado | OK |  |
| Carga | Agregar archivos por partes (10 primero, el resto después) | OK | 6 pedidos detectados |
| Navegación | Al cambiar de pestaña se conservan los archivos cargados | OK |  |
| Navegación | Los archivos del proceso 1 siguen cargados al volver | OK |  |
| Proceso 2 | Contadores: 6 pedidos, 6 facturas, 6 prevalidaciones detectadas | OK | 6 pedidos detectados / 6 facturas detectadas / 6 prevalidaciones detectadas |
| Proceso 2 | No se genera el PDF sin mostrar antes el matching | OK |  |
| Matching | 6 coincidencias, 0 errores, 0 faltantes, 12 hojas A4 (órdenes, facturas y prevalidaciones desordenadas) | OK | {"pedidos":"6","facturas":"6","preval":"6","coinc":"6","errores":"0","faltantes":"0","paginas":"12"} |
| Matching | Todos los registros en estado "Correcto" (sin ambiguos) | OK |  |
| Matching | Se puede expandir un registro y revisar los tres documentos | OK |  |
| Descargas | Descarga del PDF con nombre expedientes_coral_[dia]_[mes]_A4.pdf | OK | expedientes_coral_30_octubre_A4.pdf |
| PDF final | 12 hojas A4 horizontal (297×210 mm) con 2 páginas cada una: hoja 1 = factura | copia idéntica, hoja 2 = orden | prevalidación, en los 6 pedidos |
| PDF final | Orden predeterminado = orden de carga de las órdenes de compra | OK |  |
| PDF final | Cada página A4 reducida proporcionalmente a media hoja (factor 0.7070 en ancho y alto), sin deformar ni recortar | OK | [{"role":"factura (izquierda)","pares":61,"escalaX":0.707,"escalaY":0.707,"desvioMax":0},{"role":"copia (derecha)","pares":61,"escalaX":0.707,"escalaY":0.707,"desvioMax":0}] |
| PDF final | Páginas vectoriales (no imágenes): tamaño razonable | OK | 98 KB |
| PDF final | Línea de corte punteada al centro de la hoja (activada por defecto) | OK | cobertura vertical 0.572 |
| PDF final | QR de la prevalidación legible (200 dpi) | No ejecutada | el documento fuente no tiene QR legible |
| PDF final | Código de barras de la factura legible (300 dpi) | No ejecutada | el documento fuente no tiene un código de barras legible |
| PDF final | Opción "orden por número de factura" sin alterar el matching | OK |  |
| PDF final | Opción para quitar la línea de corte | OK | cobertura sin línea 0 (con línea 0.572) |
| PDF final | Al cambiar el formato se pide generar de nuevo | OK |  |
| PDF final | Formato opcional A5 vertical: 24 páginas (expedientes_coral_[dia]_[mes]_A5.pdf) | OK | expedientes_coral_30_octubre_A5.pdf |
| Faltantes | Identifica el SAP sin prevalidación (NT100002) con estado "Falta prevalidación" | OK | [["","","NT100002","5609000002","—","TIENDA CORAL NORTE PRUEBA / GUAYAQUIL","—","Falta prevalidación"]] |
| Faltantes | Bloquea la generación de un PDF incompleto | OK |  |
| Faltantes | Botón "Reemplazar" sustituye el archivo incompleto por el corregido | OK | prevalidaciones.pdf |
| Faltantes | Facturas cargadas dos veces → estado "Duplicado" y generación bloqueada | OK | 6 duplicados |
| Faltantes | Tras quitar el archivo duplicado el matching vuelve a ser válido | OK |  |
| Botones | Reiniciar limpia las tres áreas del proceso 2 | OK |  |
| Botones | Ayuda y Diagnóstico abren y cierran | OK |  |
| Privacidad | Ninguna solicitud a otros dominios durante todas las pruebas | OK |  |
| Privacidad | El servidor solo recibió GET de archivos de la app (ningún envío de documentos) | OK | 226 solicitudes GET |
| Privacidad | Sin documentos en localStorage, sessionStorage, IndexedDB ni cookies (solo el tema) | OK | {"local":["megaflow-theme"],"session":[],"cookies":"","idb":[]} |
| Privacidad | Política CSP activa sin violaciones (connect-src self) | OK |  |
| Estabilidad | Sin errores de JavaScript en la consola | OK |  |

## Pruebas unitarias

- ✔ ReadableStream se puede recorrer con for await (como lo usa PDF.js 6)
- ✔ Salir antes de tiempo cancela el stream y libera el lector
- ✔ Los errores del stream se propagan
- ✔ Promise.withResolvers
- ✔ Odoo: una factura por orden, misma tienda no se agrupa, nota final line_note
- ✔ Odoo: la validación detecta display_type vacío, líneas huérfanas y notas con precio
- ✔ Odoo: XLSX con columnas exactas, celdas vacías reales y 2 facturas
- ✔ Control: 8 columnas, tabla PedidosCoral, fórmula CONCAT en H por fila
- ✔ Proceso 1 completo: bloquea con duplicados y con fecha inválida
- ✔ Tres documentos relacionados por identificadores: todo correcto
- ✔ El resultado no depende del orden de las páginas
- ✔ Falta prevalidación
- ✔ Falta factura
- ✔ Falta orden (prevalidación y factura de un SAP no cargado)
- ✔ Total diferente entre factura y prevalidación
- ✔ Duplicado: la misma factura dos veces
- ✔ Ambiguo: dos prevalidaciones del mismo pedido con facturas distintas
- ✔ Datos inconsistentes: OC de la factura distinta a la orden
- ✔ Nunca empareja por importes iguales: factura con el mismo total pero otro número
- ✔ Ordenamientos opcionales no alteran los pares
- ✔ Diferencias de productos o clave de acceso son observaciones: no bloquean el expediente
- ✔ Orden parcial (sin tabla legible): se relaciona por SAP/OC y se omite la comparación de subtotal
- ✔ Notas de catálogo de la orden no bloquean el proceso 2
- ✔ Parser de órdenes: SAP, OC, tienda, tallas y totales (cantidad solo de la columna Cantidad)
- ✔ Parser de facturas y prevalidaciones: número, SAP, OC, REFERENCIA y totales
- ✔ Orden sin tabla legible: se conservan SAP, OC y tienda para armar el expediente
- ✔ Clasificación: documento en el área equivocada y página sin texto
- ✔ Robustez: el mismo resultado si PDF.js une o divide los fragmentos de texto
- ✔ PDF final (predeterminado): A4 horizontal, 2 páginas por hoja — hoja 1 factura | copia, hoja 2 orden | prevalidación
- ✔ PDF final (opción A5): 4 páginas A5 por pedido
- ✔ PDF final: páginas de origen rotadas se colocan derechas y sin recorte
- ✔ parseNumber: formatos Coral (punto) y factura (coma)
- ✔ IVA 15 % con redondeo comercial en centavos
- ✔ EAN-13 del catálogo válidos; dígito alterado inválido
- ✔ normId: solo normaliza para comparar, conserva ceros
- ✔ Clave de acceso SRI: estructura y dígito verificador módulo 11
- ✔ Vencimiento: tres meses calendario, 90 días exactos y manual
- ✔ Orden correcta no tiene errores
- ✔ Producto desconocido detiene el proceso
- ✔ Precio distinto al catálogo: error, nunca se corrige
- ✔ Cantidad no entera, total de línea y total de orden incoherentes
- ✔ Talla de la descripción distinta a la del EAN
- ✔ SAP y OC con formato inválido
- ✔ Tallas por orden: cantidades exactas y 0 si no aparece (X10/X5 no influyen)
- ✔ Parámetros de Odoo: fechas y campos obligatorios
- ✔ Ciudad recortada: se completa solo con confirmación inequívoca de la dirección

## Lo que NO se pudo probar aquí (declarado explícitamente)

- **Impresión física y corte**: el PDF se verificó digitalmente (tamaños, posiciones, contenido); no se imprimió.
- **Safari real**: se usó la emulación de Safari (reproduce el error de la v3.1 y confirma la corrección).
- **Publicación real en GitHub Pages**, **Odoo** y **Microsoft Excel**: igual que en versiones anteriores.
