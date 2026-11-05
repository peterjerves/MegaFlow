/**
 * Excel de IMPORTACIÓN MASIVA de facturas de cliente para Odoo 19.3.
 *
 * Mecanismo del importador estándar de Odoo para registros con varias líneas:
 *  - La PRIMERA fila de cada factura lleva los campos de cabecera (Partner, fechas, diario, referencia).
 *  - Las filas siguientes dejan la cabecera vacía: Odoo las agrega como líneas de la misma factura.
 *  - Una nueva fila con Partner inicia la siguiente factura.
 * Cada orden Coral => una factura. Líneas 'product' + una nota final 'line_note'.
 * No se usa columna "id" (identificador externo) para no actualizar facturas existentes.
 * Las facturas se crean como BORRADOR: este archivo no confirma ni envía nada al SRI.
 */
import { CONFIG } from './config.js';
import { fill } from './text-utils.js';

const COLS = CONFIG.odoo.columns;
const C = Object.fromEntries(COLS.map((name, i) => [name, i]));

/** Texto de la nota final de cada factura (tres renglones). */
export const noteText = (o) => `${o.store}\nSAP: ${o.sap}\nOC: ${o.oc}`;
export const referenceText = (o) => fill(CONFIG.odoo.referenceTemplate, { oc: o.oc, sap: o.sap });

/**
 * Construye la matriz de filas. Devuelve { header, rows, groups } donde groups
 * indica qué filas pertenecen a cada orden (para validación).
 */
export function buildOdooRows(orders, s) {
  const rows = [];
  const groups = [];
  for (const o of orders) {
    const start = rows.length;
    o.lines.forEach((l, j) => {
      const r = new Array(COLS.length).fill('');
      if (j === 0) {
        r[C['Partner']] = s.customer.trim();
        r[C['Invoice Bill Date']] = s.invoiceDate;
        r[C['Due Date']] = s.dueDate;
        r[C['Payment Terms']] = (s.paymentTerms || '').trim();
        r[C['Journal*']] = s.journal.trim();
        r[C['Reference']] = referenceText(o);
      }
      r[C['Invoice Lines/Product']] = l.product.odooName;
      r[C['Invoice Lines/Account*']] = s.account.trim();
      r[C['Invoice Lines/Quantity']] = l.qty;
      r[C['Invoice Lines/Unit Price']] = l.priceCents / 100;
      r[C['Invoice Lines/Taxes/Database ID']] = s.taxId;
      r[C['Invoice Lines/Display Type']] = CONFIG.odoo.displayTypeProduct;
      rows.push(r);
    });
    const note = new Array(COLS.length).fill('');
    note[C['Invoice Lines/Label']] = noteText(o);
    note[C['Invoice Lines/Display Type']] = CONFIG.odoo.displayTypeNote;
    rows.push(note);
    groups.push({ sap: o.sap, start, end: rows.length - 1 });
  }
  return { header: [...COLS], rows, groups };
}

/**
 * Verifica la matriz FINAL que se escribirá en el Excel (no el modelo intermedio).
 * Devuelve una lista de errores (vacía si todo es correcto).
 */
