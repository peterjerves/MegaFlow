/**
 * Lectura de PDF con PDF.js y reconstrucción posicional del texto.
 *
 * Cada página se convierte en un "modelo de página" independiente del DOM:
 *   { fileId, fileName, pageIndex, width, height, items, tokens, lines, text, charCount }
 * - items:  fragmentos de PDF.js con coordenadas (origen arriba-izquierda, en puntos).
 * - tokens: fragmentos divididos por espacios con posición x estimada (robusto ante
 *           fragmentos que PDF.js une o separa de forma distinta entre versiones).
 * - lines:  tokens agrupados por línea visual, ordenados de izquierda a derecha.
 *
 * Funciona en navegador y en Node (las pruebas inyectan la librería pdfjs).
 */
import { clean } from './text-utils.js';

/** Errores de lectura con mensaje para usuarios administrativos. */
export class PdfReadError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PdfReadError';
    this.code = code; // 'password' | 'corrupt' | 'empty' | 'read' | 'library'
    this.cause = cause;
  }
}

/**
 * Abre un PDF. `data` debe ser un Uint8Array propio: PDF.js lo transfiere al worker.
 * Devuelve { doc, close } — llamar a close() libera la memoria del worker.
 */
export async function openPdf(pdfjs, data, options = {}) {
  if (!data || !data.byteLength) throw new PdfReadError('empty', 'El archivo está vacío (0 bytes).');
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
    ...options,
  });
  try {
    const doc = await task.promise;
    let permissions = null;
    try { permissions = await doc.getPermissions(); } catch { /* sin permisos = sin cifrado */ }
    return { doc, encrypted: Array.isArray(permissions), close: () => task.destroy().catch(() => {}) };
  } catch (err) {
    task.destroy().catch(() => {});
    const name = err?.name || '';
    if (name === 'PasswordException') {
      throw new PdfReadError('password', 'El PDF está protegido con contraseña. Guarda una copia sin contraseña y vuelve a cargarla.', err);
    }
    if (name === 'InvalidPDFException' || /Invalid PDF/i.test(err?.message || '')) {
      throw new PdfReadError('corrupt', 'El archivo no es un PDF válido o está dañado.', err);
    }
    throw new PdfReadError('read', `No se pudo leer el PDF (${err?.message || 'error desconocido'}).`, err);
  }
}

/**
 * Lee el texto de una página con un lector de stream explícito (reader.read()).
 * Así no depende de `for await` sobre ReadableStream, que Safari no soporta.
 */
export async function readTextContent(pdfPage, params) {
  if (typeof pdfPage.streamTextContent !== 'function') return pdfPage.getTextContent(params);
  const reader = pdfPage.streamTextContent(params).getReader();
  const items = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const it of value.items) items.push(it);
    }
  } finally {
    reader.releaseLock();
  }
  return { items };
}

/**
 * Extrae el modelo de una página PDF.js.
 */
export async function extractPageModel(pdfjs, pdfPage, meta = {}) {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const content = await readTextContent(pdfPage, { includeMarkedContent: false, disableNormalization: false });
  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    // Coordenadas de dispositivo (considera rotación y CropBox de la página).
    const tx = pdfjs.Util.transform(viewport.transform, it.transform);
    const fontH = Math.hypot(tx[2], tx[3]) || it.height || 8;
    const angle = Math.atan2(tx[1], tx[0]);
    const horizontal = Math.abs(angle) < 0.2;
    items.push({
      str: it.str,
      x: tx[4],
      y: tx[5], // línea base medida desde arriba
      w: (it.width || 0) * (viewport.scale || 1),
      h: fontH,
      horizontal,
    });
  }
  return buildPageModel(items, { width: viewport.width, height: viewport.height, rotation: viewport.rotation || 0, ...meta });
}

/** Construye tokens y líneas a partir de items (función pura, testeable). */
export function buildPageModel(items, meta = {}) {
  const horizontalItems = items.filter((i) => i.horizontal !== false);
  const tokens = tokenize(horizontalItems);
  const lines = groupLines(tokens);
  const text = lines.map((l) => l.text).join('\n');
  return {
    ...meta,
    items,
    tokens,
    lines,
    text,
    charCount: text.replace(/\s/g, '').length,
  };
}

/**
 * Divide cada item en tokens separados por espacios, estimando su x según la
 * proporción de caracteres. Así una celda "30 2.25 67.5" unida por PDF.js se
 * reparte igualmente en columnas.
 */
