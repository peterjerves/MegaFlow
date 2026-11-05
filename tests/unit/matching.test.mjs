import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDocuments, sortRows } from '../../js/matching-engine.js';
import { line, order, invoiceFor, prevalFor } from './helpers.mjs';

function batch() {
  const o1 = order('AL204391', '5601928535', [line('L', 30), line('XL', 10)]);
  const o2 = order('BM167744', '5601931979', [line('M', 12), line('L', 10), line('XL', 10)]);
  const o3 = order('ZZ900001', '5609900001', [line('L', 10)]);
  return { orders: [o1, o2, o3], invoices: [invoiceFor(o1, '001-001-000000366'), invoiceFor(o2, '001-001-000000901'), invoiceFor(o3, '001-001-000000902')], prevals: [prevalFor(o1, '001-001-000000366'), prevalFor(o2, '001-001-000000901'), prevalFor(o3, '001-001-000000902')] };
}
const statusOf = (res, sap) => res.rows.find((r) => r.sap === sap).status;

test('Tres documentos relacionados por identificadores: todo correcto', () => {
  const r = matchDocuments(batch());
  assert.equal(r.summary.valid, true);
  assert.equal(r.summary.matched, 3);
  assert.equal(r.summary.pages, 12);
  assert.equal(r.rows.find((x) => x.sap === 'AL204391').invoice.number, '001-001-000000366');
});

test('El resultado no depende del orden de las páginas', () => {
  const b = batch();
  const a = matchDocuments(b);
  const r = matchDocuments({ orders: b.orders, invoices: [...b.invoices].reverse(), prevals: [b.prevals[1], b.prevals[2], b.prevals[0]] });
  const pairs = (x) => x.rows.map((row) => `${row.sap}->${row.invoice.number}`).sort().join(',');
  assert.equal(pairs(r), pairs(a));
});

test('Falta prevalidación', () => {
  const b = batch(); b.prevals.splice(0, 1);
  const r = matchDocuments(b);
  assert.equal(statusOf(r, 'AL204391'), 'missing_preval');
  assert.equal(r.summary.valid, false);
});

test('Falta factura', () => {
  const b = batch(); b.invoices.splice(1, 1);
  assert.equal(statusOf(matchDocuments(b), 'BM167744'), 'missing_invoice');
});

test('Falta orden (prevalidación y factura de un SAP no cargado)', () => {
  const b = batch(); b.orders.splice(2, 1);
  const r = matchDocuments(b);
  assert.ok(r.rows.some((x) => x.sap === 'ZZ900001' && x.status === 'missing_order'));
  assert.equal(r.summary.valid, false);
});

test('Total diferente entre factura y prevalidación', () => {
  const b = batch(); b.prevals[2].totalCents += 1;
  assert.equal(statusOf(matchDocuments(b), 'ZZ900001'), 'total_mismatch');
});

test('Duplicado: la misma factura dos veces', () => {
  const b = batch(); b.invoices.push({ ...b.invoices[0], page: { ...b.invoices[0].page, pageIndex: 99 } });
  assert.equal(statusOf(matchDocuments(b), 'AL204391'), 'duplicate');
});

test('Ambiguo: dos prevalidaciones del mismo pedido con facturas distintas', () => {
  const b = batch(); b.prevals.push({ ...b.prevals[0], invoiceNumber: '001-001-000000999' });
  assert.equal(statusOf(matchDocuments(b), 'AL204391'), 'ambiguous');
});

test('Datos inconsistentes: OC de la factura distinta a la orden', () => {
  const b = batch(); b.invoices[0].oc = '5609999999';
  assert.equal(statusOf(matchDocuments(b), 'AL204391'), 'inconsistent');
});

test('Nunca empareja por importes iguales: factura con el mismo total pero otro número', () => {
  const b = batch();
  b.invoices[2] = { ...b.invoices[2], number: '001-001-000000777' }; // mismo SAP/total, pero la prevalidación indica 360
  const r = matchDocuments(b);
  assert.equal(statusOf(r, 'ZZ900001'), 'missing_invoice');
});

test('Ordenamientos opcionales no alteran los pares', () => {
  const r = matchDocuments(batch());
  assert.deepEqual(sortRows(r.rows, 'invoice').map((x) => x.invoiceNumber), ['001-001-000000366', '001-001-000000901', '001-001-000000902']);
  assert.deepEqual(sortRows(r.rows, 'sap').map((x) => x.sap), ['AL204391', 'BM167744', 'ZZ900001']);
  assert.deepEqual(sortRows(r.rows, 'orders').map((x) => x.sap), ['AL204391', 'BM167744', 'ZZ900001']);
});

test('Diferencias de productos o clave de acceso son observaciones: no bloquean el expediente', () => {
  const b = batch();
  b.invoices[0].lines = [{ ean: b.invoices[0].lines[0].ean, qty: 999, priceCents: 1, totalCents: 999 }];
  b.invoices[0].accessKey = '1'.repeat(49); b.prevals[0].accessKey = '2'.repeat(49);
  const r = matchDocuments(b);
  const row = r.rows.find((x) => x.sap === 'AL204391');
  assert.equal(row.status, 'ok');
  assert.ok(row.warnings.length >= 2);
  assert.equal(r.summary.valid, true);
});

test('Orden parcial (sin tabla legible): se relaciona por SAP/OC y se omite la comparación de subtotal', () => {
  const b = batch();
  b.orders[0] = { ...b.orders[0], partial: true, lines: [], totalCents: NaN };
  const r = matchDocuments(b);
  const row = r.rows.find((x) => x.sap === 'AL204391');
  assert.equal(row.status, 'ok');
  assert.ok(row.warnings.some((w) => /omitió/.test(w)));
});

test('Notas de catálogo de la orden no bloquean el proceso 2', () => {
  const b = batch();
  const r = matchDocuments({ ...b, orderNotes: new Map([['AL204391', ['producto desconocido']]]) });
  assert.equal(r.rows.find((x) => x.sap === 'AL204391').status, 'ok');
  assert.equal(r.summary.valid, true);
});
