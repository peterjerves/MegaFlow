import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrder, validateSettings, sizeTotals, orderAmounts } from '../../js/validations.js';
import { completeCity } from '../../js/coral-parser.js';
import { line, order, SETTINGS } from './helpers.mjs';

const cats = (o) => validateOrder(o).errors.map((e) => e.cat);

test('Orden correcta no tiene errores', () => {
  assert.deepEqual(validateOrder(order('AL204391', '5601928535', [line('L', 30), line('XL', 10)])).errors, []);
});

test('Producto desconocido detiene el proceso', () => {
  const o = order('AL000001', '5600000001', [line('L', 10, { ean: '7861234567897', product: null })]);
  assert.ok(cats(o).includes('product'));
});

test('Precio distinto al catálogo: error, nunca se corrige', () => {
  const l = line('L', 10, { priceCents: 230, totalCents: 2300 });
  const o = order('AL000002', '5600000002', [l]);
  assert.ok(cats(o).includes('price'));
  assert.equal(l.priceCents, 230);
});

test('Cantidad no entera, total de línea y total de orden incoherentes', () => {
  assert.ok(cats(order('AL000003', '5600000003', [line('L', 10, { qty: 10.5, totalCents: 2363 })])).includes('qty'));
  assert.ok(cats(order('AL000004', '5600000004', [line('L', 10, { totalCents: 2000 })], { totalCents: 2000 })).includes('line-total'));
  assert.ok(cats(order('AL000005', '5600000005', [line('L', 10)], { totalCents: 9999 })).includes('order-total'));
});

test('Talla de la descripción distinta a la del EAN', () => {
  assert.ok(cats(order('AL000006', '5600000006', [line('L', 10, { sizeFromDescription: 'XL' })])).includes('size'));
});

test('SAP y OC con formato inválido', () => {
  const c = cats(order('ABC', '123', [line('M', 12)]));
  assert.ok(c.includes('sap') && c.includes('oc'));
});

test('Tallas por orden: cantidades exactas y 0 si no aparece (X10/X5 no influyen)', () => {
  assert.deepEqual(sizeTotals([line('L', 30), line('XL', 10)]), { M: 0, L: 30, XL: 10 });
  const a = orderAmounts([line('L', 30), line('XL', 10)], 15);
  assert.equal(a.subtotalCents, 9330);
  assert.equal(a.ivaCents, 1400);
  assert.equal(a.totalCents, 10730);
});

test('Parámetros de Odoo: fechas y campos obligatorios', () => {
  assert.deepEqual(validateSettings(SETTINGS), []);
  assert.ok(validateSettings({ ...SETTINGS, dueDate: '2026-10-01' }).some((e) => /anterior/.test(e)));
  assert.ok(validateSettings({ ...SETTINGS, journal: '' }).some((e) => /diario/.test(e)));
  assert.ok(validateSettings({ ...SETTINGS, taxId: 0 }).some((e) => /impuesto/.test(e)));
});

test('Ciudad recortada: se completa solo con confirmación inequívoca de la dirección', () => {
  assert.equal(completeCity('TIENDA CORAL ALBORADA / GUAYAQ', 'GUAYAQUIL, AV DE PRUEBA').store, 'TIENDA CORAL ALBORADA / GUAYAQUIL');
  assert.equal(completeCity('TIENDA CORAL LA MAGDALENA / QU', 'QUITO, CALLE FICTICIA').store, 'TIENDA CORAL LA MAGDALENA / QUITO');
  assert.equal(completeCity('TIENDA CORAL CEIBOS / GUAYAS', 'GUAYAQUIL,AV INVENTADA').store, 'TIENDA CORAL CEIBOS / GUAYAS');
  assert.equal(completeCity('TIENDA CORAL X / QU', 'AV PRINCIPAL').store, 'TIENDA CORAL X / QU'); // sin confirmación: no inventa
  assert.equal(completeCity('TIENDA CORAL X / QU', 'QUITO, QUINDE').store, 'TIENDA CORAL X / QU'); // ambiguo: no inventa
  assert.equal(completeCity('TIENDA CORAL AMBATO', 'AV AMERICAS').store, 'TIENDA CORAL AMBATO');
});
