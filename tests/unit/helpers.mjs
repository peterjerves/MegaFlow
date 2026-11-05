/** Constructores de registros mínimos para pruebas unitarias (datos ficticios). */
import { CATALOG } from '../../js/config.js';

let n = 0;
export const ref = (file = 'x.pdf', page = 1) => ({ fileId: file, fileName: file, pageIndex: page - 1, pageNumber: page });
export function line(size, qty, over = {}) {
  const p = CATALOG.bySize.get(size);
  const priceCents = Math.round(p.price * 100);
  return { rowNo: ++n, ean: p.ean, eanValid: true, coralCode: p.coralCode, description: `PADS TALLA ${size}`, sizeFromDescription: size, product: p, size, qty, priceCents, totalCents: qty * priceCents, parseErrors: [], ...over };
}
export function order(sap, oc, lines, over = {}) {
  return { type: 'order', sap, oc, store: `TIENDA CORAL ${sap}`, lines, totalCents: lines.reduce((s, l) => s + l.totalCents, 0), shipDate: '2026-10-30', page: ref('ordenes.pdf', ++n), ...over };
}
export function invoiceFor(o, number, over = {}) {
  const sub = o.lines.reduce((s, l) => s + l.totalCents, 0);
  const iva = Math.round((sub * 15) / 100);
  return { type: 'invoice', number, sap: o.sap, oc: o.oc, store: o.store, lines: o.lines.map((l) => ({ ean: l.ean, qty: l.qty, priceCents: l.priceCents, totalCents: l.totalCents })), subtotalCents: sub, ivaCents: iva, totalCents: sub + iva, accessKey: '', pageOf: { n: 1, total: 1 }, page: ref('facturas.pdf', ++n), ...over };
}
export function prevalFor(o, number, over = {}) {
  const sub = o.lines.reduce((s, l) => s + l.totalCents, 0);
  return { type: 'prevalidation', sap: o.sap, invoiceNumber: number, store: o.store, totalCents: sub + Math.round((sub * 15) / 100), lines: [], accessKey: '', page: ref('preval.pdf', ++n), ...over };
}
export const SETTINGS = { customer: 'Gerardo Ortiz e Hijos Cia. Ltda.', invoiceDate: '2026-11-01', dueMode: 'months3', dueDate: '2027-02-01', journal: 'Ventas 001-001', account: '410101 Venta de bienes', taxId: 5, ivaPercent: 15, paymentTerms: '' };
