/**
 * Utilidades puras de texto, números y dinero. Sin DOM: se usan en navegador y en pruebas Node.
 */

/** Colapsa espacios y recorta. */
export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Quita tildes y pasa a mayúsculas (solo para comparar etiquetas). */
export const fold = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Elimina todo espacio (para texto con letras espaciadas: "0 0 1 - 0 0 1"). */
export const compact = (s) => String(s ?? '').replace(/\s+/g, '');

/**
 * Normaliza un identificador para COMPARAR: sin espacios, mayúsculas, guiones unificados.
 * Conserva ceros a la izquierda y todos los caracteres significativos.
 */
export function normId(s) {
  return compact(s).toUpperCase().replace(/[‐-―−]/g, '-');
}

/**
 * Convierte texto numérico a Number.
 * decimal: '.' (órdenes Coral: "67.5"), ',' (facturas: "1.234,56") o 'auto'.
 * Devuelve NaN si el texto no es un número limpio.
 */
export function parseNumber(raw, decimal = 'auto') {
  let s = compact(raw).replace(/^\$/, '').replace(/USD$/i, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return NaN;
  if (decimal === 'auto') {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) decimal = lastComma > lastDot ? ',' : '.';
    else if (lastComma >= 0) decimal = /,\d{3}$/.test(s) && (s.match(/,/g) || []).length > 1 ? '.' : ',';
    else decimal = '.';
  }
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if ((s.match(/\./g) || []).length > 1) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Dinero en centavos enteros (evita errores de coma flotante). */
export function toCents(n) {
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100 + (n >= 0 ? 1e-7 : -1e-7));
}
export const fromCents = (c) => c / 100;

/** IVA sobre una base en centavos, con redondeo comercial (mitad hacia arriba). */
export function ivaCents(baseCents, percent) {
  // baseCents * percent es entero; dividir entre 100 deja como mucho .5 exacto en binario.
  return Math.round((baseCents * percent) / 100);
}

/** Formato monetario para pantalla. */
const usd = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
export const formatUSD = (n) => usd.format(Number.isFinite(n) ? n : 0);
export const formatCents = (c) => formatUSD(c / 100);

/** Valida dígito de control EAN-13. */
export function isValidEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const sum = d.slice(0, 12).reduce((s, n, i) => s + n * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

/**
 * Clave de acceso SRI (49 dígitos): ddmmaaaa(8) tipo(2) ruc(13) amb(1) serie(6) secuencial(9) código(8) emisión(1) dv(1).
 * Devuelve sus partes o null.
 */
export function parseSriAccessKey(raw) {
  const k = compact(raw);
  if (!/^\d{49}$/.test(k)) return null;
  const serie = k.slice(24, 30);
  const seq = k.slice(30, 39);
  return {
    key: k,
    date: `${k.slice(4, 8)}-${k.slice(2, 4)}-${k.slice(0, 2)}`,
    docType: k.slice(8, 10),
    ruc: k.slice(10, 23),
    invoiceNumber: `${serie.slice(0, 3)}-${serie.slice(3, 6)}-${seq}`,
    checkDigitOk: sriCheckDigit(k.slice(0, 48)) === Number(k[48]),
  };
}

/** Dígito verificador módulo 11 de la clave de acceso SRI. */
export function sriCheckDigit(first48) {
  let factor = 2;
  let sum = 0;
  for (let i = first48.length - 1; i >= 0; i--) {
    sum += Number(first48[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? 0 : r === 10 ? 1 : r;
}

/** Escapa HTML para insertar texto en plantillas. */
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Tamaño legible. */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Plantillas sencillas "{clave}". */
export const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
