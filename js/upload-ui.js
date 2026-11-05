/**
 * Conexión de un área de carga con la interfaz: arrastrar y soltar, botón
 * "Seleccionar", lista de archivos (nombre, tamaño, páginas, estado) y acciones
 * Eliminar / Reemplazar / Reintentar / Eliminar todos.
 *
 * Cadena completa: seleccionar o soltar → FileZone.add → lectura PDF.js →
 * interpretación → contador de documentos detectados → análisis habilitado.
 */
import { $, h, escapeHtml, icon, toast, log } from './ui.js';
import { formatBytes } from './text-utils.js';

const NOUN = {
  order: ['pedido detectado', 'pedidos detectados'],
  invoice: ['factura detectada', 'facturas detectadas'],
  prevalidation: ['prevalidación detectada', 'prevalidaciones detectadas'],
};

/**
 * @param {import('./file-manager.js').FileZone} zone
 * @param {{dropzone:string, input:string, list:string, counter?:string}} sel
 */
export function bindUploadZone(zone, sel) {
  const dz = $(sel.dropzone);
  const input = $(sel.input);
  const list = $(sel.list);
  const counter = sel.counter ? $(sel.counter) : null;

  // Input oculto adicional para "Reemplazar" (un solo archivo).
  const replaceInput = document.createElement('input');
  replaceInput.type = 'file';
  replaceInput.accept = '.pdf,application/pdf';
  replaceInput.className = 'visually-hidden';
  replaceInput.tabIndex = -1;
  replaceInput.setAttribute('aria-hidden', 'true');
  dz.after(replaceInput);
  let replaceTarget = null;

  const addFiles = (files, opts) => {
    if (!files || !files.length) return;
    const notices = zone.add(files, opts);
    for (const n of notices) toast(n, 'warn');
  };

  // --- Explorador de archivos -------------------------------------------------
  const openPicker = () => { input.value = ''; input.click(); };
  for (const b of dz.querySelectorAll('[data-pick]')) {
    b.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
  }
  dz.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input')) return;
    openPicker();
  });
  dz.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === dz) { e.preventDefault(); openPicker(); }
  });
  input.addEventListener('change', () => {
    const files = [...input.files];
    log('info', `${zone.label}: ${files.length} archivo(s) seleccionados con el explorador`);
    addFiles(files);
    input.value = ''; // permite volver a elegir el mismo archivo después de eliminarlo
  });
  replaceInput.addEventListener('change', () => {
    const f = replaceInput.files[0];
    if (f && replaceTarget) addFiles([f], { replaceId: replaceTarget });
    replaceTarget = null;
    replaceInput.value = '';
  });

  // --- Arrastrar y soltar --------------------------------------------------------
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  dz.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    dz.classList.add('is-over');
  });
  dz.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dz.classList.add('is-over');
  });
  dz.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0 || !dz.contains(e.relatedTarget)) { depth = 0; dz.classList.remove('is-over'); }
  });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    dz.classList.remove('is-over');
    document.body.classList.remove('is-dragging');
    const files = [...(e.dataTransfer?.files || [])];
    log('info', `${zone.label}: ${files.length} archivo(s) soltados`);
    if (!files.length) { toast('No se recibieron archivos. Arrastra archivos PDF desde tu explorador.', 'warn'); return; }
    addFiles(files);
  });

  // --- Lista de archivos ----------------------------------------------------------
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'remove') zone.remove(id);
    else if (action === 'retry') zone.retry(id);
    else if (action === 'replace') { replaceTarget = id; replaceInput.value = ''; replaceInput.click(); }
    else if (action === 'clear') zone.clear();
  });

  const render = () => {
    const s = zone.stats();
    dz.classList.toggle('has-files', s.files > 0);
    if (counter) {
      const [one, many] = NOUN[zone.expected];
      const busy = s.reading > 0;
      counter.innerHTML = s.files === 0
        ? '<span class="muted">Sin archivos</span>'
        : `${busy ? icon('loader-circle', { size: 14, cls: 'spin' }) : (s.errors || s.wrongType || s.scanned || s.failed ? icon('triangle-alert', { size: 14, cls: 'tone-warn' }) : icon('circle-check', { size: 14, cls: 'tone-ok' }))}
           <strong>${s.recognized}</strong> ${s.recognized === 1 ? one : many}${busy ? ' · leyendo…' : ''}`;
    }
    if (!zone.entries.length) { list.innerHTML = ''; return; }
    const head = `<div class="files-head">
        <span>${s.files} archivo${s.files === 1 ? '' : 's'} · ${s.pages} página${s.pages === 1 ? '' : 's'}${s.errors ? ` · <span class="tone-error">${s.errors} con error</span>` : ''}</span>
        <button type="button" class="btn-link danger" data-action="clear">${icon('trash-2', { size: 15 })} Eliminar todos</button>
      </div>`;
    const items = zone.entries.map((e) => {
      const st = e.status;
      const recognized = e.docs.filter((d) => d.ok).length;
      let statusHtml = '';
      if (st === 'queued') statusHtml = `<span class="pill">${icon('loader-circle', { size: 13, cls: 'spin' })} En cola</span>`;
      else if (st === 'reading') statusHtml = `<span class="pill">${icon('loader-circle', { size: 13, cls: 'spin' })} Leyendo ${Math.round(e.progress * 100)} %</span>`;
      else if (st === 'error') statusHtml = `<span class="pill pill-error">${icon('circle-x', { size: 13 })} Error</span>`;
      else if (e.warnings.length) statusHtml = `<span class="pill pill-warn">${icon('triangle-alert', { size: 13 })} Revisar</span>`;
      else statusHtml = `<span class="pill pill-ok">${icon('circle-check', { size: 13 })} Listo</span>`;
      const meta = st === 'ready'
        ? `${formatBytes(e.size)} · ${e.pageCount} pág. · ${recognized} reconocida${recognized === 1 ? '' : 's'}`
        : `${formatBytes(e.size)}${e.pageCount ? ` · ${e.pageCount} pág.` : ''}`;
      const msgs = st === 'error'
        ? `<div class="file-msg error">${escapeHtml(e.error)}</div>`
        : e.warnings.map((w) => `<div class="file-msg warn">${escapeHtml(w)}</div>`).join('');
      const retryable = st === 'error' && !['type', 'empty', 'size'].includes(e.errorCode);
      return `<div class="file-row ${st === 'error' ? 'is-error' : ''}" data-file-id="${e.id}">
          <span class="file-ico">${icon('file-text', { size: 18 })}</span>
          <div class="file-main">
            <div class="file-name" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</div>
            <div class="file-meta">${meta} ${statusHtml}</div>
            ${st === 'reading' ? `<div class="mini-track"><div class="mini-bar" style="width:${Math.round(e.progress * 100)}%"></div></div>` : ''}
            ${msgs}
          </div>
          <div class="file-actions">
            ${retryable ? `<button type="button" class="icon-btn sm" data-action="retry" data-id="${e.id}" title="Reintentar lectura" aria-label="Reintentar ${escapeHtml(e.name)}">${icon('rotate-ccw', { size: 16 })}</button>` : ''}
            <button type="button" class="icon-btn sm" data-action="replace" data-id="${e.id}" title="Reemplazar archivo" aria-label="Reemplazar ${escapeHtml(e.name)}">${icon('replace', { size: 16 })}</button>
            <button type="button" class="icon-btn sm danger" data-action="remove" data-id="${e.id}" title="Eliminar archivo" aria-label="Eliminar ${escapeHtml(e.name)}">${icon('x', { size: 16 })}</button>
          </div>
        </div>`;
    }).join('');
    list.innerHTML = head + `<div class="files-body">${items}</div>`;
  };

  let scheduled = false;
  zone.onChange(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  });
  render();
  return { render, openPicker, addFiles };
}

/** Evita que soltar un archivo fuera de un área abra el PDF y borre el trabajo cargado. */
export function guardWindowDrops() {
  let t;
  window.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    if (!e.target.closest?.('.dropzone')) e.dataTransfer.dropEffect = 'none';
    document.body.classList.add('is-dragging');
    clearTimeout(t);
    t = setTimeout(() => document.body.classList.remove('is-dragging'), 300);
  });
  window.addEventListener('drop', (e) => {
    if (e.target.closest?.('.dropzone')) return;
    e.preventDefault();
    document.body.classList.remove('is-dragging');
    if (e.dataTransfer?.files?.length) toast('Suelta los archivos dentro de un área de carga.', 'warn');
  });
}
