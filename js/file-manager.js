/**
 * Gestión de archivos por área de carga (en memoria, nunca se suben ni se guardan).
 *
 * Cada área (FileZone) mantiene objetos File y, tras leerlos con PDF.js, los modelos
 * de texto de cada página y su interpretación. Así el análisis no reprocesa archivos
 * que no cambiaron. Al cerrar o recargar la página todo desaparece.
 *
 * Validaciones al agregar: extensión/tipo PDF, archivo vacío, tamaño máximo, firma %PDF,
 * duplicado (nombre+tamaño+fecha y huella SHA-256 del contenido), PDF dañado,
 * PDF con contraseña, páginas sin texto (escaneadas) y tipo de documento detectado.
 */
import { CONFIG } from './config.js';
import { loadPdfjs, pdfjsOptions } from './lib-loader.js';
import { openPdf, readAllPages, PdfReadError } from './pdf-reader.js';
import { classifyAndParse } from './documents.js';

let seq = 0;
const newId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Cola global: los archivos se leen de uno en uno para no saturar memoria ni CPU. */
const queue = [];
let running = false;
const idleWaiters = new Set();

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try { await job(); } catch (err) { console.error('[MegaFlow] Error en cola de lectura', err); }
  }
  running = false;
  for (const w of idleWaiters) w();
  idleWaiters.clear();
}
export function whenIdle() {
  if (!running && !queue.length) return Promise.resolve();
  return new Promise((res) => idleWaiters.add(res));
}
export const isBusy = () => running || queue.length > 0;

export class FileZone {
  /**
   * @param {{id:string, expected:'order'|'invoice'|'prevalidation', label:string, log:Function}} opts
   */
  constructor({ id, expected, label, log, notify }) {
    this.id = id;
    this.expected = expected;
    this.label = label;
    this.log = log || (() => {});
    this.notify = notify || (() => {});
    this.entries = [];
    this.listeners = new Set();
    this.version = 0; // cambia con cada modificación (invalida resultados previos)
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason) {
    this.version++;
    for (const fn of this.listeners) {
      try { fn(reason); } catch (err) { console.error('[MegaFlow] listener', err); }
    }
  }

  /** Agrega archivos (desde explorador o arrastrar). Devuelve avisos para el usuario. */
  add(fileList, { replaceId = null } = {}) {
    const notices = [];
    const files = [...(fileList || [])];
    for (const file of files) {
      const dup = this.entries.find((e) => e.name === file.name && e.size === file.size && e.lastModified === file.lastModified && e.id !== replaceId);
      if (dup) { notices.push(`"${file.name}" ya estaba cargado en ${this.label}; no se agregó de nuevo.`); continue; }
      const entry = {
        id: newId(), file, name: file.name, size: file.size, lastModified: file.lastModified,
        status: 'queued', error: '', errorCode: '', warnings: [], pageCount: 0, pages: [], docs: [], progress: 0, hash: '', encrypted: false,
      };
      const isPdfName = /\.pdf$/i.test(file.name);
      const isPdfType = file.type === 'application/pdf' || file.type === 'application/x-pdf';
      if (!isPdfName && !isPdfType) {
        entry.status = 'error'; entry.errorCode = 'type';
        entry.error = 'No es un archivo PDF. Solo se aceptan documentos .pdf.';
      } else if (file.size === 0) {
        entry.status = 'error'; entry.errorCode = 'empty'; entry.error = 'El archivo está vacío (0 bytes).';
      } else if (file.size > CONFIG.limits.maxFileSizeMB * 1024 * 1024) {
        entry.status = 'error'; entry.errorCode = 'size';
        entry.error = `El archivo es demasiado grande (${(file.size / 1048576).toFixed(0)} MB). Máximo: ${CONFIG.limits.maxFileSizeMB} MB. Divídelo en partes.`;
      }
      if (replaceId) {
        const idx = this.entries.findIndex((e) => e.id === replaceId);
        if (idx >= 0) { this.entries[idx].removed = true; this.release(this.entries[idx]); this.entries.splice(idx, 1, entry); } else this.entries.push(entry);
      } else this.entries.push(entry);
      this.log('info', `${this.label}: archivo agregado "${file.name}" (${file.size} bytes)`);
      if (entry.status === 'queued') this.enqueue(entry);
    }
    this.emit('add');
    return notices;
  }

  enqueue(entry) {
    entry.status = 'queued';
    queue.push(() => this.process(entry));
    pump();
  }

  retry(id) {
    const e = this.entries.find((x) => x.id === id);
    if (e && e.status === 'error' && !['type', 'empty', 'size', 'duplicate'].includes(e.errorCode)) {
      e.error = ''; e.errorCode = ''; e.warnings = [];
      this.enqueue(e);
      this.emit('retry');
    }
  }

  remove(id) {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const [e] = this.entries.splice(idx, 1);
    e.removed = true;
    this.release(e);
    this.log('info', `${this.label}: archivo eliminado "${e.name}"`);
    this.emit('remove');
  }

  clear() {
    for (const e of this.entries) { e.removed = true; this.release(e); }
    this.entries = [];
    this.log('info', `${this.label}: todos los archivos eliminados`);
    this.emit('clear');
  }

