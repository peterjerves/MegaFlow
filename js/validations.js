/**
 * Validaciones de negocio (puras, sin DOM).
 *  - validateOrder: catálogo, EAN, cantidades, precios, subtotales y total de cada orden.
 *  - validateSettings: cliente, diario, cuenta, impuesto y fechas para Odoo.
 *  - findDuplicates: identificadores repetidos.
 *  - orderAmounts: subtotal, IVA y total de una orden (centavos).
 */
import { CONFIG, CATALOG } from './config.js';
import { ivaCents, isValidEan13, fromCents, formatCents } from './text-utils.js';
import { isIsoDate } from './dates.js';

/** Importes de una orden: base = suma de líneas; IVA global y por línea. */
export function orderAmounts(lines, ivaPercent = CONFIG.tax.ivaPercent) {
  const subtotalCents = lines.reduce((s, l) => s + (Number.isFinite(l.totalCents) ? l.totalCents : 0), 0);
  const ivaGlobal = ivaCents(subtotalCents, ivaPercent);
  const ivaPerLine = lines.reduce((s, l) => s + ivaCents(Number.isFinite(l.totalCents) ? l.totalCents : 0, ivaPercent), 0);
  return { subtotalCents, ivaCents: ivaGlobal, ivaPerLineCents: ivaPerLine, totalCents: subtotalCents + ivaGlobal };
}

/** Cantidades por talla para el Excel de control (0 si la talla no aparece). */
export function sizeTotals(lines) {
  const out = Object.fromEntries(CONFIG.sizes.map((s) => [s, 0]));
  for (const l of lines) if (l.product && out[l.product.size] !== undefined) out[l.product.size] += l.qty;
  return out;
}

/**
 * Valida una orden ya interpretada. Nunca corrige valores: solo informa.
 * Devuelve { errors:[{cat,msg}], warnings:[string] }. Los mensajes incluyen el SAP.
 * Categorías: sap, oc, store, lines, parse, product, ean, code, size, qty, price, line-total, order-total.
 */
export function validateOrder(order) {
  const errors = [];
  const warnings = [];
  const err = (cat, msg) => errors.push({ cat, msg });
  const id = order.sap || 'orden';
  if (!CONFIG.identifiers.sap.test(order.sap || '')) err('sap', `${id}: el número de orden SAP "${order.sap}" no tiene el formato esperado.`);
  if (!CONFIG.identifiers.oc.test(order.oc || '')) err('oc', `${id}: el pedido de compra (OC) "${order.oc}" no tiene 10 dígitos.`);
  if (!order.store) err('store', `${id}: falta el nombre de la tienda.`);
  if (!order.lines?.length) err('lines', `${id}: la orden no tiene productos.`);
  const seenSizes = new Set();
  for (const l of order.lines || []) {
    const tag = `${id}, línea ${l.rowNo}`;
    for (const e of l.parseErrors || []) err('parse', `${id}: ${e}.`);
    if (l.parseErrors?.length) continue;
    if (!l.product) {
      err('product', `${tag}: producto desconocido (EAN ${l.ean || '—'}, código ${l.coralCode || '—'}). Revise el catálogo en js/config.js antes de continuar.`);
      continue;
    }
    if (!isValidEan13(l.ean)) err('ean', `${tag}: el EAN ${l.ean} no supera la verificación de dígito de control.`);
    if (l.coralCode && l.coralCode !== l.product.coralCode) err('code', `${tag}: el código Coral ${l.coralCode} no corresponde al EAN ${l.ean} (${l.product.coralCode}).`);
    if (l.sizeFromDescription && l.sizeFromDescription !== l.product.size) err('size', `${tag}: la descripción indica talla ${l.sizeFromDescription} pero el EAN corresponde a talla ${l.product.size}.`);
    if (!Number.isInteger(l.qty) || l.qty <= 0) err('qty', `${tag}: cantidad inválida (${l.qty}). Debe ser un entero positivo.`);
    const catalogCents = Math.round(l.product.price * 100);
    if (l.priceCents !== catalogCents) {
      err('price', `${tag}: precio ${fromCents(l.priceCents).toFixed(2)} diferente al catálogo (${l.product.price.toFixed(2)}) para talla ${l.product.size}. No se modifica: revise la orden o el catálogo.`);
    }
    if (Number.isInteger(l.qty) && l.qty * l.priceCents !== l.totalCents) {
      err('line-total', `${tag}: el total de línea ${fromCents(l.totalCents).toFixed(2)} no es igual a ${l.qty} × ${fromCents(l.priceCents).toFixed(2)}.`);
    }
    if (seenSizes.has(l.product.size)) warnings.push(`${id}: la talla ${l.product.size} aparece en más de una línea; se suman en el Excel de control.`);
    seenSizes.add(l.product.size);
  }
  const sum = (order.lines || []).reduce((s, l) => s + (Number.isFinite(l.totalCents) ? l.totalCents : 0), 0);
  if (!Number.isFinite(order.totalCents) || sum !== order.totalCents) {
    err('order-total', `${id}: la suma de las líneas (${formatCents(sum)}) no coincide con el TOTAL de la orden (${formatCents(order.totalCents)}).`);
  }
  if (order.storeNote) warnings.push(`${id}: ${order.storeNote}`);
  return { errors, warnings };
}

/** Busca valores repetidos. Devuelve [{ key, items }] para claves con más de un elemento. */
export function findDuplicates(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.entries()].filter(([, v]) => v.length > 1).map(([key, v]) => ({ key, items: v }));
}

export const describePage = (ref) => (ref ? `${ref.fileName}, pág. ${ref.pageNumber}` : '—');

/** Valida los parámetros de facturación. */
export function validateSettings(s) {
  const errors = [];
  if (!s.customer?.trim()) errors.push('Indica el cliente de Odoo.');
  if (!s.journal?.trim()) errors.push('Indica el diario de ventas.');
  if (!s.account?.trim()) errors.push('Indica la cuenta de ingresos.');
  if (!Number.isInteger(s.taxId) || s.taxId <= 0) errors.push('El ID de impuesto (Database ID) debe ser un número entero positivo.');
  if (/,/.test(String(s.taxId))) errors.push('El impuesto debe indicarse por su ID numérico, no por su nombre.');
  if (!isIsoDate(s.invoiceDate)) errors.push('La fecha de factura no es válida.');
  if (!isIsoDate(s.dueDate)) errors.push(s.dueMode === 'manual' ? 'Indica la fecha de vencimiento manual.' : 'No se pudo calcular la fecha de vencimiento.');
  if (isIsoDate(s.invoiceDate) && isIsoDate(s.dueDate) && s.dueDate < s.invoiceDate) errors.push('La fecha de vencimiento no puede ser anterior a la fecha de factura.');
  if (!Number.isInteger(s.ivaPercent) || s.ivaPercent < 0 || s.ivaPercent > 100) errors.push('El porcentaje de IVA no es válido.');
  return errors;
}

export { CATALOG };
