/**
 * Interfaz del PROCESO 1 — Preparar facturas.
 * Órdenes Coral (PDF) → Excel de importación Odoo + Excel de control PedidosCoral.
 */
import { CONFIG } from './config.js';
import { $, h, escapeHtml, icon, toast, log, Progress, setBusy, downloadBlob, nextFrame } from './ui.js';
import { whenIdle, isBusy } from './file-manager.js';
import { analyzeOrders } from './invoice-prep.js';
import { writeOdooWorkbook } from './odoo-export.js';
import { writeControlWorkbook, detailFormula } from './coral-excel-export.js';
import { loadExcelJS } from './lib-loader.js';
import { computeDueDate, todayIso, toDisplay, addDays, addMonths, isIsoDate, dateParts, mostFrequent } from './dates.js';
import { formatCents, fill } from './text-utils.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function initInvoicesProcess(zone) {
  const f = {
    customer: $('#p1-customer'),
    invoiceDate: $('#p1-invoice-date'),
    dueMode: $('#p1-due-mode'),
    dueDate: $('#p1-due-date'),
    dueHint: $('#p1-due-hint'),
    journal: $('#p1-journal'),
    account: $('#p1-account'),
    ivaPercent: $('#p1-iva'),
    ivaView: $('#p1-iva-view'),
    taxId: $('#p1-tax-id'),
    paymentTerms: $('#p1-payment-terms'),
  };
  const runBtn = $('#p1-run');
  const resetBtn = $('#p1-reset');
  const results = $('#p1-results');
  const progress = new Progress($('#p1-progress'));
  let state = { analysis: null, files: null };

  // --- Valores predeterminados desde config.js ---------------------------------
  f.customer.value = CONFIG.customer.odooName;
  f.journal.value = CONFIG.odoo.journal;
  f.account.value = CONFIG.odoo.incomeAccount;
  f.taxId.value = String(CONFIG.odoo.taxDatabaseId);
  f.ivaPercent.value = String(CONFIG.tax.ivaPercent);
  f.paymentTerms.value = CONFIG.odoo.paymentTerms;
  f.invoiceDate.value = todayIso();
  f.dueMode.innerHTML = CONFIG.dueDate.modes.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
  f.dueMode.value = CONFIG.dueDate.defaultMode;

  const refreshDue = () => {
    const manual = f.dueMode.value === 'manual';
    f.dueDate.readOnly = !manual;
    f.dueDate.classList.toggle('is-computed', !manual);
    if (!manual) f.dueDate.value = computeDueDate(f.invoiceDate.value, f.dueMode.value);
    const inv = f.invoiceDate.value;
    if (isIsoDate(inv)) {
      const d90 = toDisplay(addDays(inv, 90));
      const m3 = toDisplay(addMonths(inv, 3));
      f.dueHint.textContent = manual
        ? 'Fecha indicada manualmente: no se recalcula.'
        : `90 días exactos: ${d90} · Tres meses calendario: ${m3}`;
    } else f.dueHint.textContent = '';
    f.ivaView.value = `${f.ivaPercent.value || '—'} %`;
  };
  f.invoiceDate.addEventListener('input', refreshDue);
  f.dueMode.addEventListener('change', refreshDue);
  f.ivaPercent.addEventListener('input', refreshDue);
  refreshDue();

  const settings = () => ({
    customer: f.customer.value.trim(),
    invoiceDate: f.invoiceDate.value,
    dueMode: f.dueMode.value,
    dueDate: f.dueDate.value,
    journal: f.journal.value.trim(),
    account: f.account.value.trim(),
    taxId: Number(f.taxId.value),
    ivaPercent: Number(f.ivaPercent.value),
    paymentTerms: f.paymentTerms.value.trim(),
  });

  // Cambios de configuración o archivos después del análisis invalidan las descargas.
  const invalidate = (why) => {
    if (!state.analysis) return;
    state = { analysis: null, files: null };
    results.innerHTML = `<div class="notice notice-info">${icon('info', { size: 18 })}<span>${escapeHtml(why)} Pulsa <strong>Analizar pedidos</strong> para generar los archivos actualizados.</span></div>`;
    progress.hide();
  };
  for (const el of Object.values(f)) {
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') el.addEventListener('change', () => invalidate('La configuración cambió.'));
  }
  zone.onChange((reason) => { if (reason !== 'progress') invalidate('Los archivos cargados cambiaron.'); });

  resetBtn.addEventListener('click', () => {
    zone.clear();
    state = { analysis: null, files: null };
    results.innerHTML = '';
    progress.hide();
    toast('Proceso reiniciado. Se quitaron las órdenes cargadas.', 'info', 3000);
  });

  runBtn.addEventListener('click', async () => {
    if (runBtn.disabled) return;
    setBusy(runBtn, true, 'Analizando…');
    resetBtn.disabled = true;
    results.innerHTML = '';
    try {
      if (!zone.entries.length) throw new UserError('Primero carga el PDF de órdenes de compra Coral (arrastrándolo o con "Seleccionar PDF").');
      progress.set(0, 0.5, 'Comprobando archivos cargados…');
      // 1-2. Esperar la lectura de archivos (texto ya extraído al agregarlos).
      if (isBusy()) {
        const tick = setInterval(() => {
          const s = zone.stats();
          progress.set(1, s.files ? s.ready / s.files : 0, `Archivos leídos: ${s.ready}/${s.files} · Páginas: ${s.pages}`);
        }, 200);
        try { await whenIdle(); } finally { clearInterval(tick); }
      }
      const s = zone.stats();
      progress.set(1, 1, `Archivos leídos: ${s.ready}/${s.files} · Páginas: ${s.pages}`);
      const bad = zone.entries.filter((e) => e.status === 'error');
      if (bad.length) throw new UserError(`Hay ${bad.length} archivo(s) con errores: ${bad.map((e) => `"${e.name}" (${e.error})`).join('; ')}. Elimínalos o reemplázalos antes de continuar.`);
      await nextFrame();

      // 3. Interpretación (ya realizada por página) y 4. validación.
      const docs = zone.documents();
      progress.set(2, 1, `Páginas: ${docs.length} · Órdenes reconocidas: ${docs.filter((d) => d.ok).length}`);
      await nextFrame();
      const st = settings();
      const analysis = analyzeOrders(docs, st);
      progress.set(3, 1, `Órdenes: ${analysis.totals.orders} · Líneas: ${analysis.totals.lines}`);
      log('info', `Proceso 1: ${analysis.totals.orders} órdenes, ${analysis.problems.length} problemas, bloqueo=${analysis.blocking}`);
      await nextFrame();

      if (analysis.blocking) {
        state = { analysis, files: null };
        renderResults(results, analysis, null);
        progress.error(`Se encontraron ${analysis.problems.length} problema(s). No se generaron archivos incompletos.`);
        return;
      }

      // 6. Generación de los dos Excel (y verificación leyéndolos de nuevo).
      progress.set(5, 0.2, 'Cargando generador de Excel…');
      const ExcelJS = await loadExcelJS();
      progress.set(5, 0.5, 'Generando Excel de importación Odoo…');
      let odooBuf; let controlBuf;
      try {
        odooBuf = await writeOdooWorkbook(ExcelJS, analysis.odoo);
        progress.set(5, 0.75, 'Generando Excel de control PedidosCoral…');
        controlBuf = await writeControlWorkbook(ExcelJS, analysis.orders);
      } catch (err) {
        log('error', 'Error al generar XLSX', err);
        throw new UserError(`Error al generar los archivos Excel: ${err.message}`);
      }
      const verifyErrors = await verifyWorkbooks(ExcelJS, odooBuf, controlBuf, analysis);
      if (verifyErrors.length) {
        analysis.problems.push(...verifyErrors);
        analysis.blocking = true;
        state = { analysis, files: null };
        renderResults(results, analysis, null);
        progress.error('La verificación de los archivos generados falló. No se habilitó la descarga.');
        return;
      }
      const p = dateParts(mostFrequent(analysis.orders.map((o) => o.shipDate))) || dateParts(st.invoiceDate);
      const files = {
        odoo: { blob: new Blob([odooBuf], { type: XLSX_MIME }), name: fill(CONFIG.fileNames.odoo, { fecha: p ? p.compact : 'sin_fecha' }) },
        control: { blob: new Blob([controlBuf], { type: XLSX_MIME }), name: fill(CONFIG.fileNames.control, { fecha: p ? p.compact : 'sin_fecha' }) },
      };
      state = { analysis, files };
      progress.set(6, 1, `Archivos listos: ${files.odoo.name} y ${files.control.name}`);
      renderResults(results, analysis, files);
      toast(`Análisis completo: ${analysis.totals.orders} órdenes. Los dos Excel están listos para descargar.`, 'ok');
    } catch (err) {
      const msg = err instanceof UserError ? err.message : `Error inesperado: ${err.message || err}`;
      if (!(err instanceof UserError)) log('error', 'Proceso 1 — error inesperado', err);
      progress.error(msg);
      results.innerHTML = `<div class="notice notice-error">${icon('circle-x', { size: 18 })}<span>${escapeHtml(msg)}</span></div>`;
    } finally {
      setBusy(runBtn, false);
      resetBtn.disabled = false;
    }
  });

  results.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-download]');
    if (!b || !state.files) return;
    const which = b.dataset.download;
    if (which === 'both') {
      downloadBlob(state.files.odoo.blob, state.files.odoo.name);
      setTimeout(() => downloadBlob(state.files.control.blob, state.files.control.name), 600);
    } else downloadBlob(state.files[which].blob, state.files[which].name);
  });
}

