# Pruebas automáticas de MegaFlow

La aplicación **no** necesita Node.js. Node.js solo se usa para ejecutar estas pruebas en un computador de desarrollo.

## Preparación (una vez)

```bash
npm install                 # instala pdfjs-dist, pdf-lib y exceljs (mismas versiones que vendor/)
npm install -D playwright   # navegador automatizado para las pruebas E2E
npx playwright install chromium
```

Opcional, para comprobaciones adicionales: Python 3 con `openpyxl` (verificación de fórmulas), LibreOffice (`soffice`, recálculo independiente de fórmulas), `pdftoppm` (poppler) y `zxing-cpp` (lectura de QR y código de barras), `qpdf` (PDF con contraseña). Si faltan, esas comprobaciones se marcan como **no ejecutadas**, nunca como correctas.

## 1. Pruebas unitarias (sin navegador)

```bash
npm test
```

Cubren `text-utils`, `dates`, `validations`, `matching-engine`, `odoo-export`, `coral-excel-export`, los tres parsers (con documentos sintéticos generados al vuelo, incluida la robustez cuando PDF.js une o parte los fragmentos de texto) y `pdf-builder` (A5, copia idéntica, verificación posterior, páginas rotadas).

## 2. Pruebas de punta a punta en navegador real

Se levanta un servidor HTTP estático que publica la app en `/megaflow/` (como GitHub Pages) y Chromium la usa como una persona: botones, explorador de archivos, arrastrar y soltar, descargas.

**Con documentos sintéticos (datos ficticios):**

```bash
node tests/make-synthetic.mjs tests/fixtures      # crea ordenes.pdf, facturas.pdf, prevalidaciones.pdf
node tests/e2e.mjs --data tests/fixtures --report resultados-sinteticos.md
```

**Con documentos reales (desde una carpeta local que NUNCA se sube al repositorio):**

```bash
node tests/e2e.mjs --data /ruta/local/lote_30_octubre --expect 28 --report resultados-reales.md
# la carpeta debe contener: ordenes.pdf, facturas.pdf, prevalidaciones.pdf
```

La prueba prepara automáticamente variantes: PDF individuales (uno por página), facturas y prevalidaciones desordenadas, prevalidaciones con una página quitada y archivos inválidos (no PDF, vacío, dañado, escaneado, con contraseña).

Como **verdad independiente** para el Excel de Odoo y el de control se usan las **facturas reales emitidas** (productos, cantidades, precios, nota con tienda/SAP/OC y subtotal deben coincidir).

## 3. Rendimiento

```bash
node tests/perf.mjs 100     # 100 pedidos sintéticos → 2 Excel + PDF de 400 páginas
```

## 4. Servidor local para probar a mano

```bash
node tests/static-server.mjs 8080 /megaflow/
# abrir http://127.0.0.1:8080/megaflow/
```

No abras `index.html` con doble clic (file://): los navegadores bloquean los módulos JavaScript en ese modo.
