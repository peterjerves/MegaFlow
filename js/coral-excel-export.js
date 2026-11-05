/**
 * Excel de CONTROL de pedidos Coral (independiente del archivo de Odoo).
 * Una fila por orden (nunca se agrupan tiendas). Tabla de Excel "PedidosCoral".
 * Columna H = fórmula =CONCAT(A2,CHAR(10),"SAP: ",B2,CHAR(10),"OC: ",C2).
 *
 * Nota técnica: CONCAT es una función "futura" de Excel; en el XML debe guardarse
 * como _xlfn.CONCAT para que Excel no muestre #NAME?. Excel la presenta como =CONCAT(...).
 */
import { CONFIG } from './config.js';
import { sizeTotals } from './validations.js';

export const detailFormula = (r) => `_xlfn.CONCAT(A${r},CHAR(10),"SAP: ",B${r},CHAR(10),"OC: ",C${r})`;
export const detailFormulaDisplay = (r) => `=CONCAT(A${r},CHAR(10),"SAP: ",B${r},CHAR(10),"OC: ",C${r})`;
export const detailText = (o) => `${o.store}\nSAP: ${o.sap}\nOC: ${o.oc}`;

/** Filas del control (valores, sin fórmula) — se usan para validar y mostrar. */
export function buildControlRows(orders) {
  return orders.map((o) => {
    const sz = sizeTotals(o.lines);
    return [o.store, o.sap, o.oc, sz.M, sz.L, sz.XL, o.totalCents / 100, detailText(o)];
  });
}

export function validateControlRows(rows, orders) {
  const errors = [];
  if (rows.length !== orders.length) errors.push(`El control tendría ${rows.length} filas para ${orders.length} órdenes.`);
  rows.forEach((r, i) => {
    const o = orders[i];
    if (r.length !== 8) errors.push(`Fila ${i + 2}: debe tener 8 columnas.`);
    if (r[1] !== o.sap || r[2] !== o.oc) errors.push(`Fila ${i + 2}: SAP/OC no corresponden a la orden.`);
    for (const k of [3, 4, 5]) if (!Number.isInteger(r[k]) || r[k] < 0) errors.push(`Fila ${i + 2}: cantidad de talla inválida.`);
    const units = r[3] + r[4] + r[5];
    const expected = o.lines.reduce((s, l) => s + l.qty, 0);
    if (units !== expected) errors.push(`Fila ${i + 2}: las tallas suman ${units} y la orden tiene ${expected} paquetes.`);
    if (Math.round(r[6] * 100) !== o.totalCents) errors.push(`Fila ${i + 2}: valor de orden incorrecto.`);
  });
  return errors;
}

/** Genera el XLSX (ExcelJS inyectado). Devuelve un ArrayBuffer. */
export async function writeControlWorkbook(ExcelJS, orders) {
  const cfg = CONFIG.controlExcel;
  const values = buildControlRows(orders);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MegaFlow';
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const ws = wb.addWorksheet(cfg.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });

  const tableRows = values.map((v, i) => {
    const r = i + 2;
    return [v[0], v[1], v[2], v[3], v[4], v[5], v[6], { formula: detailFormula(r), result: v[7] }];
  });
  ws.addTable({
    name: cfg.tableName,
    displayName: cfg.tableName,
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: cfg.columns.map((name) => ({ name, filterButton: true })),
    rows: tableRows,
  });

  const widths = [44, 18, 18, 10, 10, 10, 18, 46];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const header = ws.getRow(1);
  header.height = 30;
  for (let c = 1; c <= 8; c++) {
    const cell = header.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cfg.headerColor } };
    cell.alignment = { vertical: 'middle', horizontal: c >= 4 && c <= 7 ? 'center' : 'left', wrapText: true };
  }
  for (let r = 2; r <= values.length + 1; r++) {
    const row = ws.getRow(r);
    row.height = 48;
    for (const c of [4, 5, 6]) { row.getCell(c).numFmt = '0'; row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }; }
    row.getCell(7).numFmt = '"$"#,##0.00';
    row.getCell(7).alignment = { vertical: 'middle' };
    for (const c of [1, 2, 3]) row.getCell(c).alignment = { vertical: 'middle' };
    row.getCell(8).alignment = { wrapText: true, vertical: 'middle' };
  }
  return wb.xlsx.writeBuffer();
}