class UserError extends Error {}

/** Relee los XLSX generados y comprueba estructura, fórmulas y tabla. */
async function verifyWorkbooks(ExcelJS, odooBuf, controlBuf, analysis) {
  const errors = [];
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(odooBuf);
    const ws = wb.worksheets[0];
    const header = ws.getRow(1).values.slice(1);
    if (header.join('|') !== CONFIG.odoo.columns.join('|')) errors.push('Excel Odoo: las columnas no coinciden con el formato de importación.');
    if (ws.rowCount - 1 !== analysis.odoo.rows.length) errors.push(`Excel Odoo: ${ws.rowCount - 1} filas escritas, se esperaban ${analysis.odoo.rows.length}.`);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(controlBuf);
    const ws2 = wb2.getWorksheet(CONFIG.controlExcel.sheetName);
    if (!ws2) errors.push('Excel de control: falta la hoja PedidosCoral.');
    else {
      const n = analysis.orders.length;
      if (ws2.rowCount - 1 !== n) errors.push(`Excel de control: ${ws2.rowCount - 1} filas, se esperaban ${n}.`);
      for (let r = 2; r <= n + 1; r++) {
        const v = ws2.getCell(r, 8).value;
        const formula = v && typeof v === 'object' ? v.formula : null;
        if (formula !== detailFormula(r)) errors.push(`Excel de control: la celda H${r} no tiene la fórmula esperada.`);
      }
      const tables = ws2.getTables ? ws2.getTables() : [];
      const names = tables.map((t) => (t.table || t).name);
      if (!names.includes(CONFIG.controlExcel.tableName)) errors.push('Excel de control: no se encontró la tabla PedidosCoral.');
    }
  } catch (err) {
    log('error', 'Verificación de XLSX', err);
    errors.push(`No se pudieron verificar los Excel generados: ${err.message}`);
  }
  return errors;
}

