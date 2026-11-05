/**
 * Utilidades de interfaz: DOM, avisos, progreso, diagnóstico, tema, pestañas y descargas.
 */
import { CONFIG } from './config.js';
import { escapeHtml } from './text-utils.js';
import { icon } from './icons.js';

/** Obtiene un elemento obligatorio; si no existe, falla de forma visible (no silenciosa). */
export function $(sel, root = document) {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Falta el elemento de interfaz "${sel}" en index.html`);
  return el;
}
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export { escapeHtml, icon };

/* ------------------------------------------------------------------ Diagnóstico */
const logs = [];
export function log(level, message, detail) {
  const entry = { t: new Date().toISOString(), level, message: String(message) };
  if (detail) entry.detail = detail instanceof Error ? `${detail.name}: ${detail.message}\n${detail.stack || ''}${detail.cause ? `\nCausa: ${detail.cause.message || detail.cause}` : ''}` : String(detail);
  logs.push(entry);
  if (logs.length > 600) logs.shift();
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn('[MegaFlow]', message, detail || '');
}
export function diagnosticsText() {
  const env = [
    `MegaFlow ${CONFIG.app.version}`,
    `URL: ${location.origin}${location.pathname}`,
    `Navegador: ${navigator.userAgent}`,
    `Idioma: ${navigator.language} · Pantalla: ${screen.width}×${screen.height} · Memoria aprox.: ${navigator.deviceMemory || '?'} GB`,
    `Contexto seguro: ${window.isSecureContext} · Módulos de worker: ${'Worker' in window}`,
    `Fecha: ${new Date().toString()}`,
    '',
    'Registro (sin contenido de documentos):',
  ];
  return env.concat(logs.map((l) => `${l.t} [${l.level.toUpperCase()}] ${l.message}${l.detail ? `\n    ${l.detail.replace(/\n/g, '\n    ')}` : ''}`)).join('\n');
}

/* ------------------------------------------------------------------ Avisos */
export function toast(message, tone = 'info', ms = 6000) {
  const root = document.getElementById('toasts');
  if (!root) { alert(message); return; }
  const ic = tone === 'error' ? 'circle-x' : tone === 'ok' ? 'circle-check' : tone === 'warn' ? 'triangle-alert' : 'info';
  const el = h(`<div class="toast toast-${tone}" role="${tone === 'error' ? 'alert' : 'status'}">${icon(ic, { size: 18 })}<span>${escapeHtml(message)}</span><button type="button" class="toast-close" aria-label="Cerrar aviso">${icon('x', { size: 16 })}</button></div>`);
  el.querySelector('.toast-close').addEventListener('click', () => el.remove());
  root.append(el);
  if (ms) setTimeout(() => el.remove(), ms);
}

/* ------------------------------------------------------------------ Progreso */
export const STAGES = ['Cargando archivos', 'Extrayendo texto', 'Interpretando documentos', 'Validando registros', 'Relacionando documentos', 'Generando archivo', 'Finalizado'];

export class Progress {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div class="progress-head"><span class="progress-stage">—</span><span class="progress-pct">0 %</span></div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-bar"></div></div>
      <div class="progress-meta"></div>`;
    this.bar = root.querySelector('.progress-bar');
    this.track = root.querySelector('.progress-track');
    this.stage = root.querySelector('.progress-stage');
    this.pct = root.querySelector('.progress-pct');
    this.meta = root.querySelector('.progress-meta');
    this.hide();
  }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  set(stageIndex, fraction, meta = '') {
    this.show();
    const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    this.stage.textContent = `${Math.min(stageIndex + 1, STAGES.length)}/${STAGES.length} · ${STAGES[stageIndex] || ''}`;
    this.pct.textContent = `${pct} %`;
    this.bar.style.width = `${pct}%`;
    this.track.setAttribute('aria-valuenow', String(pct));
    this.meta.textContent = meta;
    this.root.classList.toggle('is-done', stageIndex === STAGES.length - 1);
    this.root.classList.remove('is-error');
  }
  error(message) {
    this.show();
    this.root.classList.add('is-error');
    this.stage.textContent = 'Proceso detenido';
    this.meta.textContent = message;
  }
}

/** Cede el hilo principal para que la interfaz se actualice. */
export const nextFrame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));

/* ------------------------------------------------------------------ Botones ocupados */
export function setBusy(button, busy, busyText = 'Procesando…') {
  if (busy) {
    if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `${icon('loader-circle', { size: 18, cls: 'spin' })}<span>${escapeHtml(busyText)}</span>`;
  } else {
    button.removeAttribute('aria-busy');
    if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
    delete button.dataset.idleHtml;
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ Descargas */
export function downloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    log('info', `Descarga iniciada: ${filename} (${blob.size} bytes)`);
    return true;
  } catch (err) {
    log('error', `Descarga fallida: ${filename}`, err);
    toast(`No se pudo iniciar la descarga de ${filename}. Revisa los permisos de descarga del navegador.`, 'error');
    return false;
  }
}

/* ------------------------------------------------------------------ Tema */
export function initTheme() {
  const btn = $('#theme-toggle');
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    btn.setAttribute('aria-checked', String(theme === 'dark'));
    btn.title = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#11151D' : '#F6F8FC';
  };
  apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(CONFIG.themeStorageKey, next); } catch { /* almacenamiento no disponible: el tema igual cambia */ }
    log('info', `Tema cambiado a ${next}`);
  });
}

/* ------------------------------------------------------------------ Pestañas */
export function initTabs(onChange) {
  const tabs = $$('[role="tab"]');
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('is-active', on);
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
    if (focus) tab.focus();
    onChange?.(tab.id);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        select(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
      }
    });
  });
}

/* ------------------------------------------------------------------ Diálogos */
export function initDialog(openBtnSel, dialogSel, onOpen) {
  const dlg = $(dialogSel);
  $(openBtnSel).addEventListener('click', () => {
    onOpen?.(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  });
  for (const b of $$('[data-close]', dlg)) b.addEventListener('click', () => (dlg.close ? dlg.close() : dlg.removeAttribute('open')));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close?.(); });
  return dlg;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
