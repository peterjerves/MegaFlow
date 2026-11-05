/**
 * Pruebas funcionales de punta a punta en un NAVEGADOR REAL (Chromium vía Playwright)
 * contra un servidor HTTP estático que publica la app en una SUBRUTA (/megaflow/),
 * igual que GitHub Pages. No se usa file://.
 *
 * Uso:
 *   node tests/e2e.mjs --data <carpeta>     (contiene ordenes.pdf, facturas.pdf, prevalidaciones.pdf)
 *   node tests/e2e.mjs --orders a.pdf --invoices b.pdf --prevals c.pdf
 *   Opciones: --expect 28  (cantidad de pedidos esperada)  --report RESULTADOS.md
 *             --safari          emula la falta de `for await` sobre ReadableStream (como Safari)
 *             --safari legacy   además quita APIs recientes que Safari antiguo no tiene
 *
 * Los documentos reales NO deben subirse al repositorio: pásalos desde una carpeta local.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { startServer } from './static-server.mjs';
import { prepareInputs } from './lib/prepare.mjs';
import { emulateSafari } from './lib/safari-emulation.mjs';
import { pagesFromFile, pagesFromBytes } from './lib/node-pdf.mjs';
import { parseInvoice, looksLikeInvoice } from '../js/invoice-parser.js';
import { parsePrevalidation, looksLikePrevalidation } from '../js/prevalidation-parser.js';
import { looksLikeCoralOrder } from '../js/coral-parser.js';
import { CONFIG, CATALOG } from '../js/config.js';
import { compact } from '../js/text-utils.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []));
const dataDir = args.data ? path.resolve(args.data) : null;
const pick = (flag, names) => (args[flag] ? path.resolve(args[flag]) : names.map((n) => dataDir && path.join(dataDir, n)).find((f) => f && fs.existsSync(f)));
const SRC = {
  orders: pick('orders', ['ordenes.pdf', 'orders.pdf']),
  invoices: pick('invoices', ['facturas.pdf', 'invoices.pdf']),
  prevals: pick('prevals', ['prevalidaciones.pdf', 'preval.pdf', 'prevals.pdf']),
};
for (const [k, v] of Object.entries(SRC)) if (!v || !fs.existsSync(v)) { console.error(`Falta el PDF de ${k}. Usa --data <carpeta> o --${k} archivo.pdf`); process.exit(2); }

const results = [];
const check = (group, name, ok, detail = '') => {
  results.push({ group, name, ok: ok === null ? null : !!ok, detail: String(detail) });
  console.log(`${ok === null ? '⏭ ' : ok ? '✅' : '❌'} [${group}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'megaflow-e2e-'));
const downloadsDir = path.join(work, 'descargas');
fs.mkdirSync(downloadsDir);
const inputs = await prepareInputs({ ...SRC, outDir: path.join(work, 'entradas') });
const N = Number(args.expect || inputs.counts.orders);

// Verdad independiente: las facturas reales (emitidas manualmente en Odoo) y prevalidaciones.
const truthInvoices = (await pagesFromFile(SRC.invoices)).map((p) => parseInvoice(p)).filter((r) => r.ok).map((r) => r.invoice);
const truthPrevals = (await pagesFromFile(SRC.prevals)).map((p) => parsePrevalidation(p)).filter((r) => r.ok).map((r) => r.prevalidation);
const invBySap = new Map(truthInvoices.map((i) => [i.sap, i]));
const preBySap = new Map(truthPrevals.map((p) => [p.sap, p]));

const srv = await startServer({ base: '/megaflow/' });
const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 900 }, locale: 'es-EC' });
const safariMode = args.safari ? (args.safari === 'legacy' ? 'legacy' : 'streams') : null;
if (safariMode) await emulateSafari(context, safariMode);
const page = await context.newPage();
const consoleErrors = [];
const cspViolations = [];
const netRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
context.on('request', (r) => netRequests.push({ url: r.url(), method: r.method() }));
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); });
});

// ---------------------------------------------------------------- utilidades
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function chooseWithButton(buttonSel, files) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.click(buttonSel)]);
  await chooser.setFiles(files);
}
async function dropFiles(zoneSel, files, { checkOverlay = false } = {}) {
  const payload = files.map((f) => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64'), type: f.endsWith('.pdf') ? 'application/pdf' : 'text/plain' }));
  return page.evaluate(async ({ zoneSel, payload, checkOverlay }) => {
    const dz = document.querySelector(zoneSel);
    const dt = new DataTransfer();
    for (const p of payload) {
      const bin = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bin], p.name, { type: p.type, lastModified: 1730000000000 }));
    }
    const fire = (type) => dz.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire('dragenter');
    fire('dragover');
    let overlay = null;
    if (checkOverlay) {
      await new Promise((r) => setTimeout(r, 50));
      const ov = dz.querySelector('.dz-over');
      overlay = { cls: dz.classList.contains('is-over'), visible: getComputedStyle(ov).display !== 'none', text: ov.textContent.trim(), border: getComputedStyle(dz).borderTopColor };
    }
    const notPrevented = fire('drop');
    return { overlay, defaultPrevented: !notPrevented, afterCls: dz.classList.contains('is-over') };
  }, { zoneSel, payload, checkOverlay });
}
async function waitZoneIdle(listSel, timeout = 120000) {
  await sleep(150); // la lista se repinta en el siguiente cuadro de animación
  await page.waitForFunction((sel) => {
    const l = document.querySelector(sel);
    const counter = document.querySelector(sel.replace('#files-', '#count-'));
    return l && l.children.length > 0 && !/Leyendo|En cola/.test(l.textContent) && !(counter && /leyendo/.test(counter.textContent));
  }, listSel, { timeout });
}
const zoneRows = (listSel) => page.$$eval(`${listSel} .file-row`, (rows) => rows.map((r) => ({ name: r.querySelector('.file-name').textContent, meta: r.querySelector('.file-meta').textContent.replace(/\s+/g, ' ').trim(), msg: [...r.querySelectorAll('.file-msg')].map((m) => m.textContent).join(' | '), error: r.classList.contains('is-error') })));
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
async function download(buttonSel) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(buttonSel)]);
  const f = path.join(downloadsDir, dl.suggestedFilename());
  await dl.saveAs(f);
  return f;
}
async function statValue(resultsSel, label) {
  return page.$$eval(`${resultsSel} .stat`, (stats, label) => {
    const s = stats.find((x) => x.querySelector('.stat-label').textContent.trim() === label);
    return s ? s.querySelector('.stat-value').textContent.trim() : null;
  }, label);
}

try {
  // ================================================================ ARRANQUE
  await page.goto(srv.url);
  await page.waitForFunction(() => window.__megaflowReady === true, null, { timeout: 10000 });
  check('Arranque', 'La app inicia en un servidor HTTP estático con subruta /megaflow/', true, srv.url);
  if (safariMode) check('Arranque', `Emulación de Safari activa (${safariMode === 'legacy' ? 'sin iteración de streams ni APIs recientes' : 'sin iteración de ReadableStream'})`, await page.evaluate(() => !!window.__safariEmulation));
  check('Arranque', 'Sin librerías externas al cargar (PDF.js, pdf-lib y ExcelJS se cargan bajo demanda desde vendor/)', !netRequests.some((r) => !r.url.startsWith(srv.url)));

  // ================================================================ PRUEBA 2: TEMA
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#theme-toggle');
  await sleep(450); // transición de color de 0,2 s
  const dark = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector('.card')).backgroundColor,
    text: getComputedStyle(document.body).color,
    logoDark: getComputedStyle(document.querySelector('.logo-dark')).display,
    logoLight: getComputedStyle(document.querySelector('.logo-light')).display,
    aria: document.querySelector('#theme-toggle').getAttribute('aria-checked'),
    stored: localStorage.getItem('megaflow-theme'),
  }));
  await page.screenshot({ path: path.join(work, 'tema-oscuro.png') });
  check('Tema', 'Cambia a oscuro (fondo #11151D, tarjetas #1B2230, texto claro)', dark.theme === 'dark' && dark.bg === 'rgb(17, 21, 29)' && dark.card === 'rgb(27, 34, 48)' && dark.text === 'rgb(248, 250, 252)', JSON.stringify(dark));
  check('Tema', 'Logo con texto blanco en oscuro y logo original en claro', dark.logoDark === 'block' && dark.logoLight === 'none');
  await page.click('#theme-toggle');
  await sleep(450);
  const light = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, logoLight: getComputedStyle(document.querySelector('.logo-light')).display }));
  check('Tema', 'Vuelve a claro (fondo #F6F8FC)', light.theme === 'light' && light.bg === 'rgb(246, 248, 252)' && light.logoLight === 'block', `inicial: ${themeBefore}`);
  await page.click('#theme-toggle'); // se dejan las pruebas siguientes en modo oscuro
  await page.reload();
  await page.waitForFunction(() => window.__megaflowReady === true);
  check('Tema', 'La preferencia de tema persiste al recargar (única preferencia guardada)', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');

  // ================================================================ PRUEBA 1: CARGA
  await chooseWithButton('#dz-p1-orders [data-pick]', [inputs.orders]);
  await waitZoneIdle('#files-p1-orders');
  let rows = await zoneRows('#files-p1-orders');
  let counter = await text('#count-p1-orders');
  check('Carga', 'Botón "Seleccionar PDF" abre el explorador y el archivo aparece en pantalla', rows.length === 1 && rows[0].name === 'ordenes.pdf', rows[0]?.meta);
  check('Carga', `Lectura real: ${N} pedidos detectados tras seleccionar`, counter.includes(`${N} pedidos detectados`), counter);
  check('Carga', 'Se muestran nombre, tamaño y páginas detectadas', /KB|MB/.test(rows[0].meta) && rows[0].meta.includes(`${N} pág.`), rows[0].meta);
  await chooseWithButton('#dz-p1-orders [data-pick]', [inputs.orders]);
  await sleep(300);
  rows = await zoneRows('#files-p1-orders');
  const dupToast = await page.$$eval('.toast', (t) => t.map((x) => x.textContent).join(' '));
  check('Carga', 'Evita agregar el mismo archivo dos veces', rows.length === 1 && /ya estaba cargado/.test(dupToast), dupToast.slice(0, 120));
  await page.click('#files-p1-orders button[data-action="remove"]');
  await sleep(200);
  rows = await zoneRows('#files-p1-orders');
  check('Carga', 'Eliminar un archivo individualmente', rows.length === 0);
  await chooseWithButton('#dz-p1-orders [data-pick]', [inputs.orders]);
  await waitZoneIdle('#files-p1-orders');
  check('Carga', 'Agregar nuevamente el mismo archivo después de eliminarlo', (await zoneRows('#files-p1-orders')).length === 1);
  const [kbChooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), page.focus('#dz-p1-orders').then(() => page.keyboard.press('Enter'))]);
  check('Carga', 'Accesible con teclado: Enter sobre el área abre el explorador', !!kbChooser);
  if (kbChooser) await kbChooser.setFiles([]);
  // Contenido idéntico con otro nombre
  const twin = path.join(work, 'copia_de_ordenes.pdf');
  fs.copyFileSync(inputs.orders, twin);
  await chooseWithButton('#dz-p1-orders [data-pick]', [twin]);
  await sleep(1500);
  rows = await zoneRows('#files-p1-orders');
  check('Carga', 'Detecta el mismo contenido con otro nombre (huella SHA-256)', rows.length === 1, rows.map((r) => r.name).join(', '));

  // Arrastrar y soltar (proceso 1): archivos inválidos
  const inv = inputs.invalid;
  const dropInvalid = await dropFiles('#dz-p1-orders', [inv.txt, inv.empty, inv.corrupt, inv.scanned].concat(inv.protected ? [inv.protected] : []), { checkOverlay: true });
  check('Carga', 'Arrastrar: resalta el área y muestra "Suelta tus archivos aquí"', dropInvalid.overlay.cls && dropInvalid.overlay.visible && dropInvalid.overlay.text === 'Suelta tus archivos aquí', JSON.stringify(dropInvalid.overlay));
  check('Carga', 'Arrastrar: el evento drop se gestiona (preventDefault) y se quita el resaltado', dropInvalid.defaultPrevented && !dropInvalid.afterCls);
  await waitZoneIdle('#files-p1-orders');
  await sleep(500);
  rows = await zoneRows('#files-p1-orders');
  const byName = (n) => rows.find((r) => r.name === n) || {};
  check('Errores', 'Archivo que no es PDF → error comprensible', byName('no_es_pdf.txt').error && /No es un archivo PDF/.test(byName('no_es_pdf.txt').msg), byName('no_es_pdf.txt').msg);
  check('Errores', 'Archivo vacío → error', byName('vacio.pdf').error && /vacío/.test(byName('vacio.pdf').msg), byName('vacio.pdf').msg);
  check('Errores', 'PDF dañado → error', byName('danado.pdf').error && /no es un PDF válido|dañado/.test(byName('danado.pdf').msg), byName('danado.pdf').msg);
  check('Errores', 'PDF escaneado → aviso "parece escaneado"', /escaneada|escaneado/.test(byName('escaneado.pdf').msg), byName('escaneado.pdf').msg);
  if (inv.protected) check('Errores', 'PDF con contraseña → error', byName('con_contrasena.pdf').error && /contraseña/.test(byName('con_contrasena.pdf').msg), byName('con_contrasena.pdf').msg);
  else check('Errores', 'PDF con contraseña → error', null, 'qpdf no disponible: no ejecutada');
  // Analizar con errores debe bloquear
  await page.click('#p1-run');
  await page.waitForSelector('#p1-results .notice-error', { timeout: 20000 });
  check('Errores', 'Con archivos inválidos el análisis se bloquea y explica el motivo', /archivo\(s\) con errores/.test(await text('#p1-results')));
  check('Carga', 'El botón no queda en "Procesando" tras un error', await page.$eval('#p1-run', (b) => !b.disabled && !b.hasAttribute('aria-busy')));
  for (const n of ['no_es_pdf.txt', 'vacio.pdf', 'danado.pdf', 'escaneado.pdf', 'con_contrasena.pdf']) {
    const btn = await page.$(`#files-p1-orders .file-row:has(.file-name:text-is("${n}")) button[data-action="remove"]`);
    if (btn) { await btn.click(); await sleep(80); }
  }
  rows = await zoneRows('#files-p1-orders');
  check('Carga', 'Quedan solo los archivos válidos tras eliminar los inválidos', rows.length === 1 && rows[0].name === 'ordenes.pdf');

  // Área equivocada: una factura en órdenes
  await dropFiles('#dz-p1-orders', [inputs.invoiceFiles[0]]);
  await waitZoneIdle('#files-p1-orders');
  rows = await zoneRows('#files-p1-orders');
  const wrong = rows.find((r) => r.name === path.basename(inputs.invoiceFiles[0]));
  check('Errores', 'Factura colocada en el área de órdenes → aviso "parecen factura"', wrong && /factura/.test(wrong.msg), wrong?.msg);
  await page.click(`#files-p1-orders .file-row:has(.file-name:text-is("${path.basename(inputs.invoiceFiles[0])}")) button[data-action="remove"]`);

  // ================================================================ PRUEBA 3 y 4: PROCESO 1
  await page.fill('#p1-invoice-date', '2026-11-01');
  await page.dispatchEvent('#p1-invoice-date', 'input');
  await page.dispatchEvent('#p1-invoice-date', 'change');
  const due3m = await page.inputValue('#p1-due-date');
  await page.selectOption('#p1-due-mode', 'days90');
  const due90 = await page.inputValue('#p1-due-date');
  await page.selectOption('#p1-due-mode', 'manual');
  await page.fill('#p1-due-date', '2027-02-15');
  await page.fill('#p1-invoice-date', '2026-11-02');
  await page.dispatchEvent('#p1-invoice-date', 'input');
  const manualKept = await page.inputValue('#p1-due-date');
  check('Fechas', 'Tres meses calendario: 01/11/2026 → 01/02/2027', due3m === '2027-02-01', due3m);
  check('Fechas', '90 días exactos: 01/11/2026 → 30/01/2027', due90 === '2027-01-30', due90);
  check('Fechas', 'La fecha manual no se sobrescribe al cambiar la fecha de factura', manualKept === '2027-02-15', manualKept);
  await page.fill('#p1-invoice-date', '2026-11-01');
  await page.dispatchEvent('#p1-invoice-date', 'input');
  await page.selectOption('#p1-due-mode', 'months3');

  await page.click('#p1-run');
  await page.waitForSelector('#p1-results [data-download="odoo"]', { timeout: 60000 });
  await page.screenshot({ path: path.join(work, 'proceso1-resultado.png'), fullPage: true });
  const p1Text = await text('#p1-results');
  const progressText = await text('#p1-progress');
  check('Proceso 1', `Resumen: ${N} órdenes`, (await statValue('#p1-results', 'Órdenes')) === String(N));
  check('Proceso 1', `${N} facturas a generar`, (await statValue('#p1-results', 'Facturas a generar')) === String(N));
  const tableRows = await page.$$eval('#p1-results table.data tbody tr', (r) => r.length);
  check('Proceso 1', `Tabla con ${N} filas (una por orden, sin agrupar tiendas)`, tableRows === N, `${tableRows}`);
  check('Proceso 1', 'Validaciones superadas (sin diferencias)', /Validación superada/.test(p1Text) && !/Diferencias y errores/.test(p1Text));
  check('Proceso 1', 'Progreso termina en "Finalizado" solo con archivos generados', /7\/7 · Finalizado/.test(progressText), progressText.slice(0, 120));
  const checksOk = await page.$$eval('#p1-results .checks li', (l) => ({ total: l.length, ok: l.filter((x) => x.classList.contains('ok')).length }));
  check('Proceso 1', 'Lista de comprobaciones: todas correctas', checksOk.total >= 17 && checksOk.ok === checksOk.total, `${checksOk.ok}/${checksOk.total}`);

  const both = [];
  const onDl = (d) => both.push(d.suggestedFilename());
  page.on('download', onDl);
  await page.click('#p1-results [data-download="both"]');
  await sleep(2000);
  page.off('download', onDl);
  check('Descargas', 'Botón "Descargar ambos" descarga los dos Excel', both.length === 2 && both.some((n) => n.startsWith('facturas_odoo')) && both.some((n) => n.startsWith('pedidos_coral')), both.join(', '));
  const odooFile = await download('#p1-results [data-download="odoo"]');
  const controlFile = await download('#p1-results [data-download="control"]');
  check('Descargas', 'Descarga del Excel Odoo con nombre facturas_odoo_coral_[fecha].xlsx', /^facturas_odoo_coral_\d{4}_\d{2}_\d{2}\.xlsx$/.test(path.basename(odooFile)), path.basename(odooFile));
  check('Descargas', 'Descarga del Excel de control con nombre pedidos_coral_[fecha].xlsx', /^pedidos_coral_\d{4}_\d{2}_\d{2}\.xlsx$/.test(path.basename(controlFile)), path.basename(controlFile));

  // --- Verificación del Excel Odoo
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(odooFile);
  const ws = wb.worksheets[0];
  const header = ws.getRow(1).values.slice(1);
  check('Excel Odoo', 'Columnas exactas del importador probado', header.join('|') === CONFIG.odoo.columns.join('|'), header.join(' | '));
  const col = Object.fromEntries(CONFIG.odoo.columns.map((c, i) => [c, i + 1]));
  const data = [];
  for (let r = 2; r <= ws.rowCount; r++) { const row = ws.getRow(r); data.push(Object.fromEntries(CONFIG.odoo.columns.map((c) => [c, row.getCell(col[c]).value ?? '']))); }
  const groups = [];
  for (const r of data) { if (r.Partner) groups.push({ head: r, lines: [r] }); else if (groups.length) groups.at(-1).lines.push(r); }
  check('Excel Odoo', `${N} facturas independientes (filas con cliente)`, groups.length === N, `${groups.length}`);
  check('Excel Odoo', 'Sin líneas huérfanas antes de la primera factura', !!data[0].Partner);
  const allDT = data.every((r) => r['Invoice Lines/Display Type'] === 'product' || r['Invoice Lines/Display Type'] === 'line_note');
  check('Excel Odoo', 'Display Type = product en productos y line_note en notas (nunca vacío)', allDT);
  const products = data.filter((r) => r['Invoice Lines/Display Type'] === 'product');
  check('Excel Odoo', 'Impuesto por Database ID = 5 en todas las líneas de producto', products.every((r) => r['Invoice Lines/Taxes/Database ID'] === 5));
  check('Excel Odoo', 'Cuenta 410101 Venta de bienes', products.every((r) => r['Invoice Lines/Account*'] === '410101 Venta de bienes'));
  check('Excel Odoo', 'Diario Ventas 001-001, cliente Gerardo Ortiz e Hijos Cia. Ltda.', groups.every((g) => g.head['Journal*'] === 'Ventas 001-001' && g.head.Partner === 'Gerardo Ortiz e Hijos Cia. Ltda.'));
  check('Excel Odoo', 'Fecha 2026-11-01 y vencimiento 2027-02-01', groups.every((g) => g.head['Invoice Bill Date'] === '2026-11-01' && g.head['Due Date'] === '2027-02-01'));
  check('Excel Odoo', 'Sin nombre textual de impuesto ni identificadores externos', !header.includes('id') && !data.some((r) => String(r['Invoice Lines/Taxes/Database ID']).includes('IVA')));
  // Comparación contra las facturas reales (fuente independiente)
  const mism = [];
  for (const g of groups) {
    const m = String(g.head.Reference).match(/^OC (\d+) \/ SAP ([A-Z]{2}\d+)$/);
    if (!m) { mism.push(`Referencia inválida: ${g.head.Reference}`); continue; }
    const [, oc, sap] = m;
    const truth = invBySap.get(sap);
    if (!truth) { mism.push(`${sap}: sin factura real para comparar`); continue; }
    if (truth.oc !== oc) mism.push(`${sap}: OC ${oc} ≠ factura real ${truth.oc}`);
    const prods = g.lines.filter((l) => l['Invoice Lines/Display Type'] === 'product').map((l) => `${l['Invoice Lines/Product']}|${l['Invoice Lines/Quantity']}|${Number(l['Invoice Lines/Unit Price']).toFixed(2)}`).sort().join(';');
    const exp = truth.lines.map((l) => `${CATALOG.byEan.get(l.ean)?.odooName}|${l.qty}|${(l.priceCents / 100).toFixed(2)}`).sort().join(';');
    if (prods !== exp) mism.push(`${sap}: líneas ${prods} ≠ factura real ${exp}`);
    const note = g.lines.at(-1);
    if (note['Invoice Lines/Display Type'] !== 'line_note') mism.push(`${sap}: la última línea no es la nota`);
    const expNote = `${truth.store}\nSAP: ${sap}\nOC: ${oc}`;
    if (note['Invoice Lines/Label'] !== expNote) mism.push(`${sap}: nota ${JSON.stringify(note['Invoice Lines/Label'])} ≠ factura real ${JSON.stringify(expNote)}`);
    if (note['Invoice Lines/Product'] || note['Invoice Lines/Quantity'] || note['Invoice Lines/Unit Price'] || note['Invoice Lines/Taxes/Database ID']) mism.push(`${sap}: la nota tiene producto/cantidad/precio/impuesto`);
    const base = g.lines.filter((l) => l['Invoice Lines/Display Type'] === 'product').reduce((s, l) => s + Math.round(l['Invoice Lines/Quantity'] * l['Invoice Lines/Unit Price'] * 100), 0);
    if (base !== truth.subtotalCents) mism.push(`${sap}: subtotal ${base} ≠ factura real ${truth.subtotalCents}`);
  }
  check('Excel Odoo', `Productos, cantidades, precios, notas y referencias = facturas reales emitidas (${truthInvoices.length})`, mism.length === 0 && truthInvoices.length === N, mism.slice(0, 4).join(' · '));
  const saps = groups.map((g) => g.head.Reference);
  check('Excel Odoo', 'Sin pedidos duplicados ni fusionados', new Set(saps).size === N);

  // --- Verificación del Excel de control
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(controlFile);
  const ws2 = wb2.getWorksheet('PedidosCoral');
  const h2 = ws2.getRow(1).values.slice(1);
  check('Excel control', 'Exactamente 8 columnas en el orden pedido', h2.join('|') === CONFIG.controlExcel.columns.join('|'), h2.join(' | '));
  check('Excel control', `${N} filas (una por orden)`, ws2.rowCount - 1 === N, `${ws2.rowCount - 1}`);
  const tables = ws2.getTables().map((t) => (t.table || t).name);
  check('Excel control', 'Tabla de Excel llamada PedidosCoral', tables.includes('PedidosCoral'), tables.join(','));
  const hdrCell = ws2.getCell('A1');
  check('Excel control', 'Encabezado azul oscuro, texto blanco y negrita; primera fila congelada', hdrCell.fill?.fgColor?.argb === CONFIG.controlExcel.headerColor && hdrCell.font?.bold && hdrCell.font?.color?.argb === 'FFFFFFFF' && ws2.views?.[0]?.ySplit === 1);
  const ctrlMism = [];
  for (let r = 2; r <= N + 1; r++) {
    const sap = ws2.getCell(r, 2).value; const oc = ws2.getCell(r, 3).value;
    const truth = invBySap.get(sap);
    const f = ws2.getCell(r, 8).value;
    if (!f || f.formula !== `_xlfn.CONCAT(A${r},CHAR(10),"SAP: ",B${r},CHAR(10),"OC: ",C${r})`) ctrlMism.push(`H${r} sin fórmula correcta`);
    if (!truth) { ctrlMism.push(`${sap}: sin factura real`); continue; }
    const sizes = { M: 0, L: 0, XL: 0 };
    for (const l of truth.lines) sizes[CATALOG.byEan.get(l.ean).size] += l.qty;
    const got = { M: ws2.getCell(r, 4).value, L: ws2.getCell(r, 5).value, XL: ws2.getCell(r, 6).value };
    if (JSON.stringify(got) !== JSON.stringify(sizes)) ctrlMism.push(`${sap}: tallas ${JSON.stringify(got)} ≠ ${JSON.stringify(sizes)}`);
    if (Math.round(ws2.getCell(r, 7).value * 100) !== truth.subtotalCents) ctrlMism.push(`${sap}: valor ${ws2.getCell(r, 7).value}`);
    if (ws2.getCell(r, 1).value !== truth.store) ctrlMism.push(`${sap}: tienda "${ws2.getCell(r, 1).value}" ≠ "${truth.store}"`);
    if (oc !== truth.oc) ctrlMism.push(`${sap}: OC`);
    if (ws2.getCell(r, 7).numFmt !== '"$"#,##0.00' || ws2.getCell(r, 4).numFmt !== '0' || !ws2.getCell(r, 8).alignment?.wrapText) ctrlMism.push(`fila ${r}: formato`);
  }
  check('Excel control', 'Tallas (columna Cantidad, no X10/X5), valor, tienda y fórmula H por fila = facturas reales', ctrlMism.length === 0, ctrlMism.slice(0, 4).join(' · '));
  // Recalculo independiente con LibreOffice
  const expectedJson = path.join(work, 'esperado_control.json');
  fs.writeFileSync(expectedJson, JSON.stringify({ header: CONFIG.controlExcel.columns, detail: [...Array(N).keys()].map((k) => { const r = k + 2; return `${ws2.getCell(r, 1).value}\nSAP: ${ws2.getCell(r, 2).value}\nOC: ${ws2.getCell(r, 3).value}`; }) }));
  try {
    const out = execFileSync('python3', [path.join(HERE, 'lib', 'recalc_check.py'), controlFile, expectedJson], { encoding: 'utf-8', timeout: 180000 });
    const res = JSON.parse(out.trim().split('\n').pop());
    if (res.ok === null) check('Excel control', 'Fórmulas recalculadas por LibreOffice sin #NAME?/#REF!/#VALUE!', null, res.skipped);
    else check('Excel control', 'Fórmulas recalculadas por LibreOffice sin #NAME?/#REF!/#VALUE! y con el texto esperado', res.ok, res.ok ? `H2 = ${JSON.stringify(res.sampleH2)}` : res.errors.join(' · '));
  } catch (err) { check('Excel control', 'Fórmulas recalculadas por LibreOffice', null, `no ejecutada: ${err.message.slice(0, 100)}`); }

  // --- Equivalencia: órdenes como PDF individuales arrastrados
  await page.click('#p1-reset');
  await dropFiles('#dz-p1-orders', inputs.orderFiles);
  await waitZoneIdle('#files-p1-orders', 180000);
  counter = await text('#count-p1-orders');
  check('Carga', `${inputs.orderFiles.length} PDF individuales arrastrados de una vez`, (await zoneRows('#files-p1-orders')).length === inputs.orderFiles.length && counter.includes(`${N} pedidos detectados`), counter);
  await page.click('#p1-run');
  await page.waitForSelector('#p1-results [data-download="odoo"]', { timeout: 60000 });
  const odooFile2 = await download('#p1-results [data-download="odoo"]');
  const wbB = new ExcelJS.Workbook(); await wbB.xlsx.readFile(odooFile2);
  const dump = (w) => { const s = w.worksheets[0]; const out = []; s.eachRow((r) => out.push(JSON.stringify(r.values))); return out.join('\n'); };
  check('Proceso 1', 'PDF individuales producen exactamente el mismo Excel Odoo que el PDF consolidado', dump(wbB) === dump(wb));

  // --- Agregar progresivamente (10 + resto)
  await page.click('#p1-reset');
  await chooseWithButton('#dz-p1-orders [data-pick]', inputs.orderFiles.slice(0, 10));
  await waitZoneIdle('#files-p1-orders');
  await chooseWithButton('#dz-p1-orders [data-pick]', inputs.orderFiles.slice(10));
  await waitZoneIdle('#files-p1-orders', 180000);
  check('Carga', 'Agregar archivos por partes (10 primero, el resto después)', (await text('#count-p1-orders')).includes(`${N} pedidos detectados`), await text('#count-p1-orders'));

  // ================================================================ PRUEBA 5-9: PROCESO 2
  await page.click('#tab-dossiers');
  check('Navegación', 'Al cambiar de pestaña se conservan los archivos cargados', await page.evaluate(() => !document.querySelector('#panel-dossiers').hidden));
  await page.click('#tab-invoices');
  check('Navegación', 'Los archivos del proceso 1 siguen cargados al volver', (await zoneRows('#files-p1-orders')).length === inputs.orderFiles.length);
  await page.click('#tab-dossiers');

  await chooseWithButton('#dz-p2-orders [data-pick]', [inputs.ordersShuffled]);
  await dropFiles('#dz-p2-invoices', inputs.invoiceFiles); // facturas individuales en orden aleatorio
  await chooseWithButton('#dz-p2-prevals [data-pick]', [inputs.prevalsShuffled]);
  await waitZoneIdle('#files-p2-orders'); await waitZoneIdle('#files-p2-invoices', 180000); await waitZoneIdle('#files-p2-prevals');
  const c2 = [await text('#count-p2-orders'), await text('#count-p2-invoices'), await text('#count-p2-prevals')];
  check('Proceso 2', `Contadores: ${N} pedidos, ${N} facturas, ${N} prevalidaciones detectadas`, c2[0].includes(`${N} pedidos detectados`) && c2[1].includes(`${N} facturas detectadas`) && c2[2].includes(`${N} prevalidaciones detectadas`), c2.join(' | '));
  const genBefore = await page.$('#p2-results [data-act="generate"]');
  check('Proceso 2', 'No se genera el PDF sin mostrar antes el matching', genBefore === null);
  await page.click('#p2-run');
  await page.waitForSelector('#p2-results .stats', { timeout: 60000 });
  await page.screenshot({ path: path.join(work, 'proceso2-matching.png'), fullPage: true });
  const sv = async (l) => statValue('#p2-results', l);
  const st = { pedidos: await sv('Pedidos'), facturas: await sv('Facturas'), preval: await sv('Prevalidaciones'), coinc: await sv('Coincidencias'), errores: await sv('Errores'), faltantes: await sv('Faltantes'), paginas: await sv('Páginas finales') };
  check('Matching', `${N} coincidencias, 0 errores, 0 faltantes, ${N * 4} páginas (órdenes, facturas y prevalidaciones desordenadas)`, st.pedidos === String(N) && st.facturas === String(N) && st.preval === String(N) && st.coinc === String(N) && st.errores === '0' && st.faltantes === '0' && st.paginas === String(N * 4), JSON.stringify(st));
  const statuses = await page.$$eval('#p2-results .match-table tbody tr:not(.detail-row) .pill', (p) => p.map((x) => x.textContent.trim()));
  check('Matching', 'Todos los registros en estado "Correcto" (sin ambiguos)', statuses.length === N && statuses.every((s) => s === 'Correcto'));
  await page.click('#p2-results .match-table tbody tr:not(.detail-row) [data-act="toggle"]');
  const detailVisible = await page.$eval('#p2-results .detail-row', (r) => !r.hidden && r.querySelectorAll('.doc-card').length === 3);
  check('Matching', 'Se puede expandir un registro y revisar los tres documentos', detailVisible);

  // Generar PDF (orden original de pedidos)
  await page.click('#p2-results [data-act="generate"]');
  await page.waitForSelector('#p2-results [data-act="download"]', { timeout: 120000 });
  const pdfFile = await download('#p2-results [data-act="download"]');
  check('Descargas', 'Descarga del PDF con nombre expedientes_coral_[dia]_[mes]_A5.pdf', /^expedientes_coral_\d{2}_[a-z]+_A5\.pdf$/.test(path.basename(pdfFile)), path.basename(pdfFile));
  const verifyPdf = async (file, expectedSapOrder) => {
    const pages = await pagesFromBytes(fs.readFileSync(file), path.basename(file));
    const errs = [];
    if (pages.length !== N * 4) errs.push(`${pages.length} páginas`);
    const sapOrder = [];
    for (let k = 0; k < pages.length; k += 4) {
      const [f1, f2, o, p] = pages.slice(k, k + 4);
      for (const pg of [f1, f2, o, p]) if (Math.abs(pg.width - 419.53) > 1 || Math.abs(pg.height - 595.28) > 1) errs.push(`pág ${pg.pageNumber}: ${pg.width}×${pg.height}`);
      if (!looksLikeInvoice(f1) || !looksLikeInvoice(f2) || !looksLikeCoralOrder(o) || !looksLikePrevalidation(p)) { errs.push(`expediente ${k / 4 + 1}: tipos de página incorrectos`); continue; }
      const i1 = parseInvoice(f1).invoice; const pr = parsePrevalidation(p).prevalidation;
      if (compact(f1.text) !== compact(f2.text)) errs.push(`expediente ${k / 4 + 1}: la copia no es idéntica`);
      if (!compact(o.text).includes(i1.sap) || !compact(o.text).includes(i1.oc)) errs.push(`expediente ${k / 4 + 1}: la orden no corresponde a la factura ${i1.number}`);
      if (pr.sap !== i1.sap || pr.invoiceNumber !== i1.number) errs.push(`expediente ${k / 4 + 1}: la prevalidación no corresponde`);
      sapOrder.push(i1.sap);
    }
    if (expectedSapOrder && sapOrder.join(',') !== expectedSapOrder.join(',')) errs.push('orden de expedientes distinto al esperado');
    return { errs, sapOrder, pages: pages.length };
  };
  const ordersShuffledSaps = (await pagesFromFile(inputs.ordersShuffled)).map((p) => compact(p.text).match(/[A-Z]{2}\d{6}/g)).map((m) => m && m.find((s) => invBySap.has(s)));
  const v1 = await verifyPdf(pdfFile, ordersShuffledSaps);
  check('PDF final', `${N * 4} páginas A5 (148×210 mm), 4 por pedido: factura, copia idéntica, orden y prevalidación correctas`, v1.errs.length === 0, v1.errs.slice(0, 4).join(' · ') || `${v1.pages} páginas`);
  check('PDF final', 'Orden predeterminado = orden de carga de las órdenes de compra', v1.errs.every((e) => !/orden de expedientes/.test(e)));
  // Reducción tipo impresión: posiciones del texto = posiciones originales × factor único (A4→A5) + centrado
  const outPages = await pagesFromBytes(fs.readFileSync(pdfFile), 'salida.pdf');
  const srcInvPages = await pagesFromFile(SRC.invoices);
  const scaleReport = [];
  for (const [k, role] of [[0, 'factura'], [1, 'copia']]) {
    const outP = outPages[k];
    const inv0 = parseInvoice(outPages[0]).invoice;
    const srcP = srcInvPages.find((p) => parseInvoice(p).invoice?.number === inv0.number);
    const uniq = (pg) => { const m = new Map(); for (const t of pg.tokens) m.set(t.str, m.has(t.str) ? null : t); return m; };
    const a = uniq(srcP); const b = uniq(outP);
    const pairs = [...a].filter(([str, t]) => t && b.get(str) && str.length > 3).map(([str, t]) => [t, b.get(str)]);
    const fit = (get) => { const n = pairs.length; const xs = pairs.map(([s]) => get(s)); const ys = pairs.map(([, o]) => get(o)); const mx = xs.reduce((q, v) => q + v, 0) / n; const my = ys.reduce((q, v) => q + v, 0) / n; const sxx = xs.reduce((q, v) => q + (v - mx) ** 2, 0); const sxy = xs.reduce((q, v, i) => q + (v - mx) * (ys[i] - my), 0); const sc = sxy / sxx; const res = Math.max(...xs.map((v, i) => Math.abs(sc * v + (my - sc * mx) - ys[i]))); return { sc, res }; };
    const fx = fit((t) => t.x); const fy = fit((t) => t.y);
    scaleReport.push({ role, pares: pairs.length, escalaX: +fx.sc.toFixed(4), escalaY: +fy.sc.toFixed(4), desvioMax: +Math.max(fx.res, fy.res).toFixed(2) });
  }
  const expectedScale = Math.min(419.528 / srcInvPages[0].width, 595.276 / srcInvPages[0].height);
  check('PDF final', `Cada página A4 reducida a A5 como al imprimir: factor único ${expectedScale.toFixed(4)} en ancho y alto, sin deformar ni recortar`, scaleReport.every((r) => r.pares > 20 && Math.abs(r.escalaX - expectedScale) < 0.002 && Math.abs(r.escalaY - expectedScale) < 0.002 && r.desvioMax < 1), JSON.stringify(scaleReport));
  const pdfSize = fs.statSync(pdfFile).size;
  check('PDF final', 'Páginas vectoriales (no imágenes): tamaño razonable', pdfSize < 8 * 1024 * 1024, `${(pdfSize / 1024).toFixed(0)} KB`);

  // Legibilidad de códigos: QR de la prevalidación y código de barras de la factura en el PDF final
  const bc = (file, pg, dpi) => { try { return JSON.parse(execFileSync('python3', [path.join(HERE, 'lib', 'barcode_check.py'), file, String(pg), String(dpi)], { encoding: 'utf-8', timeout: 60000 }).trim()); } catch (e) { return { ok: null, skipped: e.message.slice(0, 80) }; } };
  const firstSap = ordersShuffledSaps[0];
  const srcPreIndex = truthPrevals.findIndex((x) => x.sap === firstSap);
  const qrOut = bc(pdfFile, 4, 200); const qrSrc = bc(SRC.prevals, srcPreIndex + 1, 200);
  if (qrOut.ok === null || qrSrc.ok === null || !qrSrc.codes.length) check('PDF final', 'QR de la prevalidación legible en A5 (200 dpi)', null, qrOut.skipped || qrSrc.skipped || 'el documento fuente no tiene QR legible');
  else check('PDF final', 'QR de la prevalidación legible en A5 (200 dpi) e idéntico al original', qrOut.codes.some((c) => qrSrc.codes.some((d) => d.text === c.text)), qrOut.codes.map((c) => c.format).join(','));
  const barOut = bc(pdfFile, 1, 300);
  const firstInv = invBySap.get(firstSap);
  const barSrc = bc(SRC.invoices, truthInvoices.indexOf(firstInv) + 1, 300);
  if (barOut.ok === null || barSrc.ok === null) check('PDF final', 'Código de barras de la factura legible (300 dpi)', null, barOut.skipped || barSrc.skipped);
  else if (!barSrc.codes.length) check('PDF final', 'Código de barras de la factura legible (300 dpi)', null, 'el documento fuente no tiene un código de barras legible');
  else check('PDF final', 'Código de barras de la factura legible (300 dpi) = clave de acceso', barOut.codes.some((c) => c.text === firstInv.accessKey), barOut.codes.map((c) => c.text).join(','));

  // Orden por número de factura
  await page.selectOption('#p2-sort', 'invoice');
  await page.click('#p2-results [data-act="generate"]');
  await page.waitForSelector('#p2-results [data-act="download"]', { timeout: 120000 });
  const pdfFile2 = await download('#p2-results [data-act="download"]');
  const byInvoice = [...truthInvoices].sort((a, b) => a.number.localeCompare(b.number)).map((i) => i.sap);
  const v2 = await verifyPdf(pdfFile2, byInvoice);
  check('PDF final', 'Opción "orden por número de factura" sin alterar el matching', v2.errs.length === 0, v2.errs.slice(0, 3).join(' · '));

  // Prueba 8: falta una prevalidación
  await page.click('#files-p2-prevals button[data-action="clear"]');
  await chooseWithButton('#dz-p2-prevals [data-pick]', [inputs.prevalsMissingOne]);
  await waitZoneIdle('#files-p2-prevals');
  await page.click('#p2-run');
  await page.waitForSelector('#p2-results .stats', { timeout: 60000 });
  const removedSap = truthPrevals[inputs.removedPrevalIndex]?.sap;
  const missingRows = await page.$$eval('#p2-results .match-table tbody tr:not(.detail-row)', (rs) => rs.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent.trim())).filter((c) => /Falta prevalidación/.test(c.join(' '))));
  const genDisabled = await page.$eval('#p2-results [data-act="generate"]', (b) => b.disabled);
  check('Faltantes', `Identifica el SAP sin prevalidación (${removedSap}) con estado "Falta prevalidación"`, missingRows.length === 1 && missingRows[0].includes(removedSap), JSON.stringify(missingRows));
  check('Faltantes', 'Bloquea la generación de un PDF incompleto', genDisabled && /Generación bloqueada/.test(await text('#p2-results')));

  // Corrección: reemplazar el archivo incompleto por el completo
  await chooseWithButton('#files-p2-prevals button[data-action="replace"]', [inputs.prevals]);
  await waitZoneIdle('#files-p2-prevals');
  const replaced = await zoneRows('#files-p2-prevals');
  check('Faltantes', 'Botón "Reemplazar" sustituye el archivo incompleto por el corregido', replaced.length === 1 && replaced[0].name === 'prevalidaciones.pdf', replaced.map((r) => r.name).join(', '));
  // Duplicado: la misma factura dos veces (consolidada + individual)
  await chooseWithButton('#dz-p2-invoices [data-pick]', [inputs.invoices]);
  await waitZoneIdle('#files-p2-prevals'); await waitZoneIdle('#files-p2-invoices');
  await page.click('#p2-run');
  await page.waitForSelector('#p2-results .stats', { timeout: 60000 });
  const dupStatuses = await page.$$eval('#p2-results .match-table tbody tr:not(.detail-row) .pill', (p) => p.map((x) => x.textContent.trim()));
  check('Faltantes', 'Facturas cargadas dos veces → estado "Duplicado" y generación bloqueada', dupStatuses.filter((s) => s === 'Duplicado').length === N && (await page.$eval('#p2-results [data-act="generate"]', (b) => b.disabled)), `${dupStatuses.filter((s) => s === 'Duplicado').length} duplicados`);

  // Corrección: reemplazar/eliminar y volver a validar
  await page.click(`#files-p2-invoices .file-row:has(.file-name:text-is("facturas.pdf")) button[data-action="remove"]`);
  await page.click('#p2-run');
  await page.waitForSelector('#p2-results .stats', { timeout: 60000 });
  check('Faltantes', 'Tras quitar el archivo duplicado el matching vuelve a ser válido', (await statValue('#p2-results', 'Coincidencias')) === String(N) && !(await page.$eval('#p2-results [data-act="generate"]', (b) => b.disabled)));

  // Botones de reinicio
  await page.click('#p2-reset');
  await sleep(300);
  check('Botones', 'Reiniciar limpia las tres áreas del proceso 2', (await zoneRows('#files-p2-orders')).length === 0 && (await zoneRows('#files-p2-invoices')).length === 0 && (await zoneRows('#files-p2-prevals')).length === 0);

  // Diálogos
  await page.click('#help-btn');
  const helpOpen = await page.$eval('#help-dialog', (d) => d.open);
  await page.click('#help-dialog [data-close]');
  await page.click('#diag-btn');
  const diagText = await page.$eval('#diag-dialog pre', (p) => p.textContent);
  await page.click('#diag-dialog .dialog-head [data-close]');
  check('Botones', 'Ayuda y Diagnóstico abren y cierran', helpOpen && /MegaFlow 3/.test(diagText));

  // ================================================================ PRIVACIDAD
  const external = netRequests.filter((r) => !r.url.startsWith(srv.url) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  const nonGet = srv.requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
  check('Privacidad', 'Ninguna solicitud a otros dominios durante todas las pruebas', external.length === 0, external.slice(0, 3).map((r) => r.url).join(', '));
  check('Privacidad', 'El servidor solo recibió GET de archivos de la app (ningún envío de documentos)', nonGet.length === 0 && srv.requests.every((r) => !/\.pdf$/i.test(r.path)), `${srv.requests.length} solicitudes GET`);
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookies: document.cookie,
    idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
  }));
  check('Privacidad', 'Sin documentos en localStorage, sessionStorage, IndexedDB ni cookies (solo el tema)', storage.local.join(',') === 'megaflow-theme' && storage.session.length === 0 && !storage.cookies && storage.idb.length === 0, JSON.stringify(storage));
  const csp = await page.evaluate(() => window.__csp || []);
  check('Privacidad', 'Política CSP activa sin violaciones (connect-src self)', csp.length === 0, csp.join(', '));
  check('Estabilidad', 'Sin errores de JavaScript en la consola', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' · '));
} catch (err) {
  check('Ejecución', 'La prueba terminó sin excepciones', false, err.stack || err.message);
  await page.screenshot({ path: path.join(work, 'fallo.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await srv.close();
}

const passed = results.filter((r) => r.ok === true).length;
const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
const md = [
  `# Resultados de pruebas E2E — MegaFlow ${CONFIG.app.version}`,
  '',
  `Fecha: ${new Date().toISOString()} · Navegador: Chromium (Playwright)${safariMode ? ` con emulación de Safari (${safariMode})` : ''} · Servidor estático con subruta /megaflow/`,
  `Datos: ${N} órdenes (${path.basename(SRC.orders)}, ${path.basename(SRC.invoices)}, ${path.basename(SRC.prevals)})`,
  '',
  `**${passed} correctas · ${failed} fallidas · ${skipped} no ejecutadas**`,
  '',
  '| Grupo | Comprobación | Resultado | Detalle |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.group} | ${r.name} | ${r.ok === null ? 'No ejecutada' : r.ok ? 'OK' : 'FALLÓ'} | ${r.detail.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 220)} |`),
  '',
  `Archivos de trabajo (capturas, descargas): ${work}`,
].join('\n');
if (args.report) fs.writeFileSync(path.resolve(args.report), md);
console.log(`\n${passed} correctas · ${failed} fallidas · ${skipped} no ejecutadas\nCarpeta de trabajo: ${work}`);
process.exit(failed ? 1 : 0);
