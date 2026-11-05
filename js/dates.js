/**
 * Fechas en formato ISO "AAAA-MM-DD", calculadas sin zonas horarias (UTC puro)
 * para que el resultado no cambie según el reloj del computador.
 */
import { CONFIG, MONTHS_ES } from './config.js';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s) {
  const m = ISO.exec(s || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toIso = (dt) => dt.toISOString().slice(0, 10);

export function addDays(iso, days) {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Suma meses calendario; si el día no existe en el mes destino, usa el último día (31/01 + 1 mes = 28/02). */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toIso(target);
}

/** Vencimiento según la modalidad. En modo manual devuelve la fecha indicada sin tocarla. */
export function computeDueDate(invoiceIso, mode, manualIso = '') {
  if (mode === 'manual') return manualIso || '';
  if (!isIsoDate(invoiceIso)) return '';
  const def = CONFIG.dueDate.modes.find((m) => m.id === mode);
  if (!def) return '';
  if (def.days) return addDays(invoiceIso, def.days);
  if (def.months) return addMonths(invoiceIso, def.months);
  return '';
}

export function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** "2026-11-01" → "01/11/2026" */
export const toDisplay = (iso) => (isIsoDate(iso) ? iso.split('-').reverse().join('/') : iso || '—');

/** "2026-10-30" → { dia: '30', mes: 'octubre', compact: '2026_10_30' } */
export function dateParts(iso) {
  if (!isIsoDate(iso)) return null;
  const [y, m, d] = iso.split('-');
  return { dia: d, mes: MONTHS_ES[Number(m) - 1], anio: y, compact: `${y}_${m}_${d}` };
}

/** Fecha más frecuente de una lista (para nombrar archivos). */
export function mostFrequent(list) {
  const counts = new Map();
  for (const v of list) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = '';
  let n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return best;
}
