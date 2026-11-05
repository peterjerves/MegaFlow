/**
 * Parser de FACTURAS ELECTRÓNICAS de Mega Suministros (formato RIDE de Odoo).
 *
 * Extrae: número de factura (001-001-000000366), clave de acceso SRI, SAP y OC
 * (de la nota de la factura y de la referencia "OC ... / SAP ..."), tienda,
 * líneas (EAN, cantidad, precio, importe), Subtotal, IVA y Total.
 *
 * El número aparece con letras espaciadas ("0 0 1 - 0 0 1 - ...") y se normaliza
 * quitando espacios. Se contrasta con la clave de acceso y con "Fact ..." de la
 * información adicional: si no coinciden, la página se marca con error.
 */
import { CONFIG } from './config.js';
import { clean, compact, fold, normId, parseNumber, toCents, parseSriAccessKey } from './text-utils.js';
import { findLabel, tokensRightOf } from './pdf-reader.js';
import { pageRef } from './coral-parser.js';

export const INVOICE_TYPE = 'invoice';
const INV_RE = /(?:^|\D)(\d{3}-\d{3}-\d{9})(?!\d)/;

export function looksLikeInvoice(page) {
  const c = compact(fold(page.text));
  return c.includes('FACTURA') && (c.includes('CLAVEDEACCESO') || c.includes('NUMERODEAUTORIZACION')) && !c.includes('PREVALIDACION');
}

class InvoiceParseError extends Error {}
const fail = (m) => { throw new InvoiceParseError(m); };

export function parseInvoice(page) {
  const partial = {};
  const warnings = [];
  try {
    if (page.charCount < CONFIG.limits.minTextChars) fail('Este documento parece escaneado y no contiene texto seleccionable.');
    if (!looksLikeInvoice(page)) fail('La página no tiene la estructura de una factura electrónica (falta "Factura" o "Clave de acceso").');

    // --- Clave de acceso (49 dígitos) --------------------------------------
    let accessKey = null;
    for (const line of page.lines) {
      const m = compact(line.text).match(/(?:^|\D)(\d{49})(?!\d)/);
      if (m) { accessKey = parseSriAccessKey(m[1]); if (accessKey) break; }
    }

    // --- Número de factura ---------------------------------------------------
    const titleLine = page.lines.find((l) => /^FACTURA$/.test(compact(fold(l.tokens.filter((t) => t.x > page.width * 0.35).map((t) => t.str).join(''))))
      || compact(fold(l.text)).endsWith('FACTURA'));
    let headerNumber = '';
    const headerZone = page.lines.filter((l) => (titleLine ? l.y >= titleLine.y - 2 && l.y <= titleLine.y + 40 : l.y < page.height * 0.2));
    for (const l of headerZone) {
      const m = compact(l.text).match(INV_RE);
      if (m) { headerNumber = m[1]; break; }
    }
    let refNumber = '';
    for (const l of page.lines) {
      const m = compact(l.text).match(/FACT(?:URA)?\.?(?:N[°ºO]?\.?)?(\d{3}-\d{3}-\d{9})(?!\d)/i);
      if (m) { refNumber = m[1]; break; }
    }
    const keyNumber = accessKey ? accessKey.invoiceNumber : '';
    const number = headerNumber || keyNumber || refNumber;
    if (!number) fail('No se encontró el número de factura (formato 001-001-000000000).');
    partial.number = number;
    const sources = { header: headerNumber, accessKey: keyNumber, reference: refNumber };
    const distinct = new Set(Object.values(sources).filter(Boolean));
    if (distinct.size > 1) {
      fail(`El número de factura no es coherente dentro del documento: cabecera ${headerNumber || '—'}, clave de acceso ${keyNumber || '—'}, referencia ${refNumber || '—'}.`);
    }
    if (accessKey && !accessKey.checkDigitOk) warnings.push('El dígito verificador de la clave de acceso no es válido.');
    if (accessKey && accessKey.docType !== '01') warnings.push(`La clave de acceso indica tipo de comprobante ${accessKey.docType} (01 = factura).`);

    // --- SAP / OC ------------------------------------------------------------
    const saps = new Set();
    const ocs = new Set();
    let noteSapLine = null;
    for (const l of page.lines) {
      const t = clean(l.text);
      let m = t.match(/^SAP\s*:?\s*([A-Z]{2}\s?\d{5,7})$/i);
      if (m) { saps.add(normId(m[1])); noteSapLine = noteSapLine || l; }
      m = t.match(/^OC\s*:?\s*(\d{6,14})$/i);
      if (m) ocs.add(m[1]);
      m = t.match(/\bOC\s*:?\s*(\d{6,14})\s*\/\s*SAP\s*:?\s*([A-Z]{2}\s?\d{5,7})\b/i);
      if (m) { ocs.add(m[1]); saps.add(normId(m[2])); }
      m = t.match(/\bSAP\s*:?\s*([A-Z]{2}\s?\d{5,7})\s*\/\s*OC\s*:?\s*(\d{6,14})\b/i);
      if (m) { saps.add(normId(m[1])); ocs.add(m[2]); }
    }
    if (saps.size === 0) fail(`Factura ${number}: no se encontró el código SAP del pedido.`);
    if (ocs.size === 0) fail(`Factura ${number}: no se encontró el número de OC.`);
    if (saps.size > 1) fail(`Factura ${number}: contiene varios SAP distintos (${[...saps].join(', ')}).`);
    if (ocs.size > 1) fail(`Factura ${number}: contiene varias OC distintas (${[...ocs].join(', ')}).`);
    const sap = [...saps][0];
    const oc = [...ocs][0];

    // Tienda: línea inmediatamente encima de "SAP:" en la nota.
    let store = '';
    if (noteSapLine) {
      const idx = page.lines.indexOf(noteSapLine);
      const prev = page.lines[idx - 1];
      if (prev && noteSapLine.y - prev.y < 14 && Math.abs(prev.x - noteSapLine.x) < 20 && !/\d{13}/.test(prev.text)) store = clean(prev.text);
    }

    // --- Totales ---------------------------------------------------------------
    const rightX = page.width * 0.55;
    const subLabel = findLabel(page, /^Subtotal$/i, (l) => l.x > rightX);
    if (!subLabel) fail(`Factura ${number}: no se encontró el Subtotal.`);
    const ivaLabel = findLabel(page, /^IVA\s*\d{1,2}\s*%$/i, (l) => l.x > rightX && l.y > subLabel.y);
    const totLabel = findLabel(page, /^Total$/i, (l) => l.x > rightX && l.y > subLabel.y);
    if (!totLabel) fail(`Factura ${number}: no se encontró el Total.`);
    const valueRight = (label) => {
      const v = tokensRightOf(page, label, { tol: 3 }).filter((t) => Number.isFinite(parseNumber(t.str, ','))).pop();
      return v ? toCents(parseNumber(v.str, ',')) : NaN;
    };
    const subtotalCents = valueRight(subLabel);
    const ivaCentsVal = ivaLabel ? valueRight(ivaLabel) : NaN;
    const totalCents = valueRight(totLabel);
    if (!Number.isFinite(subtotalCents) || !Number.isFinite(totalCents)) fail(`Factura ${number}: no se pudieron leer Subtotal o Total.`);
    const ivaPercent = ivaLabel ? Number((ivaLabel.str.match(/(\d{1,2})\s*%/) || [])[1]) : NaN;

    // --- Líneas ----------------------------------------------------------------
    const lines = extractInvoiceLines(page, subLabel.y, warnings);

    // --- Fechas, cliente y páginas -----------------------------------------
    const below = (labelRe) => {
      const lab = findLabel(page, labelRe);
      if (!lab) return '';
      const t = page.tokens.filter((k) => k.y > lab.y + 1 && k.y < lab.y + 12 && k.x >= lab.x - 3 && k.x < lab.x + 70).sort((a, b) => a.y - b.y || a.x - b.x);
      return t.length ? t[0].str : '';
    };
    const invoiceDate = below(/^Fecha\s+de\s+factura$/i);
    const dueDate = below(/^Fecha\s+l[ií]mite$/i);
    let customerRuc = '';
    const rsLabel = findLabel(page, /^Raz[oó]n\s+Social/i);
    if (rsLabel) {
      const tok = page.tokens.find((k) => k.y > rsLabel.y && k.y < rsLabel.y + 40 && k.x < rsLabel.x + 60 && /^\d{13}$/.test(k.str));
      customerRuc = tok ? tok.str : '';
    }
    const pm = compact(page.text).match(/P[áa]gina(\d+)\/(\d+)/i);
    const pageOf = pm ? { n: Number(pm[1]), total: Number(pm[2]) } : null;
    if (pageOf && pageOf.total > 1) warnings.push(`La factura indica "Página ${pageOf.n} / ${pageOf.total}". El expediente usa una sola página de factura.`);

    return {
      ok: true,
      invoice: {
        type: INVOICE_TYPE,
        number,
        sources,
        accessKey: accessKey ? accessKey.key : '',
        sap,
        oc,
        store,
        lines,
        subtotalCents,
        ivaCents: ivaCentsVal,
        ivaPercent,
        totalCents,
        invoiceDate,
        dueDate,
        customerRuc,
        pageOf,
        warnings,
        page: pageRef(page),
      },
    };
  } catch (err) {
    if (!(err instanceof InvoiceParseError)) throw err;
    return { ok: false, error: err.message, partial, page: pageRef(page) };
  }
}

