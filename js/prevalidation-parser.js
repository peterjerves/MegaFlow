/**
 * Parser de PREVALIDACIONES CORAL ("PREVALIDACIÓN FACTURA").
 *
 * Es el DOCUMENTO PUENTE: relaciona
 *   PEDIDO: AL204391  (SAP de la orden)
 *   REFERENCIA: 001-001-000000366  (número de factura)
 * Además lee CLAVE (clave de acceso SRI de la factura), CENTRO (tienda),
 * TOTAL (con IVA) y las líneas (EAN, cantidad, costo, valor).
 */
import { CONFIG } from './config.js';
import { clean, compact, fold, normId, parseNumber, toCents, parseSriAccessKey } from './text-utils.js';
import { findLabel, findAllLabels, tokensRightOf } from './pdf-reader.js';
import { pageRef } from './coral-parser.js';

export const PREVAL_TYPE = 'prevalidation';

export function looksLikePrevalidation(page) {
  const c = compact(fold(page.text));
  return c.includes('PREVALIDACION') && c.includes('REFERENCIA') && c.includes('PEDIDO');
}

class PreParseError extends Error {}
const fail = (m) => { throw new PreParseError(m); };

export function parsePrevalidation(page) {
  const partial = {};
  const warnings = [];
  try {
    if (page.charCount < CONFIG.limits.minTextChars) fail('Este documento parece escaneado y no contiene texto seleccionable.');
    if (!looksLikePrevalidation(page)) fail('La página no tiene la estructura de una prevalidación Coral (faltan PEDIDO / REFERENCIA).');

    // --- PEDIDO (excluye "FECHA PEDIDO" y "TIPO PEDIDO") ---------------------
    const pedidoLabels = findAllLabels(page, /^PEDIDO\s*:?$/i).filter((l) => {
      const prev = l.line.tokens[l.startIndex - 1];
      return !(prev && /^(FECHA|TIPO|N[°º.]?)$/i.test(fold(prev.str)));
    });
    const sapValues = new Set();
    for (const lab of pedidoLabels) {
      const next = tokensRightOf(page, lab, { tol: 3 }).slice(0, 2);
      const joined = normId(next.map((t) => t.str).join(''));
      const one = next[0] ? normId(next[0].str) : '';
      if (CONFIG.identifiers.sap.test(one)) sapValues.add(one);
      else if (/^[A-Z]{2}\d{5,7}/.test(joined)) sapValues.add(joined.match(/^[A-Z]{2}\d{5,7}/)[0]);
    }
    if (sapValues.size === 0) fail('No se encontró el campo PEDIDO (código SAP).');
    if (sapValues.size > 1) fail(`Campo PEDIDO ambiguo: ${[...sapValues].join(', ')}.`);
    const sap = [...sapValues][0];
    partial.sap = sap;

    // --- REFERENCIA (número de factura) --------------------------------------
    let reference = '';
    const refLabel = findLabel(page, /^REFERENCIA\s*:?$/i);
    if (refLabel) {
      const right = compact(tokensRightOf(page, refLabel, { tol: 3 }).map((t) => t.str).join(''));
      const m = right.match(/^(\d{3}-\d{3}-\d{9})(?!\d)/);
      if (m) reference = m[1];
    }
    if (!reference) {
      for (const l of page.lines) {
        const m = compact(fold(l.text)).match(/REFERENCIA:?(\d{3}-\d{3}-\d{9})(?!\d)/);
        if (m) { reference = m[1]; break; }
      }
    }

    // --- CLAVE ---------------------------------------------------------------
    let accessKey = null;
    for (const l of page.lines) {
      const m = compact(l.text).match(/(?:^|\D)(\d{49})(?!\d)/);
      if (m) { accessKey = parseSriAccessKey(m[1]); if (accessKey) break; }
    }
    if (!reference && accessKey) {
      reference = accessKey.invoiceNumber;
      warnings.push('REFERENCIA no legible: el número de factura se tomó de la CLAVE de acceso.');
    }
    if (!reference) fail(`Prevalidación del pedido ${sap}: no se encontró REFERENCIA (número de factura).`);
    partial.reference = reference;
    if (accessKey && accessKey.invoiceNumber !== reference) {
      fail(`Prevalidación del pedido ${sap}: REFERENCIA ${reference} no coincide con la factura de la CLAVE (${accessKey.invoiceNumber}).`);
    }

    // --- CENTRO --------------------------------------------------------------
    let store = '';
    const centroLabel = findLabel(page, /^CENTRO\s*:?$/i);
    if (centroLabel) {
      const stop = page.tokens.filter((t) => Math.abs(t.y - centroLabel.y) <= 3 && t.x > centroLabel.x1 && /^TOTAL$/i.test(t.str)).map((t) => t.x);
      const maxX = stop.length ? Math.min(...stop) : Infinity;
      store = clean(tokensRightOf(page, centroLabel, { tol: 3, maxX }).map((t) => t.str).join(' '));
    }

    // --- TOTAL (cabecera "TOTAL 25.88" y pie "TOTAL: 25.88") -----------------
    const totals = [];
    for (const lab of findAllLabels(page, /^TOTAL\s*:?$/i)) {
      const v = tokensRightOf(page, lab, { tol: 3 }).map((t) => parseNumber(t.str, '.')).find((n) => Number.isFinite(n));
      if (Number.isFinite(v)) totals.push(toCents(v));
    }
    if (!totals.length) fail(`Prevalidación del pedido ${sap}: no se encontró el TOTAL.`);
    const distinctTotals = [...new Set(totals)];
    if (distinctTotals.length > 1) fail(`Prevalidación del pedido ${sap}: los totales del documento no coinciden (${distinctTotals.map((c) => (c / 100).toFixed(2)).join(' / ')}).`);

    const lines = extractPreLines(page, warnings);
    return {
      ok: true,
      prevalidation: {
        type: PREVAL_TYPE,
        sap,
        invoiceNumber: reference,
        accessKey: accessKey ? accessKey.key : '',
        store,
        totalCents: distinctTotals[0],
        lines,
        warnings,
        page: pageRef(page),
      },
    };
  } catch (err) {
    if (!(err instanceof PreParseError)) throw err;
    return { ok: false, error: err.message, partial, page: pageRef(page) };
  }
}

