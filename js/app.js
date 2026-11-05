/**
 * MegaFlow — arranque de la aplicación.
 *
 * La interfaz (carga de archivos, arrastrar y soltar, pestañas, tema) se inicializa
 * de inmediato con módulos locales. Las librerías pesadas (PDF.js, pdf-lib, ExcelJS)
 * se cargan desde vendor/ solo cuando se necesitan; si alguna falla, se informa sin
 * bloquear el resto de la aplicación.
 *
 * Privacidad: los documentos viven solo en memoria (File / ArrayBuffer / Blob).
 * No hay llamadas a servidores ni almacenamiento persistente de documentos.
 */
import { CONFIG } from './config.js';
import { hydrateIcons } from './icons.js';
import { $, log, toast, initTheme, initTabs, initDialog, diagnosticsText, copyText } from './ui.js';
import { FileZone } from './file-manager.js';
import { bindUploadZone, guardWindowDrops } from './upload-ui.js';
import { initInvoicesProcess } from './process-invoices.js';
import { initDossiersProcess } from './process-dossiers.js';

function start() {
  // Errores globales: nunca se silencian.
  window.addEventListener('error', (e) => {
    log('error', `Error de JavaScript: ${e.message}`, e.error || `${e.filename}:${e.lineno}`);
    toast(`Ocurrió un error inesperado (${e.message}). Abre "Diagnóstico" para ver el detalle.`, 'error', 9000);
  });
  window.addEventListener('unhandledrejection', (e) => {
    log('error', 'Promesa rechazada sin control', e.reason);
    toast(`Ocurrió un error inesperado: ${e.reason?.message || e.reason}. Abre "Diagnóstico" para ver el detalle.`, 'error', 9000);
  });

  hydrateIcons();
  initTheme();
  initTabs((id) => log('info', `Pestaña: ${id}`));
  guardWindowDrops();

  const notify = (m) => toast(m, 'warn');
  const p1Orders = new FileZone({ id: 'p1-orders', expected: 'order', label: 'Órdenes (Preparar facturas)', log, notify });
  const p2Orders = new FileZone({ id: 'p2-orders', expected: 'order', label: 'Órdenes de compra', log, notify });
  const p2Invoices = new FileZone({ id: 'p2-invoices', expected: 'invoice', label: 'Facturas', log, notify });
  const p2Prevals = new FileZone({ id: 'p2-prevals', expected: 'prevalidation', label: 'Prevalidaciones', log, notify });

  bindUploadZone(p1Orders, { dropzone: '#dz-p1-orders', input: '#in-p1-orders', list: '#files-p1-orders', counter: '#count-p1-orders' });
  bindUploadZone(p2Orders, { dropzone: '#dz-p2-orders', input: '#in-p2-orders', list: '#files-p2-orders', counter: '#count-p2-orders' });
  bindUploadZone(p2Invoices, { dropzone: '#dz-p2-invoices', input: '#in-p2-invoices', list: '#files-p2-invoices', counter: '#count-p2-invoices' });
  bindUploadZone(p2Prevals, { dropzone: '#dz-p2-prevals', input: '#in-p2-prevals', list: '#files-p2-prevals', counter: '#count-p2-prevals' });

  initInvoicesProcess(p1Orders);
  initDossiersProcess({ orders: p2Orders, invoices: p2Invoices, prevals: p2Prevals }, p1Orders);

  initDialog('#help-btn', '#help-dialog');
  const diag = initDialog('#diag-btn', '#diag-dialog', (dlg) => { dlg.querySelector('pre').textContent = diagnosticsText(); });
  $('#diag-copy').addEventListener('click', async () => {
    const ok = await copyText(diagnosticsText());
    toast(ok ? 'Diagnóstico copiado al portapapeles.' : 'No se pudo copiar. Selecciona el texto manualmente.', ok ? 'ok' : 'warn', 3000);
  });
  void diag;

  // Advertencia al salir si hay documentos cargados (se perderían, no se guardan).
  window.addEventListener('beforeunload', (e) => {
    if ([p1Orders, p2Orders, p2Invoices, p2Prevals].some((z) => z.entries.length)) { e.preventDefault(); e.returnValue = ''; }
  });

  $('#app-version').textContent = `v${CONFIG.app.version}`;
  window.__megaflowReady = true;
  document.documentElement.classList.add('app-ready');
  log('info', `MegaFlow ${CONFIG.app.version} iniciado en ${location.pathname}`);
}

try {
  start();
} catch (err) {
  console.error('[MegaFlow] Error de arranque', err);
  const box = document.getElementById('boot-error');
  if (box) {
    box.hidden = false;
    box.querySelector('[data-detail]').textContent = `${err.message}`;
  }
}
