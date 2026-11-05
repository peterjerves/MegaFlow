# MegaFlow — Mega Suministros SAS

Aplicación web interna para automatizar los documentos de los pedidos **Coral** (Gerardo Ortiz e Hijos Cía. Ltda.).
Funciona por completo **dentro del navegador**: no tiene servidor, no tiene base de datos y **ningún documento sale del computador**.

---

## 1. Qué hace MegaFlow

| Proceso | Entrada | Salida |
|---|---|---|
| **1. Preparar facturas** | PDF de órdenes de compra Coral (uno con muchas páginas, varios individuales o una mezcla) | **Excel de importación para Odoo 19.3** (una factura en borrador por orden, con nota final de tienda/SAP/OC) y **Excel de control PedidosCoral** (una fila por orden, con fórmula) |
| **2. Armar expedientes** | Órdenes Coral + facturas emitidas + prevalidaciones Coral (en cualquier orden y cantidad de archivos) | **Un PDF A5** con 4 páginas por pedido: factura original, copia idéntica de la factura, orden de compra y prevalidación |

Los dos procesos son independientes: no hace falta ejecutar el 1 para usar el 2.

### Novedades de la versión 3.2

- **Corregido el error en Safari** *“Error inesperado al leer el PDF: undefined is not a function (near '...t of e...')”*. PDF.js 6 recorre los datos con una función que Safari no tiene (`for await` sobre `ReadableStream`). MegaFlow ahora lee el texto con un método compatible y agrega esa función cuando falta (`js/compat.js`), en la página y en el lector de PDF. También agrega `Promise.withResolvers` para Safari anteriores a la 17.4.
- Comprueba la versión en el pie de página: debe decir **v3.2.0**.

### Novedades de la versión 3.1

- **Expedientes = imprimir A4 en A5.** Por cada pedido: 1) factura, 2) copia de la factura, 3) orden de compra, 4) prevalidación. Cada página A4 se reduce a A5 exactamente como al imprimir con *Ajustar a la página* (misma proporción, ocupa la hoja completa), sin convertirla en imagen.
- **Menos bloqueos en el proceso 2.** Solo detienen la generación los problemas de emparejamiento (falta un documento, duplicados, ambigüedad, SAP/OC distintos o totales distintos). Las diferencias de productos, la clave de acceso, el catálogo o una orden cuya tabla no se pudo leer se muestran como **observaciones** y no impiden armar el PDF. La revisión automática del PDF generado ya no bloquea la descarga: solo informa.
- **Menos de 100 archivos**: se puede subir todo a GitHub por la web en un solo paso.

**Cómo se relacionan los documentos (proceso 2).** Nunca por posición de página ni por importes iguales.
La **prevalidación** es el documento puente: su campo `PEDIDO` es el SAP de la orden y su campo `REFERENCIA` es el número de factura.
Después se comprueba que la factura indique el mismo SAP y OC, que el subtotal coincida con la orden, que el IVA 15 % sea correcto y que el total de la factura sea igual al de la prevalidación (también se comparan productos, cantidades y la clave de acceso SRI). Si algo no cuadra, el PDF **no se genera** y se explica qué pedido lo provoca.

---

## 2. Instalación en GitHub Pages (sin programar)

1. Entra a <https://github.com> e inicia sesión.
2. Pulsa **New repository** (botón verde). Nombre sugerido: `megaflow`. Pulsa **Create repository**.
3. En el repositorio nuevo, pulsa **uploading an existing file** (o **Add file → Upload files**).
4. Descomprime el ZIP en tu computador. Abre la carpeta `megaflow` y **arrastra todo su contenido** (son 78 archivos; la web de GitHub admite hasta 100 por subida) (las carpetas `assets`, `css`, `js`, `vendor`, `tests` y los archivos `index.html`, `README.md`, etc.) a la página de GitHub. Espera a que termine de subir y pulsa **Commit changes**.
   - Es importante que `index.html` quede en la **raíz** del repositorio (no dentro de otra carpeta).
   - La carpeta `vendor` es obligatoria: contiene las librerías que leen PDF y crean Excel.
5. Ve a **Settings → Pages**. En **Build and deployment** elige **Deploy from a branch**, rama **main**, carpeta **/ (root)** y pulsa **Save**.
6. Espera 1–2 minutos y abre la dirección que muestra GitHub, por ejemplo `https://TU_USUARIO.github.io/megaflow/`.

