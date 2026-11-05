/**
 * Motor de MATCHING de expedientes.
 *
 * REGLA FUNDAMENTAL: la prevalidación es el documento puente. Nunca se relaciona por
 * posición de página ni por importes iguales.
 *
 *   ORDEN (SAP, OC) ──► PREVALIDACIÓN (PEDIDO = SAP; REFERENCIA = nº factura)
 *                          └──► FACTURA (número exacto) ──► se comprueba SAP, OC y totales
 *
 * Estados: ok, missing_invoice, missing_preval, missing_order, total_mismatch,
 *          duplicate, ambiguous, inconsistent.
 */
import { CONFIG } from './config.js';
import { normId, formatCents } from './text-utils.js';
import { orderAmounts, describePage } from './validations.js';

export const STATUS = {
  ok: { label: 'Correcto', tone: 'ok' },
  missing_invoice: { label: 'Falta factura', tone: 'error' },
  missing_preval: { label: 'Falta prevalidación', tone: 'error' },
  missing_order: { label: 'Falta orden', tone: 'error' },
  total_mismatch: { label: 'Total diferente', tone: 'error' },
  duplicate: { label: 'Duplicado', tone: 'error' },
  ambiguous: { label: 'Ambiguo', tone: 'error' },
  inconsistent: { label: 'Datos inconsistentes', tone: 'error' },
  invalid: { label: 'Documento con errores', tone: 'error' },
};
const PRIORITY = ['duplicate', 'ambiguous', 'invalid', 'missing_preval', 'missing_invoice', 'missing_order', 'inconsistent', 'total_mismatch'];

