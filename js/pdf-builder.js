/**
 * Construcción del EXPEDIENTE PDF final con pdf-lib.
 *
 * Por cada pedido, 4 páginas A5 vertical consecutivas:
 *   1) factura original  2) copia idéntica de la factura  3) orden de compra  4) prevalidación
 *
 * Funciona igual que IMPRIMIR un A4 en hoja A5 con "Ajustar a la página": cada página
 * original se reduce proporcionalmente y se centra (A4 y A5 tienen la misma proporción,
 * así que la página ocupa la hoja completa). No se convierte en imagen ni se reconstruye:
 * cada página fuente se incrusta UNA vez como objeto vectorial (Form XObject). La copia de la factura reutiliza el mismo
 * objeto, por lo que es visualmente idéntica a la original. Textos, códigos de barras
 * y QR conservan su calidad vectorial.
 */
import { CONFIG } from './config.js';

/**
 * @param {object} PDFLib  librería pdf-lib (window.PDFLib o require('pdf-lib'))
 * @param {Array} rows     filas del matching ya validadas y ordenadas
 * @param {(fileId:string)=>Promise<Uint8Array>} getBytes  lee los bytes del archivo original
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {Promise<{bytes:Uint8Array, pageCount:number, plan:Array}>}
 */
export async function buildDossierPdf(PDFLib, rows, getBytes, onProgress = () => {}) {
  const { PDFDocument, degrees } = PDFLib;
  const out = await PDFDocument.create();
  out.setTitle('Expedientes Coral');
  out.setCreator('MegaFlow — Mega Suministros SAS');
  out.setProducer('MegaFlow (pdf-lib)');
  const W = CONFIG.dossier.pageWidth;
  const H = CONFIG.dossier.pageHeight;

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

  for (let i = 0; i < plan.length; i++) {
    const { emb, rotation } = await embed(plan[i].ref);
    const quarter = rotation === 90 || rotation === 270;
    const dispW = quarter ? emb.height : emb.width;
    const dispH = quarter ? emb.width : emb.height;
    const s = Math.min(W / dispW, H / dispH);
    const X = (W - dispW * s) / 2;
    const Y = (H - dispH * s) / 2;
    const page = out.addPage([W, H]);
    const w = emb.width * s;
    const h = emb.height * s;
    let x = X;
    let y = Y;
    if (rotation === 90) y = Y + w;
    else if (rotation === 180) { x = X + w; y = Y + h; }
    else if (rotation === 270) x = X + h;
    page.drawPage(emb, { x, y, width: w, height: h, rotate: degrees(-rotation) });
    plan[i].outputPage = i + 1;
    if (i % 8 === 7 || i === plan.length - 1) {
      onProgress(i + 1, plan.length);
      await new Promise((res) => setTimeout(res, 0)); // cede el hilo para no congelar la interfaz
    }
  }

  const expected = rows.length * CONFIG.dossier.pagesPerOrder;
  if (out.getPageCount() !== expected) throw new Error(`El PDF tiene ${out.getPageCount()} páginas y se esperaban ${expected}.`);
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pageCount: expected, plan };
}

/**
 * Verificación posterior: el PDF generado se vuelve a leer con PDF.js.
 *  - blocking: cantidad de páginas y tamaño A5 (si fallan, el archivo no es el esperado).
 *  - warnings: comprobaciones de contenido por página (informativas; no impiden descargar).
 * @param {Array} pages modelos de página del PDF generado
 * @param {Array} plan  plan devuelto por buildDossierPdf
 * @param {{compact:(s:string)=>string, isInvoice:Function, isOrder:Function, isPreval:Function}} h
 */
export function verifyDossier(pages, plan, h) {
  const blocking = [];
  const warnings = [];
  if (pages.length !== plan.length) blocking.push(`El PDF generado tiene ${pages.length} páginas; se esperaban ${plan.length}.`);
  const W = CONFIG.dossier.pageWidth;
  const H = CONFIG.dossier.pageHeight;
  for (let i = 0; i < Math.min(pages.length, plan.length); i++) {
    const p = pages[i];
    const step = plan[i];
    if (Math.abs(p.width - W) > 1 || Math.abs(p.height - H) > 1) blocking.push(`Página ${i + 1}: tamaño ${p.width.toFixed(0)}×${p.height.toFixed(0)} pt, no es A5.`);
    const t = h.compact(p.text);
    const typeOk = step.role.startsWith('invoice') ? h.isInvoice(p) : step.role === 'order' ? h.isOrder(p) : h.isPreval(p);
    const need = step.role.startsWith('invoice') ? step.invoiceNumber : step.sap;
    if (!typeOk || !t.includes(need)) warnings.push(`Página ${i + 1} (${roleLabel(step.role)} de ${step.sap}): no se pudo confirmar automáticamente su contenido; revísala.`);
    if (step.role === 'invoice-copy' && pages[i - 1] && h.compact(pages[i - 1].text) !== t) warnings.push(`Página ${i + 1}: la copia no se pudo confirmar idéntica a la factura original; revísala.`);
  }
  return { blocking, warnings };
}

export const roleLabel = (r) => ({ invoice: 'Factura original', 'invoice-copy': 'Copia de factura', order: 'Orden de compra', prevalidation: 'Prevalidación' }[r] || r);
