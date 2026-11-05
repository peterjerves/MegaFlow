/**
 * PROCESO 1 — Preparación de facturación (lógica pura, sin DOM).
 * Entrada: documentos interpretados del área "Órdenes de compra Coral" + parámetros.
 * Salida: órdenes validadas, lista de comprobaciones, filas Odoo y filas de control.
 * Si hay cualquier error relevante, `blocking` = true y no se permite descargar.
 */
import { CONFIG } from './config.js';
import { validateOrder, validateSettings, findDuplicates, orderAmounts, sizeTotals, describePage } from './validations.js';
import { buildOdooRows, validateOdooRows } from './odoo-export.js';
import { buildControlRows, validateControlRows } from './coral-excel-export.js';

export function analyzeOrders(docs, settings) {
  const pageIssues = [];
  const orders = [];
  for (const d of docs) {
    if (d.ok) orders.push(d.record);
    else pageIssues.push({ page: d.page, message: `${describePage(d.page)}: ${d.error}` });
  }

  const perOrder = new Map(); // order -> {errors, warnings}
  const cats = new Set();
  const warnings = [];
  for (const o of orders) {
    const v = validateOrder(o);
    perOrder.set(o, v);
    v.errors.forEach((e) => cats.add(e.cat));
    warnings.push(...v.warnings);
  }

  const dupSap = findDuplicates(orders, (o) => o.sap);
  const dupOc = findDuplicates(orders, (o) => o.oc);
  const dupMessages = [
    ...dupSap.map((d) => `Pedido duplicado: SAP ${d.key} aparece ${d.items.length} veces (${d.items.map((o) => describePage(o.page)).join('; ')}).`),
    ...dupOc.map((d) => `OC duplicada: ${d.key} aparece en ${d.items.map((o) => o.sap).join(', ')}.`),
  ];
  for (const d of [...dupSap, ...dupOc]) for (const o of d.items) perOrder.get(o).errors.push({ cat: 'dup', msg: `${o.sap}: identificador duplicado.` });

  const settingsErrors = validateSettings(settings);
  const ivaPercent = settings.ivaPercent;

  const orderErrorCount = [...perOrder.values()].reduce((s, v) => s + v.errors.length, 0);
  const cleanOrders = orders.filter((o) => perOrder.get(o).errors.length === 0);

  // Filas finales (solo si todo es válido; se validan sobre la matriz que se escribirá).
  let odoo = null;
  let control = null;
  let odooErrors = [];
  let controlErrors = [];
  const canBuild = orders.length > 0 && orderErrorCount === 0 && pageIssues.length === 0;
  if (canBuild) {
    if (!settingsErrors.length) {
      odoo = buildOdooRows(orders, settings);
      odooErrors = validateOdooRows(odoo, orders, settings);
    }
    control = buildControlRows(orders);
    controlErrors = validateControlRows(control, orders);
  }

  // Totales
  let subtotalCents = 0; let ivaCents = 0; let lineCount = 0; let units = 0;
  const table = orders.map((o) => {
    const a = orderAmounts(o.lines, ivaPercent);
    subtotalCents += a.subtotalCents; ivaCents += a.ivaCents;
    lineCount += o.lines.length; units += o.lines.reduce((s, l) => s + (Number.isFinite(l.qty) ? l.qty : 0), 0);
    const v = perOrder.get(o);
    return { sap: o.sap, oc: o.oc, store: o.store, sizes: sizeTotals(o.lines), ...a, ok: v.errors.length === 0, messages: v.errors.map((e) => e.msg), warnings: v.warnings, page: o.page, order: o };
  });

  const has = (...c) => c.some((x) => cats.has(x));
  const totalPages = docs.length;
  const checks = [
    { id: 'pages', label: 'Todas las páginas procesadas', ok: totalPages > 0 && pageIssues.length === 0 && orders.length === totalPages, detail: `${orders.length} de ${totalPages} páginas reconocidas como órdenes` },
    { id: 'one-invoice', label: 'Una factura independiente por orden', ok: canBuild && (!odoo || odoo.groups.length === orders.length), detail: `${orders.length} órdenes → ${orders.length} facturas` },
    { id: 'lines', label: 'Líneas de producto completas', ok: orders.length > 0 && !has('parse', 'lines'), detail: `${lineCount} líneas` },
    { id: 'ean', label: 'Códigos EAN válidos y en el catálogo', ok: orders.length > 0 && !has('product', 'ean', 'code', 'size') },
    { id: 'qty', label: 'Cantidades enteras (columna Cantidad)', ok: orders.length > 0 && !has('qty', 'parse'), detail: `${units} paquetes` },
    { id: 'price', label: 'Precios unitarios iguales al catálogo', ok: orders.length > 0 && !has('price', 'product') },
    { id: 'line-total', label: 'Subtotal de cada línea = cantidad × precio', ok: orders.length > 0 && !has('line-total', 'parse') },
    { id: 'iva', label: `IVA ${ivaPercent} % con redondeo a centavos`, ok: orders.length > 0 && Number.isInteger(ivaPercent), detail: `IVA estimado ${(ivaCents / 100).toFixed(2)} (Odoo calcula el definitivo)` },
    { id: 'order-total', label: 'Suma de líneas = TOTAL de cada orden (sin IVA)', ok: orders.length > 0 && !has('order-total') },
    { id: 'note', label: 'Cada factura tiene su nota (tienda, SAP, OC)', ok: !!odoo && !odooErrors.some((e) => /nota/i.test(e)) },
    { id: 'oc', label: 'Número de OC válido', ok: orders.length > 0 && !has('oc') && dupOc.length === 0 },
    { id: 'sap', label: 'Número de orden SAP válido', ok: orders.length > 0 && !has('sap') && dupSap.length === 0 },
    { id: 'settings', label: 'Cliente, diario y cuenta contable', ok: !settingsErrors.some((e) => /cliente|diario|cuenta|impuesto/i.test(e)), detail: `${settings.customer} · ${settings.journal} · ${settings.account}` },
    { id: 'dates', label: 'Fechas de factura y vencimiento', ok: !settingsErrors.some((e) => /fecha|vencimiento/i.test(e)), detail: `${settings.invoiceDate || '—'} → ${settings.dueDate || '—'}` },
    { id: 'dupes', label: 'Sin pedidos duplicados', ok: dupSap.length === 0 && dupOc.length === 0 },
    { id: 'orphans', label: 'Sin líneas huérfanas', ok: !!odoo && !odooErrors.some((e) => /huérfana|cabecera|filas con cliente/i.test(e)) },
    { id: 'odoo-fields', label: 'Campos de Odoo preparados (product / line_note, impuesto por ID)', ok: !!odoo && odooErrors.length === 0, detail: `Impuesto Database ID ${settings.taxId}` },
    { id: 'control', label: 'Excel de control: 8 columnas, una fila por orden', ok: !!control && controlErrors.length === 0 },
  ];

  const blocking = !canBuild || settingsErrors.length > 0 || odooErrors.length > 0 || controlErrors.length > 0;
  const problems = [
    ...pageIssues.map((p) => p.message),
    ...dupMessages,
    ...table.filter((r) => !r.ok).flatMap((r) => r.messages),
    ...settingsErrors,
    ...odooErrors,
    ...controlErrors,
  ];
  if (!docs.length) problems.unshift('No hay órdenes cargadas.');

  return {
    ivaPercent,
    orders,
    cleanOrders,
    table,
    checks,
    problems: [...new Set(problems)],
    warnings: [...new Set(warnings)],
    odoo,
    control,
    blocking,
    totals: { pages: totalPages, orders: orders.length, invoices: odoo ? odoo.groups.length : 0, lines: lineCount, units, subtotalCents, ivaCents, totalCents: subtotalCents + ivaCents },
  };
}

export { CONFIG };