> **Archivo `.nojekyll`:** se incluye para que GitHub publique los archivos tal cual. Si tu sistema oculta los archivos que empiezan con punto y no se subió, no pasa nada: la aplicación funciona igual. Si quieres crearlo, usa **Add file → Create new file**, nombre `.nojekyll`, contenido vacío.

> **Visibilidad:** con un plan gratuito, GitHub Pages requiere que el repositorio sea público. Se publica **solo el código**, nunca tus documentos (que jamás se suben). Si quieres que el código no sea visible, usa un plan de GitHub que permita Pages privados.

**Actualizar la aplicación:** sube los archivos nuevos encima de los anteriores (mismo nombre), espera 2–3 minutos a que GitHub publique y recarga sin caché: **Ctrl + Shift + R** en Chrome/Edge (Windows), **Cmd + Shift + R** en Chrome (Mac) o **Cmd + Option + R** en Safari. GitHub Pages puede servir la versión anterior hasta 10 minutos; el pie de página muestra la versión cargada.

**Nunca subas órdenes, facturas ni prevalidaciones al repositorio.** El archivo `.gitignore` bloquea `*.pdf` y `*.xlsx` para quien use Git, pero la subida por la web no lo respeta: simplemente no los arrastres.

---

## 3. Uso

### 3.1 Preparar facturas (proceso 1)

1. Abre la pestaña **Preparar facturas**.
2. Arrastra el PDF de órdenes al área *“Arrastra aquí tus órdenes Coral”* o pulsa **Seleccionar PDF**.
   - Puedes cargar un PDF con todas las órdenes, varios PDF individuales, o agregar unos ahora y otros después. El resultado es el mismo.
   - Cada archivo muestra nombre, tamaño, páginas y cuántas órdenes se reconocieron. El contador superior indica *“28 pedidos detectados”*.
   - Botones por archivo: **Reemplazar** (⇄), **Eliminar** (×). Arriba de la lista: **Eliminar todos**.
3. Revisa la configuración:
   - **Fecha de factura**.
   - **Condición de pago**: *Tres meses calendario* (01/11/2026 → 01/02/2027), *90 días calendario exactos* (01/11/2026 → 30/01/2027) o *Fecha de vencimiento manual* (la fecha que escribas no se recalcula ni se sobrescribe).
   - Cliente, diario, cuenta e IVA vienen de `js/config.js`. En **Parámetros técnicos de Odoo** está el **ID del impuesto (Database ID) = 5**.
4. Pulsa **Analizar pedidos**. Verás: órdenes, facturas a generar, productos, subtotal, IVA, total, la lista de 18 validaciones y una tabla por orden.
5. Si todo es correcto, pulsa **Descargar Excel Odoo**, **Descargar Excel de control** o **Descargar ambos** (Chrome puede preguntar una vez si permites descargar varios archivos).
   Si hay cualquier error, la descarga queda **bloqueada** y se indica qué pedido lo provoca.

**Importar en Odoo:** Contabilidad → Clientes → Facturas → ⚙ → **Importar registros** → carga `facturas_odoo_coral_AAAA_MM_DD.xlsx`.
Comprueba que la columna `Invoice Lines/Taxes/Database ID` esté asignada a **Líneas de factura / Impuestos / ID de la base de datos**, pulsa **Probar** y luego **Importar**.
Las facturas se crean en **borrador**: MegaFlow no confirma facturas, no envía nada al SRI, no asigna números electrónicos y no modifica facturas existentes (no usa identificadores externos).

**Formato del Excel Odoo (probado en tu instancia):** columnas `Partner, Invoice Bill Date, Due Date, Payment Terms, Journal*, Invoice Lines/Product, Invoice Lines/Account*, Invoice Lines/Quantity, Invoice Lines/Unit Price, Invoice Lines/Taxes/Database ID, Reference, Invoice Lines/Label, Invoice Lines/Display Type`.
La primera fila de cada factura lleva cliente, fechas, diario y referencia (`OC 5601928535 / SAP AL204391`); las siguientes filas son sus líneas. Las líneas de producto usan `product`; la última línea de cada factura es la nota (`line_note`) con tres renglones: tienda, `SAP: …`, `OC: …`.

