/**
 * PROCESO 2 — Armado de expedientes (lógica pura, sin DOM).
 * Une los documentos interpretados de las tres áreas, valida las órdenes y ejecuta
 * el motor de matching. Solo se permite generar el PDF si TODO es correcto.
 */
import { CONFIG } from './config.js';
import { validateOrder, describePage } from './validations.js';
import { matchDocuments, sortRows } from './matching-engine.js';
import { dateParts, mostFrequent } from './dates.js';
import { fill } from './text-utils.js';

export function analyzeDossier({ orderDocs, invoiceDocs, preDocs, ivaPercent = CONFIG.tax.ivaPercent }) {
  const pageIssues = [];
  const collect = (docs, label) => {
    const out = [];
    for (const d of docs) {
      if (d.ok) out.push(d.record);
      else pageIssues.push({ area: label, page: d.page, message: `${label} · ${describePage(d.page)}: ${d.error}` });
    }
    return out;
  };
  // Para armar expedientes basta identificar SAP y OC de la orden. Si la tabla de productos no se
  // pudo leer pero SAP y OC sí, la orden se usa igual (con una observación) en lugar de bloquear.
  const orders = [];
  for (const d of orderDocs) {
    if (d.ok) orders.push(d.record);
    else if (d.kind === 'parse-error' && d.partial?.sap && d.partial?.oc) {
      orders.push({ type: 'order', partial: true, sap: d.partial.sap, oc: d.partial.oc, store: d.partial.store || '', lines: [], totalCents: NaN, shipDate: '', page: d.page });
    } else pageIssues.push({ area: 'Órdenes', page: d.page, message: `Órdenes · ${describePage(d.page)}: ${d.error}` });
  }
  const invoices = collect(invoiceDocs, 'Facturas');
  const prevals = collect(preDocs, 'Prevalidaciones');

  const orderNotes = new Map();
  for (const o of orders) {
    if (o.partial) continue;
    const v = validateOrder(o);
    if (v.errors.length) orderNotes.set(o.sap, v.errors.map((e) => e.msg));
  }
  const match = matchDocuments({ orders, invoices, prevals, orderNotes, ivaPercent });
  const canGenerate = match.summary.valid && pageIssues.length === 0;
  return { orders, invoices, prevals, pageIssues, match, canGenerate };
}

export function orderedRows(analysis, mode) {
  return sortRows(analysis.match.rows.filter((r) => r.ok), mode);
}

export function dossierFileName(orders) {
  const p = dateParts(mostFrequent(orders.map((o) => o.shipDate)));
  if (!p) return 'expedientes_coral_A5.pdf';
  return fill(CONFIG.fileNames.dossier, p);
}
