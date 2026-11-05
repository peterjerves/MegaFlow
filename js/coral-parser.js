/**
 * Parser de ÓRDENES DE COMPRA CORAL (una orden por página).
 *
 * Reconstruye cabecera y tabla por POSICIÓN de los textos (no por una expresión
 * regular sobre todo el texto concatenado):
 *  - SAP: código grande arriba a la derecha (ej. AL204391).
 *  - OC: valor a la derecha de "Ped. Compra:" (ej. 5601928535).
 *  - Tienda: línea "1415 - TIENDA CORAL ALBORADA / GUAYAQ" (se quita el código inicial).
 *  - Tabla: columnas Cod.Prov | Descripción | Cod.GO | Cantidad | Precio | Total.
 *    La cantidad sale EXCLUSIVAMENTE de la columna "Cantidad". "X10 UND" / "X5 UND"
 *    de la descripción son unidades por empaque y se ignoran.
 */
import { CONFIG, CATALOG } from './config.js';
import { clean, fold, normId, parseNumber, toCents, isValidEan13 } from './text-utils.js';
import { findLabel, tokensRightOf } from './pdf-reader.js';

export const ORDER_TYPE = 'order';

/** ¿Esta página parece una orden Coral? */
export function looksLikeCoralOrder(page) {
  const t = fold(page.text);
  return /PED\.?\s*COMPRA/.test(t) && (/CANTIDAD/.test(t) || /COD\.?\s*GO/.test(t) || /FECHA DE ENVIO/.test(t));
}

class OrderParseError extends Error {}
const fail = (msg) => { throw new OrderParseError(msg); };

/**
 * Interpreta una página. Devuelve { ok:true, order } o { ok:false, error, partial }.
 */
