/**
 * Construcción del EXPEDIENTE PDF final con pdf-lib.
 *
 * Por cada pedido hay 4 páginas lógicas, en este orden:
 *   1) factura original  2) copia idéntica de la factura  3) orden de compra  4) prevalidación
 *
 * Formato predeterminado 'a4-2up': hojas A4 HORIZONTALES con dos páginas lado a lado,
 * para imprimir en A4 y cortar por la mitad:
 *   hoja 1 = factura | copia      hoja 2 = orden de compra | prevalidación
 * (cada pedido ocupa exactamente 2 hojas). Formato alternativo 'a5': una página A5 por hoja.
 *
 * Funciona igual que imprimir "2 páginas por hoja": cada página original se reduce
 * proporcionalmente para caber en su mitad y se centra. No se convierte en imagen ni se
 * reconstruye: cada página fuente se incrusta UNA vez como objeto vectorial (Form XObject).
 * La copia de la factura reutiliza el mismo objeto, por lo que es idéntica a la original.
 */
import { CONFIG } from './config.js';
import { buildPageModel } from './pdf-reader.js';

export const getLayout = (id) => CONFIG.dossier.layouts[id] || CONFIG.dossier.layouts[CONFIG.dossier.defaultLayout];

/** Rectángulo (en puntos, origen abajo-izquierda) de la posición `slot` dentro de la hoja. */
export function slotRect(layout, slot) {
  const w = layout.sheetWidth / layout.slots;
  return { x: slot * w, y: 0, width: w, height: layout.sheetHeight };
}

/** Cantidad de hojas que tendrá el PDF para `orders` pedidos. */
export const sheetCount = (orders, layoutId) => Math.ceil((orders * CONFIG.dossier.pagesPerOrder) / getLayout(layoutId).slots);

/**
 * @param {object} PDFLib  librería pdf-lib (window.PDFLib o require('pdf-lib'))
 * @param {Array} rows     filas del matching ya validadas y ordenadas
 * @param {(fileId:string)=>Promise<Uint8Array>} getBytes  lee los bytes del archivo original
 * @param {(done:number,total:number)=>void} onProgress
 * @param {{layout?:string, cutLine?:boolean}} options
 * @returns {Promise<{bytes:Uint8Array, pageCount:number, sheetCount:number, plan:Array, layout:object}>}
 */
export async function buildDossierPdf(PDFLib, rows, getBytes, onProgress = () => {}, options = {}) {
  const { PDFDocument, degrees, rgb } = PDFLib;
  const layoutId = options.layout || CONFIG.dossier.defaultLayout;
  const layout = getLayout(layoutId);
  const cutLine = layout.slots > 1 && (options.cutLine ?? CONFIG.dossier.cutLine);
  const out = await PDFDocument.create();
  out.setTitle('Expedientes Coral');
  out.setCreator('MegaFlow — Mega Suministros SAS');
  out.setProducer('MegaFlow (pdf-lib)');

  const srcDocs = new Map(); // fileId -> PDFDocument
  const embedded = new Map(); // fileId#pageIndex -> { emb, rotation }
  const plan = [];
  for (const r of rows) {
    plan.push({ sap: r.sap, role: 'invoice', ref: r.invoice.page, invoiceNumber: r.invoice.number });
    plan.push({ sap: r.sap, role: 'invoice-copy', ref: r.invoice.page, invoiceNumber: r.invoice.number });
    plan.push({ sap: r.sap, role: 'order', ref: r.order.page });
    plan.push({ sap: r.sap, role: 'prevalidation', ref: r.preval.page });
  }

  async function sourceDoc(fileId) {
    if (!srcDocs.has(fileId)) {
      const bytes = await getBytes(fileId);
      srcDocs.set(fileId, await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false }));
    }
    return srcDocs.get(fileId);
  }

  async function embed(ref) {
    const k = `${ref.fileId}#${ref.pageIndex}`;
    if (!embedded.has(k)) {
      const doc = await sourceDoc(ref.fileId);
      const page = doc.getPage(ref.pageIndex);
      const crop = page.getCropBox();
      const box = { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height };
      const emb = await out.embedPage(page, box);
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      embedded.set(k, { emb, rotation });
    }
    return embedded.get(k);
  }

  /** Dibuja una página fuente reducida y centrada dentro del rectángulo indicado. */
  function place(sheet, emb, rotation, rect) {
    const quarter = rotation === 90 || rotation === 270;
    const dispW = quarter ? emb.height : emb.width;
    const dispH = quarter ? emb.width : emb.height;
    const s = Math.min(rect.width / dispW, rect.height / dispH);
    const X = rect.x + (rect.width - dispW * s) / 2;
    const Y = rect.y + (rect.height - dispH * s) / 2;
    const w = emb.width * s;
    const h = emb.height * s;
    let x = X;
    let y = Y;
    if (rotation === 90) y = Y + w;
    else if (rotation === 180) { x = X + w; y = Y + h; }
    else if (rotation === 270) x = X + h;
    sheet.drawPage(emb, { x, y, width: w, height: h, rotate: degrees(-rotation) });
    return s;
  }

  let sheet = null;
  for (let i = 0; i < plan.length; i++) {
    const slot = i % layout.slots;
    if (slot === 0) sheet = out.addPage([layout.sheetWidth, layout.sheetHeight]);
    const { emb, rotation } = await embed(plan[i].ref);
    const rect = slotRect(layout, slot);
    plan[i].scale = place(sheet, emb, rotation, rect);
    plan[i].sheet = out.getPageCount();
    plan[i].slot = slot;
    plan[i].rect = rect;
    // Línea de corte: se dibuja cuando la hoja ya tiene sus dos páginas.
    if (cutLine && slot === layout.slots - 1) {
      for (let k = 1; k < layout.slots; k++) {
        const xCut = (layout.sheetWidth / layout.slots) * k;
        sheet.drawLine({ start: { x: xCut, y: 0 }, end: { x: xCut, y: layout.sheetHeight }, thickness: 0.4, color: rgb(0.62, 0.62, 0.62), dashArray: [4, 3], opacity: 0.9 });
      }
    }
    if (i % 8 === 7 || i === plan.length - 1) {
      onProgress(i + 1, plan.length);
      await new Promise((res) => setTimeout(res, 0)); // cede el hilo para no congelar la interfaz
    }
  }

  const expectedSheets = Math.ceil(plan.length / layout.slots);
  if (out.getPageCount() !== expectedSheets) throw new Error(`El PDF tiene ${out.getPageCount()} hojas y se esperaban ${expectedSheets}.`);
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pageCount: plan.length, sheetCount: expectedSheets, plan, layout: { id: layoutId, ...layout } };
}

