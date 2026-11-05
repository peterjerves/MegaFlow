/**
 * Clasificación de páginas y despacho al parser correspondiente.
 * Hay TRES parsers distintos (órdenes, facturas, prevalidaciones); este módulo solo
 * detecta qué tipo de documento es cada página para dar mensajes claros si el usuario
 * colocó un archivo en el área equivocada.
 */
import { CONFIG } from './config.js';
import { looksLikeCoralOrder, parseCoralOrder, pageRef } from './coral-parser.js';
import { looksLikeInvoice, parseInvoice } from './invoice-parser.js';
import { looksLikePrevalidation, parsePrevalidation } from './prevalidation-parser.js';

export const TYPE_LABEL = { order: 'una orden de compra', invoice: 'una factura', prevalidation: 'una prevalidación' };

export function detectType(page) {
  if (looksLikePrevalidation(page)) return 'prevalidation';
  if (looksLikeInvoice(page)) return 'invoice';
  if (looksLikeCoralOrder(page)) return 'order';
  return null;
}

/**
 * @returns {{ok:boolean, kind:string, type:string|null, detectedLabel?:string, record?:object, error?:string, page:object}}
 */
export function classifyAndParse(page, expected) {
  const ref = pageRef(page);
  if (page.charCount < CONFIG.limits.minTextChars) {
    return { ok: false, kind: 'scanned', type: null, page: ref, error: 'Este documento parece escaneado y no contiene texto seleccionable.' };
  }
  const type = detectType(page);
  if (!type) {
    return { ok: false, kind: 'unknown', type: null, page: ref, error: `La página no se reconoce como ${TYPE_LABEL[expected]}.` };
  }
  if (type !== expected) {
    return { ok: false, kind: 'wrong-type', type, detectedLabel: TYPE_LABEL[type].replace(/^una? /, ''), page: ref, error: `La página parece ${TYPE_LABEL[type]}, no ${TYPE_LABEL[expected]}. Revisa que el archivo esté en el área correcta.` };
  }
  const res = type === 'order' ? parseCoralOrder(page) : type === 'invoice' ? parseInvoice(page) : parsePrevalidation(page);
  if (!res.ok) return { ok: false, kind: 'parse-error', type, page: ref, error: res.error, partial: res.partial };
  const record = res.order || res.invoice || res.prevalidation;
  return { ok: true, kind: 'ok', type, record, page: ref };
}