export function parseCoralOrder(page) {
  const partial = {};
  try {
    if (page.charCount < CONFIG.limits.minTextChars) fail('Este documento parece escaneado y no contiene texto seleccionable.');
    if (!looksLikeCoralOrder(page)) fail('La página no tiene la estructura de una orden de compra Coral (falta "Ped. Compra" o la tabla de productos).');

    const header = findTableHeader(page);
    // Límite inferior de la cabecera: la tabla o, si no se encuentra, la zona superior de la página.
    const headerLimitY = header ? header.y : page.height * 0.22;

    // --- OC ---------------------------------------------------------------
    const ocLabel = findLabel(page, /^Ped\.?\s*Compra\s*:?$/i);
    if (!ocLabel) fail('No se encontró la etiqueta "Ped. Compra".');
    const ocCandidates = tokensRightOf(page, ocLabel, { tol: 4 }).map((t) => t.str.replace(/[^\d]/g, '')).filter((s) => /^\d{6,14}$/.test(s));
    const oc = ocCandidates[0];
    if (!oc) fail('No se encontró el número de Pedido de Compra (OC) junto a "Ped. Compra".');
    partial.oc = oc;

    // --- SAP --------------------------------------------------------------
    const sapCandidates = new Set();
    for (const t of page.tokens) {
      if (t.y >= headerLimitY) continue; // solo cabecera
      const v = normId(t.str);
      if (CONFIG.identifiers.sap.test(v)) sapCandidates.add(v);
    }
    // Respaldo: el código partido en dos fragmentos ("AL" "204391").
    if (sapCandidates.size === 0) {
      for (const line of page.lines) {
        if (line.y >= headerLimitY) continue;
        const m = line.text.match(/\b([A-Z]{2})\s+(\d{5,7})\b/);
        if (m) sapCandidates.add(m[1] + m[2]);
      }
    }
    if (sapCandidates.size === 0) fail('No se encontró el número de orden SAP en la cabecera.');
    if (sapCandidates.size > 1) fail(`Cabecera ambigua: varios códigos SAP posibles (${[...sapCandidates].join(', ')}).`);
    const sap = [...sapCandidates][0];
    if (sap === oc) fail('SAP y OC no pueden ser iguales.');
    partial.sap = sap;

    // --- Tienda y dirección -------------------------------------------------
    const leftLimit = Math.min(ocLabel.x, page.width * 0.62) - 4;
    const storeInfo = extractStore(page, headerLimitY, leftLimit);
    if (!storeInfo) fail('No se encontró el nombre de la tienda en la cabecera (línea "#### - TIENDA ...").');
    partial.store = storeInfo.store;
    if (!header) fail('No se encontró el encabezado de la tabla de productos (Cantidad / Precio / Total).');

    const shipLabel = findLabel(page, /^Fecha\s+de\s+Env[ií]o\s*:?$/i);
    let shipDate = '';
    if (shipLabel) {
      const v = tokensRightOf(page, shipLabel, { tol: 3 }).map((t) => t.str).find((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
      shipDate = v || '';
    }

    // --- Tabla ---------------------------------------------------------------
    const totalLabel = findLabel(page, /^TOTAL\s*:?$/i, (l) => l.y > header.y && l.x > page.width * 0.45);
    if (!totalLabel) fail('No se encontró el TOTAL de la orden.');
    const totalValueTok = tokensRightOf(page, totalLabel, { tol: 3 }).filter((t) => Number.isFinite(parseNumber(t.str, '.'))).pop();
    if (!totalValueTok) fail('No se pudo leer el valor del TOTAL de la orden.');
    const totalCents = toCents(parseNumber(totalValueTok.str, '.'));

    const lines = extractLines(page, header, totalLabel.y);
    if (!lines.length) fail('La orden no tiene líneas de productos legibles.');

    const order = {
      type: ORDER_TYPE,
      sap,
      oc,
      store: storeInfo.store,
      storeRaw: storeInfo.raw,
      storeCode: storeInfo.code,
      storeNote: storeInfo.note,
      address: storeInfo.address,
      shipDate,
      totalCents,
      lines,
      page: pageRef(page),
    };
    return { ok: true, order };
  } catch (err) {
    if (!(err instanceof OrderParseError)) throw err;
    return { ok: false, error: err.message, partial, page: pageRef(page) };
  }
}

export function pageRef(page) {
  return { fileId: page.fileId, fileName: page.fileName, pageIndex: page.pageIndex, pageNumber: page.pageNumber };
}

/** Encuentra la fila de encabezado de la tabla y los límites de cada columna. */
function findTableHeader(page) {
  for (const line of page.lines) {
    const f = line.tokens.map((t) => fold(t.str));
    const qi = f.findIndex((s) => s === 'CANTIDAD');
    const pi = f.findIndex((s) => s === 'PRECIO');
    const ti = f.findIndex((s, i) => s === 'TOTAL' && i > pi);
    if (qi < 0 || pi < 0 || ti < 0) continue;
    const tok = line.tokens;
    const find = (re) => tok.find((t) => re.test(fold(t.str)));
    const codProv = find(/^COD\.?PROV$/) || find(/^COD\.?$/);
    const desc = find(/^DESCRIPCION$/);
    const codGo = find(/^COD\.?GO$/);
    return {
      y: line.y,
      codProvX: codProv ? codProv.x : null,
      descX: desc ? desc.x : null,
      codGoX: codGo ? codGo.x : null,
      qty: { x: tok[qi].x, x1: tok[qi].x1 },
      price: { x: tok[pi].x, x1: tok[pi].x1 },
      total: { x: tok[ti].x, x1: tok[ti].x1 },
    };
  }
  return null;
}

/** Asigna un token numérico a la columna cuyo borde derecho esté más cerca (números alineados a la derecha). */
function numericColumn(tok, header) {
  const cols = [['qty', header.qty], ['price', header.price], ['total', header.total]];
  let best = null;
  for (const [name, c] of cols) {
    const d = Math.min(Math.abs(tok.x1 - c.x1), Math.abs(tok.x - c.x));
    if (!best || d < best.d) best = { name, d };
  }
  return best && best.d < 30 ? best.name : null;
}

/** Borde izquierdo de la zona numérica (evita confundir Cod.GO o la descripción con números). */
function numericZoneStart(header) {
  return header.codGoX != null ? header.codGoX + (header.qty.x - header.codGoX) * 0.6 : header.qty.x - 20;
}

function extractLines(page, header, totalY) {
  const minNumX = numericZoneStart(header);
  const bodyTokens = page.tokens.filter((t) => t.y > header.y + 2 && t.y < totalY - 2);
  // Anclas de fila: tokens numéricos en la columna Cantidad.
  const anchors = bodyTokens
    .filter((t) => t.x >= minNumX && numericColumn(t, header) === 'qty' && Number.isFinite(parseNumber(t.str, '.')))
    .sort((a, b) => a.y - b.y);
  const rows = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const top = i === 0 ? header.y + 2 : (anchors[i - 1].y + a.y) / 2;
    const bottom = i === anchors.length - 1 ? totalY - 2 : (a.y + anchors[i + 1].y) / 2;
    const band = bodyTokens.filter((t) => t.y > top && t.y <= bottom);
    rows.push(parseRow(band, header, i + 1, a));
  }
  return rows;
}

function parseRow(band, header, rowNo, qtyTok) {
  const errors = [];
  const nums = { qty: [], price: [], total: [] };
  const minNumX = numericZoneStart(header);
  for (const t of band) {
    if (t.x < minNumX) continue;
    const col = numericColumn(t, header);
    const n = parseNumber(t.str, '.');
    if (col && Number.isFinite(n)) nums[col].push(n);
  }
  const eans = new Set(band.filter((t) => /^\d{13}$/.test(t.str) && (header.descX == null || t.x < header.descX - 2)).map((t) => t.str));
  const descTokens = band.filter((t) => header.descX != null && t.x >= header.descX - 2 && (header.codGoX == null || t.x < header.codGoX - 2)).sort((a, b) => a.y - b.y || a.x - b.x);
  const description = clean(descTokens.map((t) => t.str).join(' '));
  const codGoTok = band.find((t) => /^[A-Z]{2,4}\d{3,6}(-[A-Z]{1,3})?$/i.test(t.str) && (header.codGoX == null || t.x >= header.codGoX - 4));
  const coralCode = codGoTok ? codGoTok.str.toUpperCase().replace(/-[A-Z]+$/, '') : '';
  const sizeMatch = fold(description).match(/TALLA\s+(XXL|XL|L|M|S)\b/);

  if (eans.size === 0) errors.push(`línea ${rowNo}: no se encontró el código EAN (Cod.Prov)`);
  if (eans.size > 1) errors.push(`línea ${rowNo}: varios EAN en la misma fila (${[...eans].join(', ')})`);
  if (nums.qty.length !== 1) errors.push(`línea ${rowNo}: no se pudo leer una única cantidad`);
  if (nums.price.length !== 1) errors.push(`línea ${rowNo}: no se pudo leer el precio unitario`);
  if (nums.total.length !== 1) errors.push(`línea ${rowNo}: no se pudo leer el total de la línea`);

  const ean = [...eans][0] || '';
  const product = CATALOG.byEan.get(ean) || null;
  const qty = nums.qty[0];
  const price = nums.price[0];
  const total = nums.total[0];
  return {
    rowNo,
    ean,
    eanValid: isValidEan13(ean),
    coralCode,
    description,
    sizeFromDescription: sizeMatch ? sizeMatch[1] : '',
    product,
    size: product ? product.size : '',
    qty,
    priceCents: toCents(price),
    totalCents: toCents(total),
    parseErrors: errors,
    y: qtyTok.y,
  };
}

/**
 * Nombre de tienda desde la cabecera. Quita solo el código numérico inicial y,
 * si la ciudad viene recortada (ej. "/ QU"), la completa únicamente cuando la
 * dirección del documento la confirma de forma inequívoca.
 */
function extractStore(page, headerY, leftLimit) {
  const leftLines = page.lines
    .filter((l) => l.y < headerY)
    .map((l) => ({ y: l.y, text: clean(l.tokens.filter((t) => t.x < leftLimit).map((t) => t.str).join(' ')) }))
    .filter((l) => l.text);
  const storeLine = leftLines.find((l) => /^\d{2,6}\s*-\s*\S/.test(l.text) && /TIENDA|CORAL/i.test(l.text))
    || leftLines.find((l) => /^\d{2,6}\s*-\s*[A-ZÁÉÍÓÚÑ]/i.test(l.text));
  if (!storeLine) return null;
  const m = storeLine.text.match(/^(\d{2,6})\s*-\s*(.+)$/);
  const raw = clean(m[2]);
  // Dirección
  const dirLabel = findLabel(page, /^Direcci[oó]n\s*:?$/i);
  let address = '';
  if (dirLabel) {
    const rightLabels = page.tokens.filter((t) => Math.abs(t.y - dirLabel.y) <= 3 && t.x > dirLabel.x1 + 40 && /^Fecha/i.test(t.str));
    const maxX = rightLabels.length ? Math.min(...rightLabels.map((t) => t.x)) : leftLimit;
    address = clean(tokensRightOf(page, dirLabel, { maxX, tol: 3 }).map((t) => t.str).join(' '));
  }
  const { store, note } = completeCity(raw, address);
  return { code: m[1], raw, store, note, address };
}

export function completeCity(raw, address) {
  const slash = raw.lastIndexOf('/');
  if (slash < 0) return { store: raw, note: '' };
  const head = raw.slice(0, slash).trim();
  const tail = raw.slice(slash + 1).trim();
  const tailF = fold(tail);
  if (!tailF || CONFIG.store.completeLocationWords.includes(tailF)) return { store: `${head} / ${tail}`, note: '' };
  const words = [...new Set(fold(address).split(/[^A-ZÑ0-9]+/).filter(Boolean))];
  const candidates = words.filter((w) => w.length > tailF.length && w.startsWith(tailF));
  if (candidates.length === 1) {
    return { store: `${head} / ${candidates[0]}`, note: `Ciudad completada desde la dirección: "${tail}" → "${candidates[0]}"` };
  }
  const note = candidates.length > 1
    ? `Ciudad "${tail}" no se completó: la dirección tiene varias opciones (${candidates.join(', ')}).`
    : (tailF.length <= 3 ? `Ciudad "${tail}" posiblemente recortada; la dirección no permite confirmarla.` : '');
  return { store: `${head} / ${tail}`, note };
}