/**
 * Divide el modelo de texto de una hoja en sus posiciones (izquierda/derecha) para
 * revisar cada página lógica por separado. Las coordenadas del modelo tienen origen arriba.
 */
export function splitSheet(sheetModel, layout) {
  const out = [];
  const w = sheetModel.width / layout.slots;
  for (let k = 0; k < layout.slots; k++) {
    const x0 = k * w;
    const items = sheetModel.items.filter((it) => it.x >= x0 - 0.5 && it.x < x0 + w - 0.5).map((it) => ({ ...it, x: it.x - x0 }));
    out.push(buildPageModel(items, { ...sheetModel, items: undefined, width: w, height: sheetModel.height, slot: k }));
  }
  return out;
}

/**
 * Verificación posterior: el PDF generado se vuelve a leer con PDF.js.
 *  - blocking: cantidad de hojas y tamaño de hoja (si fallan, el archivo no es el esperado).
 *  - warnings: comprobaciones de contenido de cada página (informativas; no impiden descargar).
 * @param {Array} sheets modelos de página (hojas) del PDF generado
 * @param {Array} plan   plan devuelto por buildDossierPdf
 * @param {{compact:(s:string)=>string, isInvoice:Function, isOrder:Function, isPreval:Function}} h
 * @param {object} layout formato usado (built.layout)
 */
export function verifyDossier(sheets, plan, h, layout = { ...getLayout(CONFIG.dossier.defaultLayout) }) {
  const blocking = [];
  const warnings = [];
  const expectedSheets = Math.ceil(plan.length / layout.slots);
  if (sheets.length !== expectedSheets) blocking.push(`El PDF generado tiene ${sheets.length} hojas; se esperaban ${expectedSheets}.`);
  const name = layout.slots > 1 ? 'A4 horizontal' : 'A5 vertical';
  for (const [i, s] of sheets.entries()) {
    if (Math.abs(s.width - layout.sheetWidth) > 1 || Math.abs(s.height - layout.sheetHeight) > 1) blocking.push(`Hoja ${i + 1}: tamaño ${s.width.toFixed(0)}×${s.height.toFixed(0)} pt, no es ${name}.`);
  }
  const virtual = sheets.flatMap((s) => (layout.slots > 1 ? splitSheet(s, layout) : [s]));
  const side = (i) => (layout.slots > 1 ? ` (hoja ${Math.floor(i / layout.slots) + 1}, ${i % layout.slots === 0 ? 'izquierda' : 'derecha'})` : ` (página ${i + 1})`);
  for (let i = 0; i < Math.min(virtual.length, plan.length); i++) {
    const p = virtual[i];
    const step = plan[i];
    const t = h.compact(p.text);
    const typeOk = step.role.startsWith('invoice') ? h.isInvoice(p) : step.role === 'order' ? h.isOrder(p) : h.isPreval(p);
    const need = step.role.startsWith('invoice') ? step.invoiceNumber : step.sap;
    if (!typeOk || !t.includes(need)) warnings.push(`${roleLabel(step.role)} de ${step.sap}${side(i)}: no se pudo confirmar automáticamente su contenido; revísala.`);
    if (step.role === 'invoice-copy' && virtual[i - 1] && h.compact(virtual[i - 1].text) !== t) warnings.push(`Copia de factura de ${step.sap}${side(i)}: no se pudo confirmar idéntica a la original; revísala.`);
  }
  return { blocking, warnings, virtualPages: virtual };
}

export const roleLabel = (r) => ({ invoice: 'Factura original', 'invoice-copy': 'Copia de factura', order: 'Orden de compra', prevalidation: 'Prevalidación' }[r] || r);