export function tokenize(items) {
  const out = [];
  for (const it of items) {
    const s = it.str;
    const len = s.length || 1;
    const charW = it.w > 0 ? it.w / len : (it.h || 8) * 0.5;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(s))) {
      const x0 = it.x + m.index * charW;
      const x1 = x0 + m[0].length * charW;
      out.push({ str: m[0], x: x0, x1, y: it.y, h: it.h || 8, item: it });
    }
  }
  return out;
}

/** Agrupa tokens en líneas visuales por proximidad vertical. */
export function groupLines(tokens) {
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const t of sorted) {
    const tol = Math.max(1.5, Math.min(2.5, (t.h || 8) * 0.28));
    let line = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
      if (Math.abs(lines[i].y - t.y) <= tol) { line = lines[i]; break; }
    }
    if (!line) { line = { y: t.y, tokens: [] }; lines.push(line); }
    line.tokens.push(t);
  }
  for (const l of lines) {
    l.tokens.sort((a, b) => a.x - b.x);
    l.y = l.tokens.reduce((s, t) => s + t.y, 0) / l.tokens.length;
    l.x = l.tokens[0].x;
    l.x1 = l.tokens[l.tokens.length - 1].x1;
    l.text = joinTokens(l.tokens);
  }
  return lines.sort((a, b) => a.y - b.y);
}

/** Une tokens respetando separaciones grandes con doble espacio (útil para depurar). */
export function joinTokens(tokens) {
  return clean(tokens.map((t) => t.str).join(' '));
}

/** Texto de tokens dentro de un rectángulo [x0,x1) × [y0,y1). */
export function tokensIn(page, { x0 = -Infinity, x1 = Infinity, y0 = -Infinity, y1 = Infinity }) {
  return page.tokens.filter((t) => t.x >= x0 && t.x < x1 && t.y >= y0 && t.y < y1);
}

/** Tokens de la misma línea que `ref` (tolerancia vertical), a la derecha de `ref`. */
export function tokensRightOf(page, ref, { maxX = Infinity, tol = 3 } = {}) {
  const refRight = ref.x1 ?? ref.x;
  return page.tokens
    .filter((t) => Math.abs(t.y - ref.y) <= tol && t.x >= refRight - 0.5 && t.x < maxX)
    .sort((a, b) => a.x - b.x);
}

/**
 * Busca la secuencia de tokens que forma una etiqueta (ej. "Ped. Compra:") aunque
 * PDF.js la haya partido. Devuelve un pseudo-token {x, x1, y, str} o null.
 */
export function findLabel(page, regex, filter = () => true) {
  for (const line of page.lines) {
    const toks = line.tokens;
    for (let i = 0; i < toks.length; i++) {
      let acc = '';
      for (let j = i; j < Math.min(toks.length, i + 5); j++) {
        acc = acc ? `${acc} ${toks[j].str}` : toks[j].str;
        if (regex.test(acc)) {
          const label = { str: acc, x: toks[i].x, x1: toks[j].x1, y: line.y, h: toks[i].h, line, startIndex: i, endIndex: j };
          if (filter(label)) return label;
        }
      }
    }
  }
  return null;
}

/** Igual que findLabel pero devuelve todas las coincidencias. */
export function findAllLabels(page, regex) {
  const out = [];
  for (const line of page.lines) {
    const toks = line.tokens;
    for (let i = 0; i < toks.length; i++) {
      let acc = '';
      for (let j = i; j < Math.min(toks.length, i + 5); j++) {
        acc = acc ? `${acc} ${toks[j].str}` : toks[j].str;
        if (regex.test(acc)) {
          out.push({ str: acc, x: toks[i].x, x1: toks[j].x1, y: line.y, h: toks[i].h, line, startIndex: i, endIndex: j });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Lee todas las páginas de un PDF y devuelve sus modelos.
 * onPage(i, total) permite informar progreso.
 */
export async function readAllPages(pdfjs, pdfDoc, meta, onPage) {
  const pages = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const model = await extractPageModel(pdfjs, page, { ...meta, pageIndex: i - 1, pageNumber: i, pageCount: pdfDoc.numPages });
    page.cleanup();
    pages.push(model);
    if (onPage) await onPage(i, pdfDoc.numPages);
  }
  return pages;
}