function extractPreLines(page, warnings) {
  const header = page.lines.find((l) => {
    const f = l.tokens.map((t) => fold(t.str));
    return f.some((s) => s.startsWith('CANTID')) && f.includes('COSTO') && f.includes('VALOR');
  });
  if (!header) { warnings.push('No se pudo leer la tabla de productos de la prevalidación.'); return []; }
  const tq = header.tokens.find((t) => fold(t.str).startsWith('CANTID'));
  const tp = header.tokens.find((t) => fold(t.str) === 'COSTO');
  const tv = header.tokens.find((t) => fold(t.str) === 'VALOR');
  const cols = [['qty', tq], ['price', tp], ['amount', tv]];
  const footer = findAllLabels(page, /^TOTAL\s*:$/i).find((l) => l.y > header.y);
  const maxY = footer ? footer.y : header.y + 400;
  const anchors = page.tokens.filter((t) => /^\d{13}$/.test(t.str) && t.y > header.y + 2 && t.y < maxY && t.x < tq.x - 60);
  const out = [];
  for (const a of anchors) {
    const nums = { qty: [], price: [], amount: [] };
    for (const t of page.tokens) {
      if (Math.abs(t.y - a.y) > 3 || t.x < tq.x - 30) continue;
      const n = parseNumber(t.str, '.');
      if (!Number.isFinite(n)) continue;
      let best = null;
      for (const [name, c] of cols) {
        // Números alineados a la derecha: se compara el borde derecho con el del encabezado.
        const d = Math.abs(t.x1 - c.x1);
        if (!best || d < best.d) best = { name, d };
      }
      if (best && best.d < 25) nums[best.name].push(n);
    }
    if (nums.qty.length !== 1 || nums.price.length !== 1 || nums.amount.length !== 1) {
      warnings.push(`Prevalidación, línea ${a.str}: no se pudieron leer cantidad/costo/valor.`);
      continue;
    }
    out.push({ ean: a.str, qty: nums.qty[0], priceCents: toCents(nums.price[0]), totalCents: toCents(nums.amount[0]) });
  }
  return out;
}
