/**
 * Interfaz del PROCESO 2 — Armar expedientes.
 * Órdenes + facturas + prevalidaciones → validación de matching → PDF A5 (4 páginas por pedido).
 * El PDF solo se puede generar después de mostrar el resultado del matching y si no hay errores.
 */
import { CONFIG } from './config.js';
import { $, escapeHtml, icon, toast, log, Progress, setBusy, downloadBlob, nextFrame } from './ui.js';
import { whenIdle, isBusy } from './file-manager.js';
import { analyzeDossier, orderedRows, dossierFileName } from './dossier.js';
import { buildDossierPdf, verifyDossier, roleLabel } from './pdf-builder.js';
import { loadPdfLib, loadPdfjs, pdfjsOptions } from './lib-loader.js';
import { openPdf, readAllPages } from './pdf-reader.js';
import { looksLikeCoralOrder } from './coral-parser.js';
import { looksLikeInvoice } from './invoice-parser.js';
import { looksLikePrevalidation } from './prevalidation-parser.js';
import { formatCents, compact } from './text-utils.js';
import { describePage } from './validations.js';

export function initDossiersProcess({ orders, invoices, prevals }, p1Zone) {
  const runBtn = $('#p2-run');
  const resetBtn = $('#p2-reset');
  const sortSel = $('#p2-sort');
  const results = $('#p2-results');
  const progress = new Progress($('#p2-progress'));
  const reuseBtn = $('#p2-reuse-orders');
  const zones = [orders, invoices, prevals];
  let state = { analysis: null, pdf: null };

  sortSel.value = CONFIG.dossier.defaultSort;

  // Reutilizar las órdenes cargadas en "Preparar facturas" (opcional, nunca obligatorio).
  const refreshReuse = () => { reuseBtn.hidden = !(p1Zone.entries.length && !orders.entries.length); };
  p1Zone.onChange(refreshReuse);
  orders.onChange(refreshReuse);
  refreshReuse();
  reuseBtn.addEventListener('click', () => {
    const files = p1Zone.entries.filter((e) => e.status !== 'error').map((e) => e.file);
    const notices = orders.add(files);
    notices.forEach((n) => toast(n, 'warn'));
    toast(`Se agregaron ${files.length} archivo(s) de órdenes desde "Preparar facturas".`, 'info', 3500);
  });

  const invalidate = (why) => {
    if (!state.analysis) return;
    state = { analysis: null, pdf: null };
    results.innerHTML = `<div class="notice notice-info">${icon('info', { size: 18 })}<span>${escapeHtml(why)} Pulsa <strong>Analizar y relacionar documentos</strong> de nuevo.</span></div>`;
    progress.hide();
  };
  for (const z of zones) z.onChange((reason) => { if (reason !== 'progress') invalidate('Los archivos cargados cambiaron.'); });

  sortSel.addEventListener('change', () => {
    if (!state.analysis) return;
    if (state.pdf) { state.pdf = null; toast('Cambiaste el orden: genera nuevamente el PDF final.', 'info', 3500); }
    render();
  });

  resetBtn.addEventListener('click', () => {
    zones.forEach((z) => z.clear());
    state = { analysis: null, pdf: null };
    results.innerHTML = '';
    progress.hide();
    toast('Proceso reiniciado. Se quitaron todos los documentos cargados.', 'info', 3000);
  });

  runBtn.addEventListener('click', async () => {
    if (runBtn.disabled) return;
    setBusy(runBtn, true, 'Analizando…');
    resetBtn.disabled = true;
    results.innerHTML = '';
    state = { analysis: null, pdf: null };
    try {
      const missing = [[orders, 'órdenes de compra'], [invoices, 'facturas'], [prevals, 'prevalidaciones']].filter(([z]) => !z.entries.length).map(([, l]) => l);
      if (missing.length) throw new UserError(`Falta cargar: ${missing.join(', ')}.`);
      progress.set(0, 0.5, 'Comprobando archivos cargados…');
      if (isBusy()) {
        const tick = setInterval(() => {
          const s = zones.map((z) => z.stats());
          const files = s.reduce((a, x) => a + x.files, 0); const ready = s.reduce((a, x) => a + x.ready + x.errors, 0);
          progress.set(1, files ? ready / files : 0, `Archivos leídos: ${ready}/${files} · Páginas: ${s.reduce((a, x) => a + x.pages, 0)}`);
        }, 200);
        try { await whenIdle(); } finally { clearInterval(tick); }
      }
      const bad = zones.flatMap((z) => z.entries.filter((e) => e.status === 'error').map((e) => `${z.label}: "${e.name}" (${e.error})`));
      if (bad.length) throw new UserError(`Hay archivos con errores. Elimínalos o reemplázalos: ${bad.join('; ')}`);
      const totalPages = zones.reduce((a, z) => a + z.stats().pages, 0);
      progress.set(2, 1, `Páginas interpretadas: ${totalPages}`);
      await nextFrame();
      progress.set(3, 0.5, 'Validando órdenes…');
      await nextFrame();
      const analysis = analyzeDossier({ orderDocs: orders.documents(), invoiceDocs: invoices.documents(), preDocs: prevals.documents() });
      progress.set(4, 1, `Coincidencias: ${analysis.match.summary.matched} · Errores: ${analysis.match.summary.errors + analysis.pageIssues.length}`);
      state.analysis = analysis;
      log('info', `Proceso 2: ${JSON.stringify(analysis.match.summary)} · páginas con problemas: ${analysis.pageIssues.length}`);
      render();
      if (analysis.canGenerate) {
        progress.set(4, 1, `Matching validado: ${analysis.match.summary.matched} expedientes. Revisa la tabla y pulsa "Generar PDF final".`);
      } else {
        progress.error('El matching tiene errores o documentos faltantes. La generación del PDF está bloqueada.');
      }
    } catch (err) {
      const msg = err instanceof UserError ? err.message : `Error inesperado: ${err.message || err}`;
      if (!(err instanceof UserError)) log('error', 'Proceso 2 — error inesperado', err);
      progress.error(msg);
      results.innerHTML = `<div class="notice notice-error">${icon('circle-x', { size: 18 })}<span>${escapeHtml(msg)}</span></div>`;
    } finally {
      setBusy(runBtn, false);
      resetBtn.disabled = false;
    }
  });

  results.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'toggle') {
      const row = t.closest('tr');
      const detail = row.nextElementSibling;
      const open = detail.hidden;
      detail.hidden = !open;
      t.setAttribute('aria-expanded', String(open));
      row.classList.toggle('is-open', open);
    } else if (act === 'only-errors') {
      results.classList.toggle('only-errors', t.checked);
    } else if (act === 'goto') {
      const el = document.querySelector(`[data-file-id="${CSS.escape(t.dataset.file)}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }
    } else if (act === 'generate') {
      await generate(t);
    } else if (act === 'download' && state.pdf) {
      downloadBlob(state.pdf.blob, state.pdf.name);
    }
  });

  async function generate(btn) {
    const a = state.analysis;
    if (!a || !a.canGenerate) { toast('Primero analiza y valida los documentos.', 'warn'); return; }
    setBusy(btn, true, 'Generando PDF…');
    runBtn.disabled = true; resetBtn.disabled = true;
    try {
      const rows = orderedRows(a, sortSel.value);
      const expected = rows.length * CONFIG.dossier.pagesPerOrder;
      progress.set(5, 0.02, 'Cargando pdf-lib…');
      const PDFLib = await loadPdfLib();
      const getBytes = async (fileId) => {
        const entry = zones.map((z) => z.entryById(fileId)).find(Boolean);
        if (!entry) throw new Error('Un archivo de origen ya no está cargado.');
        return new Uint8Array(await entry.file.arrayBuffer());
      };
      let built;
      try {
        built = await buildDossierPdf(PDFLib, rows, getBytes, (done, total) => progress.set(5, 0.05 + 0.6 * (done / total), `Páginas creadas: ${done}/${total}`));
      } catch (err) {
        log('error', 'Error al generar PDF', err);
        if (/encrypt/i.test(err.message)) throw new UserError('Uno de los PDF tiene restricciones de seguridad (cifrado) y no se puede combinar. Guárdalo de nuevo como PDF sin restricciones y reemplázalo.');
        if (/memory|allocation/i.test(err.message)) throw new UserError('Memoria insuficiente para generar el PDF. Cierra otras pestañas o procesa menos pedidos por lote.');
        throw new UserError(`Error al generar el PDF: ${err.message}`);
      }
      // Verificación: se vuelve a leer el PDF generado.
      progress.set(5, 0.7, 'Revisando el PDF generado…');
      const pdfjs = await loadPdfjs();
      const { doc, close } = await openPdf(pdfjs, built.bytes.slice(), pdfjsOptions());
      let pages;
      try {
        pages = await readAllPages(pdfjs, doc, { fileId: 'output', fileName: 'salida.pdf' }, (i, n) => { if (i % 8 === 0) progress.set(5, 0.7 + 0.28 * (i / n), `Verificando página ${i}/${n}`); });
      } finally { await close(); }
      const check = verifyDossier(pages, built.plan, { compact, isInvoice: looksLikeInvoice, isOrder: looksLikeCoralOrder, isPreval: looksLikePrevalidation });
      if (built.pageCount !== expected) check.blocking.unshift(`Cantidad de páginas incorrecta: ${built.pageCount} (esperadas ${expected}).`);
      if (check.blocking.length) {
        log('error', 'Verificación del PDF falló', check.blocking.join('\n'));
        throw new UserError(`El PDF generado no tiene la forma esperada: ${check.blocking.slice(0, 5).join(' ')}`);
      }
      if (check.warnings.length) log('warn', 'Observaciones de la verificación del PDF', check.warnings.join('\n'));
      const name = dossierFileName(a.orders);
      state.pdf = { blob: new Blob([built.bytes], { type: 'application/pdf' }), name, pages: built.pageCount, plan: built.plan, warnings: check.warnings };
      progress.set(6, 1, `PDF listo: ${built.pageCount} páginas A5 (${rows.length} expedientes × 4).`);
      render();
      toast(`PDF generado: ${built.pageCount} páginas A5 (${rows.length} expedientes).`, 'ok');
    } catch (err) {
      const msg = err instanceof UserError ? err.message : `Error inesperado: ${err.message || err}`;
      if (!(err instanceof UserError)) log('error', 'Generación de PDF', err);
      progress.error(msg);
      toast(msg, 'error', 10000);
      setBusy(btn, false);
    } finally {
      runBtn.disabled = false; resetBtn.disabled = false;
    }
  }

  function render() {
    const a = state.analysis;
    if (!a) return;
    results.classList.remove('only-errors');
    const s = a.match.summary;
    const errorsTotal = s.errors + a.pageIssues.length;
    const stats = [
      ['Pedidos', s.orders, 'file-text'], ['Facturas', s.invoices, 'receipt'], ['Prevalidaciones', s.prevals, 'badge-check'],
      ['Coincidencias', s.matched, 'link-2'], ['Errores', errorsTotal, 'triangle-alert'], ['Faltantes', s.missing, 'file-x'],
      ['Páginas finales', a.canGenerate ? s.pages : 0, 'file-stack'],
    ];
    const banner = a.canGenerate
      ? `<div class="notice notice-ok">${icon('circle-check', { size: 20 })}<div><strong>Matching validado.</strong> ${s.matched} pedidos relacionados 1 a 1 por identificadores (prevalidación → factura). ${s.pages} páginas A5 finales.</div></div>`
      : `<div class="notice notice-error">${icon('circle-x', { size: 20 })}<div><strong>Generación bloqueada.</strong> Corrige o reemplaza los archivos indicados y vuelve a analizar. No se genera un PDF incompleto.${s.countMismatch ? ` ${escapeHtml(s.countMismatch)}` : ''}</div></div>`;
    const pageIssues = a.pageIssues.length
      ? `<div class="issues"><h3>${icon('triangle-alert', { size: 18 })} Páginas no reconocidas (${a.pageIssues.length})</h3><ul>${a.pageIssues.map((p) => `<li>${escapeHtml(p.message)} <button type="button" class="btn-link" data-act="goto" data-file="${escapeHtml(p.page.fileId)}">Ver archivo</button></li>`).join('')}</ul></div>` : '';
    const rows = a.canGenerate ? orderedRows(a, sortSel.value) : [...a.match.rows].sort((x, y) => Number(x.ok) - Number(y.ok));
    const body = rows.map((r, i) => {
      const tone = r.ok ? 'pill-ok' : 'pill-error';
      const total = r.invoice ? formatCents(r.invoice.totalCents) : r.preval ? formatCents(r.preval.totalCents) : '—';
      return `<tr class="${r.ok ? 'row-ok' : 'row-error'}">
          <td><button type="button" class="icon-btn sm" data-act="toggle" aria-expanded="false" aria-label="Ver detalle de ${escapeHtml(r.sap)}">${icon('chevron-right', { size: 16 })}</button></td>
          <td class="num muted">${a.canGenerate ? i + 1 : ''}</td>
          <td class="mono">${escapeHtml(r.sap || '—')}</td><td class="mono">${escapeHtml(r.oc || '—')}</td>
          <td class="mono">${escapeHtml(r.invoiceNumber || '—')}</td><td>${escapeHtml(r.store || '—')}</td>
          <td class="num">${total}</td>
          <td><span class="pill ${tone}">${icon(r.ok ? 'circle-check' : 'circle-x', { size: 13 })} ${escapeHtml(r.statusLabel)}</span>${r.warnings?.length ? ` <span class="pill pill-warn" title="${escapeHtml(r.warnings.join('\n'))}">${icon('info', { size: 13 })} ${r.warnings.length}</span>` : ''}</td>
        </tr>
        <tr class="detail-row ${r.ok ? 'row-ok' : 'row-error'}" hidden><td></td><td colspan="7">${detailHtml(r, a)}</td></tr>`;
    }).join('');
    const pdfBlock = state.pdf
      ? `<div class="downloads">
          <button type="button" class="btn btn-primary btn-lg" data-act="download">${icon('download', { size: 18 })} Descargar PDF completo</button>
          <p class="hint">${escapeHtml(state.pdf.name)} · ${state.pdf.pages} páginas A5 vertical · cada página A4 reducida a A5 como al imprimir (factura, copia, orden, prevalidación).</p>
          ${state.pdf.warnings.length ? `<details class="issues warn"><summary>${icon('info', { size: 16 })} Observaciones de la revisión automática (${state.pdf.warnings.length})</summary><ul>${state.pdf.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></details>` : ''}
        </div>`
      : `<div class="downloads">
          <button type="button" class="btn btn-primary btn-lg" data-act="generate" ${a.canGenerate ? '' : 'disabled'}>${icon('file-stack', { size: 18 })} Generar PDF final</button>
          <p class="hint">${a.canGenerate ? `Se crearán ${s.pages} páginas A5: por cada pedido, 1) factura, 2) copia de la factura, 3) orden de compra, 4) prevalidación. Cada página A4 se reduce a A5 como al imprimir.` : 'Disponible cuando todos los documentos estén relacionados correctamente.'}</p>
        </div>`;
    results.innerHTML = `${banner}
      <div class="stats stats-7">${stats.map(([l, v, ic]) => `<div class="stat"><span class="stat-ico">${icon(ic, { size: 18 })}</span><div><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div></div>`).join('')}</div>
      ${pdfBlock}
      ${pageIssues}
      <div class="table-tools"><label class="check"><input type="checkbox" data-act="only-errors"> Mostrar solo errores</label><span class="muted">Pulsa ${icon('chevron-right', { size: 14 })} para revisar los tres documentos de cada pedido.</span></div>
      <div class="table-wrap"><table class="data match-table">
        <thead><tr><th></th><th class="num">#</th><th>Pedido SAP</th><th>OC</th><th>Factura</th><th>Tienda</th><th class="num">Total</th><th>Estado</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  }
}

class UserError extends Error {}

function docCard(title, ic, ref, fields, ok) {
  if (!ref) return `<div class="doc-card missing">${icon(ic, { size: 16 })}<div><strong>${title}</strong><span class="muted">No encontrado</span></div></div>`;
  return `<div class="doc-card ${ok ? '' : 'warn'}">${icon(ic, { size: 16 })}<div><strong>${title}</strong>
    <span class="muted">${escapeHtml(describePage(ref))} <button type="button" class="btn-link" data-act="goto" data-file="${escapeHtml(ref.fileId)}">Ver archivo</button></span>
    <dl>${fields.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl></div></div>`;
}

function detailHtml(r, a) {
  const o = r.order; const p = r.preval; const i = r.invoice;
  const lines = (ls) => (ls || []).map((l) => `${l.product ? l.product.size : l.ean} × ${l.qty}`).join(', ');
  const cards = [
    docCard('Orden de compra', 'file-text', o?.page, o && [['SAP', o.sap], ['OC', o.oc], ['Tienda', o.store], ['Productos', lines(o.lines)], ['Subtotal', formatCents(o.totalCents)]], r.ok),
    docCard('Prevalidación', 'badge-check', p?.page, p && [['PEDIDO', p.sap], ['REFERENCIA', p.invoiceNumber], ['Centro', p.store], ['Total', formatCents(p.totalCents)]], r.ok),
    docCard('Factura', 'receipt', i?.page, i && [['Número', i.number], ['SAP / OC', `${i.sap} / ${i.oc}`], ['Subtotal', formatCents(i.subtotalCents)], ['IVA', Number.isFinite(i.ivaCents) ? formatCents(i.ivaCents) : '—'], ['Total', formatCents(i.totalCents)]], r.ok),
  ].join('');
  const issues = r.issues.length ? `<ul class="detail-issues">${r.issues.map((x) => `<li>${icon('circle-x', { size: 14 })} ${escapeHtml(x)}</li>`).join('')}</ul>` : '';
  const notes = r.warnings?.length ? `<ul class="detail-notes">${r.warnings.map((x) => `<li>${icon('info', { size: 14 })} ${escapeHtml(x)}</li>`).join('')}</ul>` : '';
  const checks = r.checks.length ? `<ul class="detail-checks">${r.checks.map((c) => `<li>${icon('circle-check', { size: 14 })} ${escapeHtml(c.text)}</li>`).join('')}</ul>` : '';
  const plan = r.ok ? `<p class="muted small">Expediente (4 páginas A5): 1) Factura · 2) Copia de la factura · 3) Orden de compra · 4) Prevalidación.</p>` : '';
  return `<div class="detail">${issues}${notes}<div class="doc-cards">${cards}</div>${checks}${plan}</div>`;
}

export { roleLabel };