**Excel de control (`pedidos_coral_AAAA_MM_DD.xlsx`):** tabla de Excel **PedidosCoral** con las 8 columnas pedidas, una fila por orden (dos órdenes de la misma tienda = dos filas). La columna **Detalle pedido** es la fórmula `=CONCAT(A2,CHAR(10),"SAP: ",B2,CHAR(10),"OC: ",C2)` con ajuste de texto. Excel recalcula las fórmulas al abrir el archivo.

**Nombre de tienda:** se toma de la cabecera de la orden quitando solo el código numérico (`1414 - TIENDA CORAL LA MAGDALENA / QU` → `TIENDA CORAL LA MAGDALENA / QUITO`). La ciudad recortada se completa **solo** si la dirección del mismo documento la confirma sin ambigüedad; si no, se deja como está y se avisa.

### 3.2 Armar expedientes (proceso 2)

1. Abre la pestaña **Armar expedientes**.
2. Carga los documentos en sus tres áreas: **Órdenes de compra**, **Facturas** y **Prevalidaciones**. Cada área acepta un PDF consolidado, PDF individuales o ambos, en cualquier orden. (Si ya cargaste órdenes en el proceso 1, aparece el botón *Usar las órdenes cargadas en “Preparar facturas”*.)
3. Pulsa **Analizar y relacionar documentos**. Verás pedidos, facturas, prevalidaciones, coincidencias, errores, faltantes y páginas finales, y una tabla con el estado de cada pedido:
   *Correcto · Falta factura · Falta prevalidación · Falta orden · Total diferente · Duplicado · Ambiguo · Datos inconsistentes*.
   Pulsa **›** en una fila para ver los tres documentos relacionados (archivo y página de cada uno) y las comprobaciones. *Ver archivo* te lleva al archivo para reemplazarlo o eliminarlo.
4. Si el emparejamiento está correcto, pulsa **Generar PDF final** y luego **Descargar PDF completo** (`expedientes_coral_30_octubre_A5.pdf`). MegaFlow comprueba que el PDF tenga 4 páginas A5 por pedido y revisa cada página; si algo no se pudo confirmar, lo muestra como observación, sin impedir la descarga.
   Las **observaciones** (ícono ⓘ en la tabla) son informativas: por ejemplo, productos de la factura distintos a los de la orden o un producto fuera del catálogo. No bloquean el expediente; revísalas si lo consideras necesario.
5. **Orden final:** por defecto, el de las órdenes cargadas; también por SAP o por número de factura. El emparejamiento no depende del orden elegido.

**Cómo se arma el PDF:** es lo mismo que imprimir cada página A4 en una hoja A5 con *Ajustar a la página*. Las páginas originales se copian tal cual (texto, códigos de barras y QR digitales, sin convertirlas en imagen) y solo se reducen de tamaño. La copia de la factura es exactamente la misma página que la original.

---

## 4. Personalización

### 4.1 Cambiar el logo
Reemplaza estos archivos manteniendo el **mismo nombre** (PNG con fondo transparente, proporción aproximada 3,6:1):

- `assets/logo-mega-light.png` — logo original (texto negro), se usa en **modo claro**.
- `assets/logo-mega-dark.png` — misma imagen con el texto en **blanco** y el carrito azul, se usa en **modo oscuro**.
- `assets/favicon.png` (64×64) y `assets/apple-touch-icon.png` (180×180) — ícono de la pestaña.

### 4.2 Cambiar colores
Edita las variables al inicio de `css/styles.css`: `:root` (modo claro) y `[data-theme="dark"]` (modo oscuro). Azul principal `--blue: #3478F6`, secundario `--blue-2: #4597FF`. El verde (`--ok`) se usa solo para validaciones exitosas.

### 4.3 Cambiar parámetros de Odoo, catálogo y reglas
Todo está en **`js/config.js`** (fuente única; ningún otro archivo repite estos valores):