function extractInvoiceLines(page, subtotalY, warnings) {
  const qtyLabel = findLabel(page, /^Cantidad$/i);
  const priceLabel = findLabel(page, /^Precio\s+unitario$/i) || findLabel(page, /^Precio$/i);
  const amountLabel = findLabel(page, /^Importe$/i) || findLabel(page, /^Precio\s+total$/i) || findLabel(page, /^Valor$/i);
  if (!qtyLabel || !priceLabel || !amountLabel) {
    warnings.push('No se pudo reconstruir la tabla de productos de la factura.');
    return [];
  }
  const headerY = Math.max(qtyLabel.y, priceLabel.y, amountLabel.y);
  const cols = [['qty', qtyLabel], ['price', priceLabel], ['amount', amountLabel]];
  const anchors = page.tokens.filter((t) => /^\d{13}$/.test(t.str) && t.y > headerY && t.y < subtotalY && t.x < qtyLabel.x - 40).sort((a, b) => a.y - b.y);
  const out = [];
  for (const a of anchors) {
    const nums = { qty: [], price: [], amount: [] };
    for (const t of page.tokens) {
      if (Math.abs(t.y - a.y) > 3 || t.x < qtyLabel.x - 60) continue;
      const n = parseNumber(t.str, ',');
      if (!Number.isFinite(n)) continue;
      let best = null;
      for (const [name, c] of cols) {
        const d = Math.min(Math.abs(t.x1 - c.x1), Math.abs(t.x - c.x));
        if (!best || d < best.d) best = { name, d };
      }
      if (best && best.d < 35) nums[best.name].push(n);
    }
    if (nums.qty.length !== 1 || nums.price.length !== 1 || nums.amount.length !== 1) {
      warnings.push(`Línea ${a.str}: no se pudieron leer cantidad, precio o importe.`);
      continue;
    }
    out.push({ ean: a.str, qty: nums.qty[0], priceCents: toCents(nums.price[0]), totalCents: toCents(nums.amount[0]) });
  }
  return out;
}
