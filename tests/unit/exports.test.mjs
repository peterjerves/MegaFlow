import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildOdooRows, validateOdooRows, writeOdooWorkbook, noteText } from '../../js/odoo-export.js';
import { buildControlRows, validateControlRows, writeControlWorkbook } from '../../js/coral-excel-export.js';
import { analyzeOrders } from '../../js/invoice-prep.js';
import { CONFIG } from '../../js/config.js';
import { line, order, SETTINGS } from './helpers.mjs';

const orders = () => [
  order('AL204391', '5601928535', [line('L', 30), line('XL', 10)], { store: 'TIENDA CORAL ALBORADA / GUAYAQUIL' }),
  order('ZZ900002', '5609900002', [line('L', 10)], { store: 'TIENDA CORAL ALBORADA / GUAYAQUIL' }),
];
const C = Object.fromEntries(CONFIG.odoo.columns.map((c, i) => [c, i]));

test('Odoo: una factura por orden, misma tienda no se agrupa, nota final line_note', () => {
  const os = orders();
  const x = buildOdooRows(os, SETTINGS);
  assert.equal(x.groups.length, 2);
  assert.equal(x.rows.length, 5); // 2 productos + nota, 1 producto + nota
  assert.deepEqual(x.rows.map((r) => r[C['Invoice Lines/Display Type']]), ['product', 'product', 'line_note', 'product', 'line_note']);
  assert.equal(x.rows[0][C.Partner], SETTINGS.customer);
  assert.equal(x.rows[1][C.Partner], '');
  assert.equal(x.rows[0][C.Reference], 'OC 5601928535 / SAP AL204391');
  assert.equal(x.rows[2][C['Invoice Lines/Label']], 'TIENDA CORAL ALBORADA / GUAYAQUIL\nSAP: AL204391\nOC: 5601928535');
  assert.equal(x.rows[2][C['Invoice Lines/Taxes/Database ID']], '');
  assert.equal(x.rows[0][C['Invoice Lines/Taxes/Database ID']], 5);
  assert.deepEqual(validateOdooRows(x, os, SETTINGS), []);
});

test('Odoo: la validación detecta display_type vacío, líneas huérfanas y notas con precio', () => {
  const os = orders();
  const x = buildOdooRows(os, SETTINGS);
  const bad1 = structuredClone(x); bad1.rows[1][C['Invoice Lines/Display Type']] = '';
  assert.ok(validateOdooRows(bad1, os, SETTINGS).some((e) => /Display Type/.test(e)));
  const bad2 = structuredClone(x); bad2.rows[0][C.Partner] = '';
  assert.ok(validateOdooRows(bad2, os, SETTINGS).length > 0);
  const bad3 = structuredClone(x); bad3.rows[2][C['Invoice Lines/Unit Price']] = 1;
  assert.ok(validateOdooRows(bad3, os, SETTINGS).some((e) => /nota/.test(e)));
});

test('Odoo: XLSX con columnas exactas, celdas vacías reales y 2 facturas', async () => {
  const os = orders();
  const buf = await writeOdooWorkbook(ExcelJS, buildOdooRows(os, SETTINGS));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  assert.deepEqual(ws.getRow(1).values.slice(1), CONFIG.odoo.columns);
  assert.equal(ws.rowCount, 6);
  assert.equal(ws.getCell(3, 1).value, null);
  assert.equal(ws.getCell(4, 13).value, 'line_note');
  assert.equal(ws.getCell(4, 12).value, noteText(os[0]));
  assert.equal(ws.getCell(2, 2).value, '2026-11-01');
});

test('Control: 8 columnas, tabla PedidosCoral, fórmula CONCAT en H por fila', async () => {
  const os = orders();
  const rows = buildControlRows(os);
  assert.deepEqual(rows[0].slice(0, 7), ['TIENDA CORAL ALBORADA / GUAYAQUIL', 'AL204391', '5601928535', 0, 30, 10, 93.3]);
  assert.deepEqual(validateControlRows(rows, os), []);
  const buf = await writeControlWorkbook(ExcelJS, os);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('PedidosCoral');
  assert.deepEqual(ws.getRow(1).values.slice(1), CONFIG.controlExcel.columns);
  assert.equal(ws.getCell('H2').value.formula, '_xlfn.CONCAT(A2,CHAR(10),"SAP: ",B2,CHAR(10),"OC: ",C2)');
  assert.equal(ws.getCell('H3').value.formula, '_xlfn.CONCAT(A3,CHAR(10),"SAP: ",B3,CHAR(10),"OC: ",C3)');
  assert.ok(ws.getTables().map((t) => (t.table || t).name).includes('PedidosCoral'));
  assert.equal(ws.autoFilter, undefined); // el filtro lo aporta la tabla (evita conflicto que Excel repara)
});

test('Proceso 1 completo: bloquea con duplicados y con fecha inválida', () => {
  const os = orders();
  const docs = os.map((o) => ({ ok: true, kind: 'ok', type: 'order', record: o, page: o.page }));
  assert.equal(analyzeOrders(docs, SETTINGS).blocking, false);
  const dup = [...docs, { ...docs[0] }];
  const a = analyzeOrders(dup, SETTINGS);
  assert.equal(a.blocking, true);
  assert.ok(a.problems.some((p) => /duplicado/i.test(p)));
  assert.equal(analyzeOrders(docs, { ...SETTINGS, invoiceDate: '' }).blocking, true);
  const withBadPage = [...docs, { ok: false, kind: 'scanned', page: { fileName: 'scan.pdf', pageNumber: 1 }, error: 'Este documento parece escaneado y no contiene texto seleccionable.' }];
  const b = analyzeOrders(withBadPage, SETTINGS);
  assert.equal(b.blocking, true);
  assert.ok(b.problems.some((p) => /escaneado/.test(p)));
});
