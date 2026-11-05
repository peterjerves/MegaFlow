/**
 * Carga diferida de librerías LOCALES (carpeta vendor/). Nada se descarga de CDN.
 * La interfaz se inicializa sin esperar estas librerías: si alguna falla, los
 * controles de carga siguen funcionando y se muestra un error comprensible.
 */
import { CONFIG } from './config.js';

const cache = new Map();

export class LibraryError extends Error {
  constructor(lib, cause) {
    super(`No se pudo cargar la librería ${lib} desde la carpeta vendor/. Verifica que la carpeta "vendor" se haya subido completa al repositorio y recarga la página (Ctrl+Shift+R).`);
    this.name = 'LibraryError';
    this.code = 'library';
    this.cause = cause;
  }
}

const url = (rel) => new URL(rel, import.meta.url).href;

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: tiempo de espera agotado`)), ms); }),
  ]);
}

/** PDF.js (módulo ES) con su worker local. */
export function loadPdfjs() {
  if (!cache.has('pdfjs')) {
    const p = withTimeout(import(url(CONFIG.vendor.pdfjs)), 30000, 'PDF.js')
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = url(CONFIG.vendor.pdfjsWorker);
        return lib;
      })
      .catch((err) => { cache.delete('pdfjs'); throw new LibraryError('PDF.js', err); });
    cache.set('pdfjs', p);
  }
  return cache.get('pdfjs');
}

/**
 * Opciones comunes de PDF.js: ruta local de las fuentes estándar.
 * (No se incluyen los CMaps de idiomas asiáticos: los PDF de Coral y Mega Suministros
 * no los usan, y así el proyecto tiene menos de 100 archivos para subirlo por la web de GitHub.)
 */
export function pdfjsOptions() {
  return { standardFontDataUrl: url(CONFIG.vendor.pdfjsStandardFonts) };
}

/** Carga un script clásico (UMD) y devuelve la variable global que define. */
function loadGlobal(key, rel, globalName, label) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (!cache.has(key)) {
    const p = withTimeout(new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url(rel);
      s.async = true;
      s.onload = () => (globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error(`${globalName} no quedó disponible`)));
      s.onerror = () => reject(new Error(`No se encontró ${rel}`));
      document.head.append(s);
    }), 30000, label).catch((err) => { cache.delete(key); throw new LibraryError(label, err); });
    cache.set(key, p);
  }
  return cache.get(key);
}

export const loadPdfLib = () => loadGlobal('pdflib', CONFIG.vendor.pdfLib, 'PDFLib', 'pdf-lib');
export const loadExcelJS = () => loadGlobal('exceljs', CONFIG.vendor.exceljs, 'ExcelJS', 'ExcelJS');