- `customer.odooName` — cliente (Gerardo Ortiz e Hijos Cia. Ltda.).
- `odoo.journal` — diario (Ventas 001-001). `odoo.incomeAccount` — cuenta (410101 Venta de bienes).
- `odoo.taxDatabaseId` — **ID del impuesto IVA 15 % (411, B) = 5**. Si cambias de base de datos Odoo, actualízalo (también se puede cambiar en pantalla, en *Parámetros técnicos*).
- `products` — EAN, código Coral (Cod.GO), talla, **nombre exacto en Odoo** y precio de referencia. Si una orden trae un producto que no está aquí, MegaFlow se detiene y pide revisión. Los precios nunca se modifican para cuadrar: si difieren, se informa el error.
- `dueDate.defaultMode` — condición de pago predeterminada.
- `fileNames` — nombres de los archivos descargados.

Después de editar, sube el archivo y recarga con Ctrl/Cmd + Shift + R.

---

## 5. Resolver errores

| Mensaje | Qué hacer |
|---|---|
| *Este documento parece escaneado y no contiene texto seleccionable* | Usa el PDF digital original (esta versión no hace OCR). |
| *La página parece una factura, no una orden* (o similar) | El archivo está en el área equivocada: elimínalo y cárgalo en la correcta. |
| *El PDF está protegido con contraseña* | Guarda una copia sin contraseña y vuelve a cargarla. |
| *El archivo no es un PDF válido o está dañado* | Descarga de nuevo el documento original. |
| *Ya estaba cargado* / *mismo contenido que…* | El archivo ya está en la lista; no se agrega dos veces. |
| *Producto desconocido* / *precio diferente al catálogo* | Revisa la orden o actualiza `js/config.js` si el catálogo cambió. |
| *Falta prevalidación / Falta factura / Falta orden* | Agrega el documento faltante o reemplaza el archivo incompleto (botón ⇄) y vuelve a analizar. |
| *Duplicado* | El mismo documento está cargado dos veces (por ejemplo, el PDF consolidado y también el individual). Quita uno. |
| *Total diferente* | Los importes de factura, prevalidación u orden no coinciden: revisa los documentos. MegaFlow no corrige importes. |
| *MegaFlow no pudo iniciarse* (franja roja arriba) | Recarga con Ctrl/Cmd + Shift + R. Comprueba que subiste las carpetas `js`, `css` y `vendor` completas. No abras `index.html` con doble clic (file://): usa la dirección de GitHub Pages. |

Para soporte técnico, pulsa **Diagnóstico** (pie de página) → **Copiar diagnóstico**. El texto copiado no incluye el contenido de los documentos.

---

## 6. Privacidad: cómo confirmar que ningún PDF se envía a servidores

- Los archivos se leen con objetos `File`/`ArrayBuffer` en la memoria del navegador. No se guardan en `localStorage`, `sessionStorage`, IndexedDB ni cookies. La única preferencia guardada es el **tema claro/oscuro**. Al cerrar o recargar la página, todo desaparece (si hay archivos cargados, el navegador pide confirmación antes de salir).
- `index.html` declara una **política de seguridad (CSP)** con `connect-src 'self'`: el navegador **bloquea** cualquier conexión a otro dominio.
- Las librerías están **dentro del proyecto** (`vendor/`); no se usan CDN.
- **Compruébalo tú mismo:** abre la app, pulsa **F12** → pestaña **Red / Network**, procesa tus documentos y observa: solo aparecen solicitudes **GET** a archivos de la propia aplicación (`.js`, `.css`, `.png`, fuentes de `vendor/pdfjs/standard_fonts`), nunca un envío (POST) ni otro dominio.
- Las descargas se generan en el navegador y solo se guardan cuando pulsas **Descargar**.

---

## 7. Estructura del proyecto

```
index.html                Interfaz (dos pestañas, áreas de carga, diálogos)
css/styles.css            Estilos, colores y modo oscuro
js/config.js              ★ Configuración central (Odoo, catálogo, vencimientos, nombres de archivo)
js/boot.js                Tema inicial y aviso si la app no arranca
js/compat.js              Compatibilidad con Safari (streams y Promise.withResolvers)
js/pdf-worker.js          Worker de PDF.js con la compatibilidad aplicada
js/app.js                 Arranque y conexión de módulos
js/ui.js                  Avisos, progreso, diagnóstico, tema, pestañas, descargas
js/icons.js               Íconos Lucide incrustados
js/upload-ui.js           Arrastrar y soltar, selector de archivos, lista de archivos
js/file-manager.js        Archivos en memoria: validación, duplicados, lectura con PDF.js
js/lib-loader.js          Carga de librerías locales bajo demanda
js/pdf-reader.js          Extracción de texto con coordenadas y reconstrucción de líneas
js/documents.js           Detección del tipo de documento por página
js/coral-parser.js        Parser de órdenes Coral (por posición: cabecera y tabla)
js/invoice-parser.js      Parser de facturas Mega Suministros
js/prevalidation-parser.js Parser de prevalidaciones Coral
js/validations.js         Reglas de negocio (catálogo, precios, IVA, fechas)
js/invoice-prep.js        Proceso 1: análisis y lista de validaciones
js/odoo-export.js         Excel de importación Odoo
js/coral-excel-export.js  Excel de control PedidosCoral
js/matching-engine.js     Motor de matching (prevalidación como puente)
js/dossier.js             Proceso 2: análisis
js/pdf-builder.js         PDF A5 final y verificación posterior
js/process-invoices.js    Interfaz del proceso 1
js/process-dossiers.js    Interfaz del proceso 2
js/dates.js               Fechas y vencimientos
js/text-utils.js          Números, dinero (centavos), EAN, clave de acceso SRI
vendor/                   PDF.js, pdf-lib, ExcelJS (con sus licencias)
assets/                   Logos y favicon
tests/                    Pruebas automáticas y generador de documentos sintéticos
```

---

## 8. Librerías y licencias

| Librería | Versión | Uso | Licencia |
|---|---|---|---|
| PDF.js (Mozilla) — compilación *legacy* | 6.4.299 | Leer el texto y las coordenadas de los PDF (en un Web Worker) | Apache 2.0 (`vendor/pdfjs/LICENSE`) |
| pdf-lib | 1.17.1 | Copiar, duplicar y escalar páginas a A5 | MIT (`vendor/pdf-lib/LICENSE.md`) |
| ExcelJS | 4.4.0 | Crear los archivos XLSX (tabla, fórmulas, formatos) | MIT (`vendor/exceljs/LICENSE`) |
| Lucide (subconjunto de íconos) | 1.68.0 | Íconos de la interfaz | ISC (`vendor/LUCIDE-LICENSE`) |

No se usan backend, bases de datos, OCR, APIs externas, Firebase ni Supabase.

---

## 9. Navegadores y pruebas

**Probado automáticamente:** Chromium 153 (motor de Chrome y Edge) mediante Playwright, sobre un servidor HTTP estático que publica la app en la subruta `/megaflow/`, igual que GitHub Pages. La suite completa se ejecuta también con **emulación de Safari**: se quitan del navegador las funciones que Safari no tiene (iteración de `ReadableStream`) y, en un segundo modo, también las que faltan en Safari 16.4 (`Promise.withResolvers`, `URL.parse`, `Iterator`, Base64 de `Uint8Array`, etc.). Esa emulación reproduce exactamente el error reportado en la v3.1 y confirma que la v3.2 lo resuelve.

**No probado en este entorno:** Safari real (WebKit no se pudo instalar aquí), Microsoft Edge y Firefox instalados. Se recomienda confirmar en tu Safari cargando las órdenes una vez.

**Pruebas automáticas incluidas** (ver `tests/README.md` y `RESULTADOS-PRUEBAS.md`):

- `npm test` — 45 pruebas unitarias: compatibilidad con Safari, números y dinero, IVA, EAN, clave SRI, vencimientos, ciudades recortadas, validaciones, motor de matching (faltantes, duplicados, ambiguos, totales, independencia del orden), Excel Odoo y de control, parsers con documentos sintéticos (incluida robustez ante texto partido o unido), PDF A5 y páginas rotadas.
- `node tests/e2e.mjs --data <carpeta> [--safari | --safari legacy]` — 84 comprobaciones (85 con emulación de Safari) en navegador real: selector de archivos, arrastrar y soltar, eliminar, reemplazar, duplicados, archivos inválidos, tema, proceso 1 completo con descargas, proceso 2 con documentos desordenados, faltantes, PDF final (orden de las 4 páginas y reducción A4 → A5 como al imprimir), lectura de QR y código de barras, privacidad (red, almacenamiento, CSP).
- `node tests/perf.mjs 100` — rendimiento con 100 pedidos (400 páginas).

Los documentos reales se usaron para las pruebas **localmente** y **no** se incluyen en el proyecto.