function renderResults(root, a, files) {
  const t = a.totals;
  const cards = [
    ['Órdenes', String(t.orders), `${t.pages} páginas`, 'file-text'],
    ['Facturas a generar', String(t.invoices || (a.blocking ? 0 : t.orders)), 'Borradores en Odoo', 'receipt'],
    ['Productos', String(t.lines), `${t.units} paquetes`, 'layers'],
    ['Subtotal', formatCents(t.subtotalCents), 'Sin IVA', 'hash'],
    [`IVA ${a.ivaPercent} %`, formatCents(t.ivaCents), 'Estimado (Odoo calcula el definitivo)', 'hash'],
    ['Total', formatCents(t.totalCents), 'Con IVA', 'hash'],
  ];
  const statusBanner = a.blocking
    ? `<div class="notice notice-error">${icon('circle-x', { size: 20 })}<div><strong>Descarga bloqueada.</strong> Corrige los problemas indicados y vuelve a analizar. No se generan archivos incompletos.</div></div>`
    : `<div class="notice notice-ok">${icon('circle-check', { size: 20 })}<div><strong>Validación superada.</strong> ${t.orders} órdenes → ${t.orders} facturas independientes. Importa en Odoo con <em>Probar</em> antes de <em>Importar</em>; las facturas quedan en borrador.</div></div>`;
  const problems = a.problems.length
    ? `<div class="issues"><h3>${icon('triangle-alert', { size: 18 })} Diferencias y errores (${a.problems.length})</h3><ul>${a.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>` : '';
  const warnings = a.warnings.length
    ? `<details class="issues warn"><summary>${icon('info', { size: 16 })} Observaciones (${a.warnings.length})</summary><ul>${a.warnings.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></details>` : '';
  const checks = `<details class="checks" ${a.blocking ? 'open' : ''}><summary>${icon('list-checks', { size: 16 })} Validaciones (${a.checks.filter((c) => c.ok).length}/${a.checks.length})</summary>
    <ul>${a.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">${icon(c.ok ? 'circle-check' : 'circle-x', { size: 16 })}<span>${escapeHtml(c.label)}${c.detail ? `<small>${escapeHtml(c.detail)}</small>` : ''}</span></li>`).join('')}</ul></details>`;
  const rows = a.table.map((r) => `<tr class="${r.ok ? '' : 'row-error'}">
      <td class="mono">${escapeHtml(r.sap)}</td><td class="mono">${escapeHtml(r.oc)}</td><td>${escapeHtml(r.store)}</td>
      <td class="num">${r.sizes.M}</td><td class="num">${r.sizes.L}</td><td class="num">${r.sizes.XL}</td>
      <td class="num">${formatCents(r.subtotalCents)}</td><td class="num">${formatCents(r.ivaCents)}</td><td class="num">${formatCents(r.totalCents)}</td>
      <td>${r.ok ? `<span class="pill pill-ok">${icon('circle-check', { size: 13 })} Correcto</span>` : `<span class="pill pill-error" title="${escapeHtml(r.messages.join('\n'))}">${icon('circle-x', { size: 13 })} Revisar</span>`}</td></tr>`).join('');
  const table = a.table.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>SAP</th><th>OC</th><th>Tienda</th><th class="num">M</th><th class="num">L</th><th class="num">XL</th><th class="num">Subtotal</th><th class="num">IVA</th><th class="num">Total</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">${t.orders} órdenes</td><td class="num">${sum(a.table, 'M')}</td><td class="num">${sum(a.table, 'L')}</td><td class="num">${sum(a.table, 'XL')}</td><td class="num">${formatCents(t.subtotalCents)}</td><td class="num">${formatCents(t.ivaCents)}</td><td class="num">${formatCents(t.totalCents)}</td><td></td></tr></tfoot>
    </table></div>` : '';
  const downloads = files ? `<div class="downloads">
      <button type="button" class="btn btn-primary" data-download="odoo">${icon('download', { size: 18 })} Descargar Excel Odoo</button>
      <button type="button" class="btn btn-primary" data-download="control">${icon('download', { size: 18 })} Descargar Excel de control</button>
      <button type="button" class="btn btn-secondary" data-download="both">${icon('files', { size: 18 })} Descargar ambos</button>
      <p class="hint">${escapeHtml(files.odoo.name)} · ${escapeHtml(files.control.name)}. La columna "Detalle pedido" es una fórmula: Excel la calcula al abrir el archivo.</p>
    </div>` : '';
  root.innerHTML = `${statusBanner}
    <div class="stats">${cards.map(([l, v, s, ic]) => `<div class="stat"><span class="stat-ico">${icon(ic, { size: 18 })}</span><div><div class="stat-label">${escapeHtml(l)}</div><div class="stat-value">${escapeHtml(v)}</div><div class="stat-sub">${escapeHtml(s)}</div></div></div>`).join('')}</div>
    ${downloads}${problems}${checks}${warnings}${table}`;
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const sum = (rows, size) => rows.reduce((s, r) => s + r.sizes[size], 0);