  /** Libera memoria de un archivo (modelos de página). El File original lo gestiona el navegador. */
  release(e) { e.pages = []; e.docs = []; }

  async process(entry) {
    if (entry.removed) return;
    entry.status = 'reading'; entry.progress = 0;
    this.emit('progress');
    try {
      let buf;
      try { buf = await entry.file.arrayBuffer(); } catch (err) {
        throw new PdfReadError('read', 'No se pudo leer el archivo. ¿Se movió o eliminó del computador? Vuelve a seleccionarlo.', err);
      }
      if (entry.removed) return;
      const bytes = new Uint8Array(buf);
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
      if (!head.includes('%PDF-')) throw new PdfReadError('corrupt', 'El archivo no es un PDF válido (no tiene la firma %PDF).');
      // Huella SHA-256 para detectar el mismo contenido con otro nombre.
      try {
        if (globalThis.crypto?.subtle) {
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          entry.hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
          const twin = this.entries.find((e) => e !== entry && e.hash && e.hash === entry.hash);
          if (twin) {
            // Mismo contenido con otro nombre: no se agrega dos veces.
            this.remove(entry.id);
            this.notify(`"${entry.name}" tiene el mismo contenido que "${twin.name}", que ya está cargado en ${this.label}. No se agregó de nuevo.`);
            return;
          }
        }
      } catch (err) { this.log('warn', 'No se pudo calcular la huella SHA-256', err); }

      const pdfjs = await loadPdfjs();
      // PDF.js transfiere el buffer al worker: no se conserva una segunda copia en memoria.
      const { doc, close, encrypted } = await openPdf(pdfjs, bytes, pdfjsOptions());
      entry.encrypted = encrypted;
      try {
        entry.pageCount = doc.numPages;
        entry.pages = await readAllPages(pdfjs, doc, { fileId: entry.id, fileName: entry.name }, async (i, n) => {
          entry.progress = i / n;
          if (i % 4 === 0 || i === n) this.emit('progress');
        });
      } finally { await close(); }
      if (entry.removed) { this.release(entry); return; }
      entry.docs = entry.pages.map((p) => classifyAndParse(p, this.expected));
      entry.warnings = summarizeWarnings(entry, this.expected);
      entry.status = 'ready';
      this.log('info', `${this.label}: "${entry.name}" leído — ${entry.pageCount} páginas, ${entry.docs.filter((d) => d.ok).length} documentos reconocidos`);
    } catch (err) {
      entry.status = 'error';
      entry.errorCode = err.code || 'read';
      entry.error = err.code ? err.message : `Error inesperado al leer el PDF: ${err.message || err}`;
      // Errores previstos (PDF dañado, contraseña…) se registran como aviso; los inesperados como error.
      this.log(err.code ? 'warn' : 'error', `${this.label}: "${entry.name}" — ${entry.error}`, err);
      if (/memory|allocation|Array buffer/i.test(String(err?.message))) entry.error = 'Memoria insuficiente para leer este archivo. Cierra otras pestañas o divide el PDF en partes.';
    }
    this.emit('progress');
  }

  /** Estado agregado para la interfaz. */
  stats() {
    const s = { files: this.entries.length, ready: 0, reading: 0, errors: 0, pages: 0, recognized: 0, wrongType: 0, scanned: 0, failed: 0 };
    for (const e of this.entries) {
      if (e.status === 'ready') s.ready++;
      else if (e.status === 'error') s.errors++;
      else s.reading++;
      s.pages += e.pageCount;
      for (const d of e.docs) {
        if (d.ok) s.recognized++;
        else if (d.kind === 'scanned') s.scanned++;
        else if (d.kind === 'wrong-type' || d.kind === 'unknown') s.wrongType++;
        else s.failed++;
      }
    }
    return s;
  }

  /** Documentos interpretados en orden de carga (archivo, página). */
  documents() {
    const out = [];
    for (const e of this.entries) for (const d of e.docs) out.push(d);
    return out;
  }

  entryById(id) { return this.entries.find((e) => e.id === id); }
}

function summarizeWarnings(entry, expected) {
  const w = [];
  const scanned = entry.docs.filter((d) => d.kind === 'scanned').length;
  if (scanned) w.push(`${scanned} página(s) parecen escaneadas y no contienen texto seleccionable.`);
  const wrong = entry.docs.filter((d) => d.kind === 'wrong-type');
  if (wrong.length) {
    const kinds = [...new Set(wrong.map((d) => d.detectedLabel))].join(', ');
    w.push(`${wrong.length} página(s) parecen ${kinds}, no ${expectedLabel(expected)}.`);
  }
  const unknown = entry.docs.filter((d) => d.kind === 'unknown').length;
  if (unknown) w.push(`${unknown} página(s) no se reconocen como ${expectedLabel(expected)}.`);
  const failed = entry.docs.filter((d) => d.kind === 'parse-error').length;
  if (failed) w.push(`${failed} página(s) con datos incompletos.`);
  if (entry.encrypted && expected !== 'order') w.push('El PDF tiene restricciones de seguridad: podría no poder combinarse en el expediente.');
  return w;
}

export const expectedLabel = (t) => ({ order: 'órdenes de compra', invoice: 'facturas', prevalidation: 'prevalidaciones' }[t] || t);