const groupBy = (arr, key) => {
  const m = new Map();
  for (const x of arr) {
    const k = key(x);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

/**
 * @param {{orders:Array, invoices:Array, prevals:Array, orderErrors?:Map, ivaPercent?:number}} input
 *   orders/invoices/prevals: registros interpretados (con .page)
 *   orderNotes: Map sap -> [mensajes] informativos de la orden (catálogo, precios…); no bloquean
 */
export function matchDocuments({ orders, invoices, prevals, orderNotes = new Map(), ivaPercent = CONFIG.tax.ivaPercent }) {
  const ordersBySap = groupBy(orders, (o) => normId(o.sap));
  const invByNumber = groupBy(invoices, (i) => normId(i.number));
  const invBySap = groupBy(invoices, (i) => normId(i.sap));
  const preBySap = groupBy(prevals, (p) => normId(p.sap));
  const preByInvoice = groupBy(prevals, (p) => normId(p.invoiceNumber));

  const rows = [];
  const usedInvoices = new Set();
  const usedPrevals = new Set();
  const seenOrderSaps = new Set();

  for (const order of orders) {
    const sap = normId(order.sap);
    const row = { key: `o:${sap}:${order.page.fileId}:${order.page.pageIndex}`, sap: order.sap, oc: order.oc, store: order.store, order, invoice: null, preval: null, issues: [], warnings: [], checks: [], codes: new Set() };
    const amounts = orderAmounts(order.lines, ivaPercent);
    row.amounts = amounts;
    rows.push(row);

    if (seenOrderSaps.has(sap)) {
      row.codes.add('duplicate');
      row.issues.push(`La orden ${order.sap} está repetida (${ordersBySap.get(sap).map((o) => describePage(o.page)).join('; ')}). Quite el archivo duplicado.`);
      continue;
    }
    seenOrderSaps.add(sap);
    if ((ordersBySap.get(sap) || []).length > 1) {
      row.codes.add('duplicate');
      row.issues.push(`La orden ${order.sap} aparece ${ordersBySap.get(sap).length} veces (${ordersBySap.get(sap).map((o) => describePage(o.page)).join('; ')}).`);
    }
    // Las reglas de catálogo/precios son del proceso 1: aquí solo se informan (no impiden armar el expediente).
    for (const e of orderNotes.get(order.sap) || []) row.warnings.push(e);

    // 1) Prevalidación por PEDIDO = SAP
    const pres = preBySap.get(sap) || [];
    if (pres.length === 0) {
      row.codes.add('missing_preval');
      row.issues.push(`No se encontró la prevalidación del pedido ${order.sap}.`);
      const candidates = invBySap.get(sap) || [];
      if (candidates.length) {
        row.issues.push(`Hay una factura con SAP ${order.sap} (${candidates.map((c) => c.number).join(', ')}), pero sin prevalidación no se relaciona automáticamente.`);
        candidates.forEach((c) => usedInvoices.add(c)); // se informa aquí; no se duplica como fila aparte
      }
      continue;
    }
    if (pres.length > 1) {
      const refs = [...new Set(pres.map((p) => p.invoiceNumber))];
      row.codes.add(refs.length > 1 ? 'ambiguous' : 'duplicate');
      row.issues.push(refs.length > 1
        ? `El pedido ${order.sap} tiene ${pres.length} prevalidaciones con facturas distintas (${refs.join(', ')}). No se puede decidir cuál es la correcta.`
        : `La prevalidación del pedido ${order.sap} está repetida (${pres.map((p) => describePage(p.page)).join('; ')}).`);
      pres.forEach((p) => usedPrevals.add(p));
      continue;
    }
    const pre = pres[0];
    row.preval = pre;
    usedPrevals.add(pre);
    row.invoiceNumber = pre.invoiceNumber;
    row.checks.push({ ok: true, text: `Prevalidación encontrada: PEDIDO ${pre.sap} → REFERENCIA ${pre.invoiceNumber}` });

    const preSameInvoice = preByInvoice.get(normId(pre.invoiceNumber)) || [];
    if (preSameInvoice.length > 1) {
      row.codes.add('ambiguous');
      row.issues.push(`La factura ${pre.invoiceNumber} está referenciada por varias prevalidaciones (${preSameInvoice.map((p) => p.sap).join(', ')}).`);
    }

    // 2) Factura por número exacto de REFERENCIA
    const invs = invByNumber.get(normId(pre.invoiceNumber)) || [];
    if (invs.length === 0) {
      row.codes.add('missing_invoice');
      row.issues.push(`No se encontró la factura ${pre.invoiceNumber} correspondiente al pedido ${order.sap}.`);
      continue;
    }
    if (invs.length > 1) {
      row.codes.add('duplicate');
      row.issues.push(`La factura ${pre.invoiceNumber} aparece ${invs.length} veces (${invs.map((i) => describePage(i.page)).join('; ')}).`);
      invs.forEach((i) => usedInvoices.add(i));
      continue;
    }
    const inv = invs[0];
    row.invoice = inv;
    usedInvoices.add(inv);
    row.checks.push({ ok: true, text: `Factura encontrada: ${inv.number}` });

    // 3) Coherencia de identificadores
    if (normId(inv.sap) !== sap) { row.codes.add('inconsistent'); row.issues.push(`La factura ${inv.number} indica SAP ${inv.sap}, pero la prevalidación y la orden son del pedido ${order.sap}.`); }
    else row.checks.push({ ok: true, text: `SAP de la factura = ${order.sap}` });
    if (normId(inv.oc) !== normId(order.oc)) { row.codes.add('inconsistent'); row.issues.push(`La factura ${inv.number} indica OC ${inv.oc}, pero la orden tiene OC ${order.oc}.`); }
    else row.checks.push({ ok: true, text: `OC de la factura = ${order.oc}` });
    const otherInvSameSap = (invBySap.get(sap) || []).filter((i) => i !== inv);
    if (otherInvSameSap.length) {
      row.codes.add('ambiguous');
      row.issues.push(`Además de ${inv.number}, existe otra factura para el SAP ${order.sap}: ${otherInvSameSap.map((i) => i.number).join(', ')}.`);
      otherInvSameSap.forEach((i) => usedInvoices.add(i));
    }
    // Observación (no bloquea): la relación ya está confirmada por número de factura, SAP y OC.
    if (inv.accessKey && pre.accessKey && inv.accessKey !== pre.accessKey) {
      row.warnings.push(`La clave de acceso de la factura ${inv.number} no coincide con la CLAVE de la prevalidación. Revísalo si lo consideras necesario.`);
    }

    // 4) Importes
    if (order.partial) {
      row.warnings.push(`No se pudo leer la tabla de productos de la orden ${order.sap}; se omitió la comparación de subtotal e IVA con la orden.`);
    } else if (inv.subtotalCents !== amounts.subtotalCents) {
      row.codes.add('total_mismatch');
      row.issues.push(`Subtotal de la factura ${formatCents(inv.subtotalCents)} distinto del total de la orden ${formatCents(amounts.subtotalCents)}.`);
    } else row.checks.push({ ok: true, text: `Subtotal ${formatCents(inv.subtotalCents)} = total de la orden` });
    const ivaOk = order.partial || inv.ivaCents === amounts.ivaCents || inv.ivaCents === amounts.ivaPerLineCents;
    if (Number.isFinite(inv.ivaCents) && !ivaOk) {
      row.codes.add('total_mismatch');
      row.issues.push(`IVA de la factura ${formatCents(inv.ivaCents)} distinto del IVA ${ivaPercent} % calculado ${formatCents(amounts.ivaCents)}.`);
    } else if (Number.isFinite(inv.ivaCents) && !order.partial) row.checks.push({ ok: true, text: `IVA ${ivaPercent} % ${formatCents(inv.ivaCents)} correcto` });
    if (inv.subtotalCents + (Number.isFinite(inv.ivaCents) ? inv.ivaCents : 0) !== inv.totalCents && Number.isFinite(inv.ivaCents)) {
      row.codes.add('total_mismatch');
      row.issues.push(`En la factura ${inv.number}, Subtotal + IVA no es igual al Total.`);
    }
    if (inv.totalCents !== pre.totalCents) {
      row.codes.add('total_mismatch');
      row.issues.push(`Total de la factura ${formatCents(inv.totalCents)} distinto del total de la prevalidación ${formatCents(pre.totalCents)}.`);
    } else row.checks.push({ ok: true, text: `Total factura = total prevalidación = ${formatCents(inv.totalCents)}` });

    // 5) Observaciones informativas (no bloquean el armado del expediente)
    const lineMsg = order.partial ? '' : compareLines(order.lines, inv.lines, 'factura');
    if (lineMsg) row.warnings.push(lineMsg);
    else if (inv.lines?.length) row.checks.push({ ok: true, text: 'Productos y cantidades de la factura = orden' });
    const preMsg = order.partial ? '' : compareLines(order.lines, pre.lines, 'prevalidación');
    if (preMsg) row.warnings.push(preMsg);
    else if (pre.lines?.length) row.checks.push({ ok: true, text: 'Productos y cantidades de la prevalidación = orden' });
    if (inv.pageOf && inv.pageOf.total > 1) row.warnings.push(`La factura ${inv.number} indica ${inv.pageOf.total} páginas; en el expediente se usa la página cargada.`);
  }

  // Documentos sin orden
  for (const pre of prevals) {
    if (usedPrevals.has(pre)) continue;
    const sap = normId(pre.sap);
    const inv = (invByNumber.get(normId(pre.invoiceNumber)) || [])[0] || null;
    if (inv) usedInvoices.add(inv);
    const row = { key: `p:${sap}:${pre.page.fileId}:${pre.page.pageIndex}`, sap: pre.sap, oc: inv ? inv.oc : '', store: pre.store, order: null, invoice: inv, preval: pre, invoiceNumber: pre.invoiceNumber, issues: [], warnings: [], checks: [], codes: new Set() };
    if (ordersBySap.has(sap)) {
      row.codes.add('duplicate');
      row.issues.push(`Prevalidación adicional para el pedido ${pre.sap} (${describePage(pre.page)}).`);
    } else {
      row.codes.add('missing_order');
      row.issues.push(`La prevalidación del pedido ${pre.sap} (factura ${pre.invoiceNumber}) no tiene una orden de compra cargada.`);
    }
    rows.push(row);
  }
  for (const inv of invoices) {
    if (usedInvoices.has(inv)) continue;
    const sap = normId(inv.sap);
    const row = { key: `i:${inv.number}:${inv.page.fileId}:${inv.page.pageIndex}`, sap: inv.sap, oc: inv.oc, store: inv.store, order: null, invoice: inv, preval: null, invoiceNumber: inv.number, issues: [], warnings: [], checks: [], codes: new Set() };
    if (!ordersBySap.has(sap)) {
      row.codes.add('missing_order');
      row.issues.push(`La factura ${inv.number} (SAP ${inv.sap}) no tiene una orden de compra cargada.`);
    } else {
      row.codes.add('ambiguous');
      row.issues.push(`La factura ${inv.number} (SAP ${inv.sap}) no está referenciada por ninguna prevalidación.`);
    }
    rows.push(row);
  }

  for (const r of rows) {
    r.status = r.codes.size ? PRIORITY.find((c) => r.codes.has(c)) || [...r.codes][0] : 'ok';
    r.statusLabel = STATUS[r.status].label;
    r.ok = r.status === 'ok';
  }
  const okRows = rows.filter((r) => r.ok);
  const summary = {
    orders: orders.length,
    invoices: invoices.length,
    prevals: prevals.length,
    matched: okRows.length,
    errors: rows.filter((r) => !r.ok).length,
    missing: rows.filter((r) => ['missing_invoice', 'missing_preval', 'missing_order'].includes(r.status)).length,
    pages: okRows.length * CONFIG.dossier.pagesPerOrder,
  };
  summary.valid = rows.length > 0 && summary.errors === 0 && okRows.length === orders.length && orders.length === invoices.length && orders.length === prevals.length;
  if (!summary.valid && summary.errors === 0 && rows.length > 0) {
    summary.countMismatch = `Cantidades distintas: ${orders.length} órdenes, ${invoices.length} facturas y ${prevals.length} prevalidaciones.`;
  }
  return { rows, summary };
}

function compareLines(orderLines, docLines, label) {
  if (!docLines || !docLines.length) return '';
  const key = (l) => `${l.ean}|${l.qty}|${l.priceCents}`;
  const a = orderLines.map(key).sort().join(',');
  const b = docLines.map(key).sort().join(',');
  if (a === b) return '';
  const fmt = (ls) => ls.map((l) => `${l.ean} × ${l.qty} @ ${(l.priceCents / 100).toFixed(2)}`).join('; ');
  return `Los productos de la ${label} no coinciden con la orden. Orden: ${fmt(orderLines)}. ${label[0].toUpperCase() + label.slice(1)}: ${fmt(docLines)}.`;
}

/** Ordena las filas válidas según la opción elegida (el matching no depende de esto). */
export function sortRows(rows, mode) {
  const list = [...rows];
  if (mode === 'sap') list.sort((a, b) => a.sap.localeCompare(b.sap));
  else if (mode === 'invoice') list.sort((a, b) => (a.invoiceNumber || '').localeCompare(b.invoiceNumber || ''));
  return list; // 'orders': orden de carga de las órdenes
}