export function validateOdooRows({ rows, groups }, orders, s) {
  const errors = [];
  if (groups.length !== orders.length) errors.push(`Se esperaban ${orders.length} facturas y se prepararon ${groups.length}.`);
  // Cada fila con Partner inicia factura; contar inicios.
  const starts = rows.map((r, i) => (r[C['Partner']] ? i : -1)).filter((i) => i >= 0);
  if (starts.length !== orders.length) errors.push(`El archivo tendría ${starts.length} facturas (filas con cliente) para ${orders.length} órdenes.`);
  if (rows.length && !rows[0][C['Partner']]) errors.push('La primera fila no inicia una factura: habría líneas huérfanas.');
  const refs = new Set();
  groups.forEach((g, gi) => {
    const o = orders[gi];
    const block = rows.slice(g.start, g.end + 1);
    const head = block[0];
    const tag = `Factura de ${o.sap}`;
    if (head[C['Partner']] !== s.customer.trim()) errors.push(`${tag}: cliente incorrecto.`);
    if (head[C['Journal*']] !== s.journal.trim()) errors.push(`${tag}: diario incorrecto.`);
    if (head[C['Invoice Bill Date']] !== s.invoiceDate || head[C['Due Date']] !== s.dueDate) errors.push(`${tag}: fechas incorrectas.`);
    const ref = head[C['Reference']];
    if (!ref.includes(o.oc) || !ref.includes(o.sap)) errors.push(`${tag}: la referencia no contiene OC y SAP.`);
    if (refs.has(ref)) errors.push(`${tag}: referencia duplicada (${ref}).`);
    refs.add(ref);
    const products = block.filter((r) => r[C['Invoice Lines/Display Type']] === CONFIG.odoo.displayTypeProduct);
    const notes = block.filter((r) => r[C['Invoice Lines/Display Type']] === CONFIG.odoo.displayTypeNote);
    if (products.length !== o.lines.length) errors.push(`${tag}: ${products.length} líneas de producto para ${o.lines.length} de la orden.`);
    if (notes.length !== 1) errors.push(`${tag}: debe tener exactamente una nota final.`);
    const last = block[block.length - 1];
    if (last[C['Invoice Lines/Display Type']] !== CONFIG.odoo.displayTypeNote) errors.push(`${tag}: la nota no es la última línea.`);
    if (last[C['Invoice Lines/Label']] !== noteText(o)) errors.push(`${tag}: el texto de la nota no es correcto.`);
    for (const n of notes) {
      if (n[C['Invoice Lines/Product']] || n[C['Invoice Lines/Quantity']] !== '' || n[C['Invoice Lines/Unit Price']] !== '' || n[C['Invoice Lines/Taxes/Database ID']] !== '' || n[C['Invoice Lines/Account*']]) {
        errors.push(`${tag}: la nota no debe tener producto, cantidad, precio, cuenta ni impuesto.`);
      }
    }
    let sumCents = 0;
    for (const p of products) {
      if (!p[C['Invoice Lines/Product']]) errors.push(`${tag}: línea sin producto.`);
      if (p[C['Invoice Lines/Account*']] !== s.account.trim()) errors.push(`${tag}: cuenta contable incorrecta.`);
      if (p[C['Invoice Lines/Taxes/Database ID']] !== s.taxId) errors.push(`${tag}: impuesto incorrecto.`);
      if (!Number.isInteger(p[C['Invoice Lines/Quantity']]) || p[C['Invoice Lines/Quantity']] <= 0) errors.push(`${tag}: cantidad inválida.`);
      sumCents += p[C['Invoice Lines/Quantity']] * Math.round(p[C['Invoice Lines/Unit Price']] * 100);
    }
    if (sumCents !== o.totalCents) errors.push(`${tag}: el subtotal del archivo (${(sumCents / 100).toFixed(2)}) no coincide con el TOTAL de la orden (${(o.totalCents / 100).toFixed(2)}).`);
    for (const r of block.slice(1)) {
      if (r[C['Partner']] || r[C['Journal*']] || r[C['Invoice Bill Date']]) errors.push(`${tag}: una línea intermedia tiene datos de cabecera (crearía otra factura).`);
    }
  });
  for (const [i, r] of rows.entries()) {
    const dt = r[C['Invoice Lines/Display Type']];
    if (dt !== CONFIG.odoo.displayTypeProduct && dt !== CONFIG.odoo.displayTypeNote) errors.push(`Fila ${i + 2}: falta "Display Type" (product / line_note).`);
  }
  return errors;
}

/** Genera el XLSX (ExcelJS inyectado). Devuelve un ArrayBuffer. */
export async function writeOdooWorkbook(ExcelJS, { header, rows }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MegaFlow';
  wb.created = new Date();
  const ws = wb.addWorksheet(CONFIG.odoo.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(header);
  for (const r of rows) {
    // Las celdas vacías se escriben como null para que queden realmente vacías.
    ws.addRow(r.map((v) => (v === '' ? null : v)));
  }
  const widths = [34, 18, 14, 16, 18, 54, 26, 12, 14, 18, 32, 40, 18];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const headerRow = ws.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  const dtCol = COLS.indexOf('Invoice Lines/Display Type') + 1;
  const labelCol = COLS.indexOf('Invoice Lines/Label') + 1;
  const priceCol = COLS.indexOf('Invoice Lines/Unit Price') + 1;
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const isNote = row.getCell(dtCol).value === CONFIG.odoo.displayTypeNote;
    row.getCell(labelCol).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(priceCol).numFmt = '0.00';
    if (isNote) row.height = 45;
  }
  return wb.xlsx.writeBuffer();
}
