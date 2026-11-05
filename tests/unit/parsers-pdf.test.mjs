/**
 * Parsers y constructor de PDF contra documentos SINTÉTICOS generados al vuelo
 * (misma estructura que los reales, datos ficticios).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as PDFLib from 'pdf-lib';
import { makeSynthetic } from '../make-synthetic.mjs';
import { pagesFromFile, pagesFromBytes } from '../lib/node-pdf.mjs';
import { classifyAndParse } from '../../js/documents.js';
import { parseCoralOrder, looksLikeCoralOrder } from '../../js/coral-parser.js';
import { looksLikeInvoice } from '../../js/invoice-parser.js';
import { looksLikePrevalidation } from '../../js/prevalidation-parser.js';
import { buildPageModel } from '../../js/pdf-reader.js';
import { analyzeDossier, orderedRows } from '../../js/dossier.js';
import { buildDossierPdf, verifyDossier, splitSheet } from '../../js/pdf-builder.js';
import { compact } from '../../js/text-utils.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'megaflow-unit-'));
const { expected } = await makeSynthetic(dir);
const orderPages = await pagesFromFile(path.join(dir, 'ordenes.pdf'));
const invoicePages = await pagesFromFile(path.join(dir, 'facturas.pdf'));
const prePages = await pagesFromFile(path.join(dir, 'prevalidaciones.pdf'));

test('Parser de órdenes: SAP, OC, tienda, tallas y totales (cantidad solo de la columna Cantidad)', () => {
  orderPages.forEach((p, i) => {
    const r = parseCoralOrder(p);
    const e = expected.orders[i];
    assert.ok(r.ok, r.error);
    assert.equal(r.order.sap, e.sap);
    assert.equal(r.order.oc, e.oc);
    assert.equal(r.order.store, e.store);
    assert.equal(r.order.totalCents, e.subtotalCents);
    assert.deepEqual(r.order.lines.map((l) => [l.size, l.qty, l.priceCents]), e.lines.map((l) => [l.size, l.qty, l.priceCents]));
    assert.ok(r.order.lines.every((l) => /X(10|5) UND/.test(l.description)), 'la descripción conserva X10/X5 UND sin usarlo como cantidad');
  });
});

test('Parser de facturas y prevalidaciones: número, SAP, OC, REFERENCIA y totales', () => {
  const inv = invoicePages.map((p) => classifyAndParse(p, 'invoice'));
  const pre = prePages.map((p) => classifyAndParse(p, 'prevalidation'));
  for (const e of expected.orders) {
    const i = inv.find((x) => x.record?.sap === e.sap)?.record;
    const v = pre.find((x) => x.record?.sap === e.sap)?.record;
    assert.ok(i && v, e.sap);
    assert.equal(i.number, e.invoiceNumber);
    assert.equal(i.oc, e.oc);
    assert.equal(i.subtotalCents, e.subtotalCents);
    assert.equal(i.ivaCents, e.ivaCents);
    assert.equal(i.totalCents, e.totalCents);
    assert.equal(i.accessKey, e.accessKey);
    assert.equal(v.invoiceNumber, e.invoiceNumber);
    assert.equal(v.totalCents, e.totalCents);
    assert.deepEqual(v.lines.map((l) => l.qty).sort(), e.lines.map((l) => l.qty).sort());
  }
});

test('Orden sin tabla legible: se conservan SAP, OC y tienda para armar el expediente', () => {
  const p = orderPages[0];
  const header = p.lines.find((l) => /Cantidad/.test(l.text));
  const noTable = buildPageModel(p.items.filter((it) => it.y < header.y - 1 || it.y > 330), { ...p });
  const r = parseCoralOrder(noTable);
  assert.equal(r.ok, false);
  assert.equal(r.partial.sap, expected.orders[0].sap);
  assert.equal(r.partial.oc, expected.orders[0].oc);
  assert.equal(r.partial.store, expected.orders[0].store);
});

test('Clasificación: documento en el área equivocada y página sin texto', () => {
  assert.equal(classifyAndParse(invoicePages[0], 'order').kind, 'wrong-type');
  assert.equal(classifyAndParse(prePages[0], 'invoice').kind, 'wrong-type');
  const empty = buildPageModel([], { fileId: 'x', fileName: 'x.pdf', pageIndex: 0, pageNumber: 1, width: 595, height: 842 });
  assert.equal(classifyAndParse(empty, 'order').kind, 'scanned');
});

test('Robustez: el mismo resultado si PDF.js une o divide los fragmentos de texto', () => {
  const p = orderPages[2];
  // a) unir todos los fragmentos de cada línea en un único item (como hacen otras versiones de PDF.js)
  const merged = p.lines.map((l) => {
    const t = l.tokens; const x0 = t[0].x; const x1 = t[t.length - 1].x1;
    let str = ''; let cursor = x0;
    const cw = (x1 - x0) / Math.max(1, t.reduce((s, k) => s + k.str.length, 0) + t.length);
    for (const k of t) { const spaces = Math.max(1, Math.round((k.x - cursor) / cw)); str += (str ? ' '.repeat(spaces) : '') + k.str; cursor = k.x1; }
    return { str, x: x0, y: l.y, w: x1 - x0, h: t[0].h };
  });
  const rm = parseCoralOrder(buildPageModel(merged, { ...p, items: undefined }));
  // b) partir cada fragmento en caracteres sueltos
  const split = p.items.flatMap((it) => it.str.split('').map((ch, k) => ({ str: ch, x: it.x + (it.w / it.str.length) * k, y: it.y, w: it.w / it.str.length, h: it.h })));
  const rs = parseCoralOrder(buildPageModel(split.filter((c) => c.str.trim()).map((c) => c), { ...p }));
  const base = parseCoralOrder(p);
  const sig = (r) => JSON.stringify([r.order.sap, r.order.oc, r.order.totalCents, r.order.lines.map((l) => [l.ean, l.qty, l.priceCents, l.totalCents])]);
  assert.ok(rm.ok, rm.error);
  assert.equal(sig(rm), sig(base));
  assert.ok(base.ok);
  // Con caracteres sueltos los tokens son de una letra: el parser debe fallar de forma controlada, nunca inventar datos.
  if (rs.ok) assert.equal(sig(rs), sig(base));
  else assert.equal(typeof rs.error, 'string');
});

const helpers = { compact, isInvoice: looksLikeInvoice, isOrder: looksLikeCoralOrder, isPreval: looksLikePrevalidation };
async function buildSynthetic(layout) {
  const docs = (pages, t) => pages.map((p) => classifyAndParse(p, t));
  const a = analyzeDossier({ orderDocs: docs(orderPages, 'order'), invoiceDocs: docs(invoicePages, 'invoice'), preDocs: docs(prePages, 'prevalidation') });
  assert.equal(a.canGenerate, true);
  const getBytes = async (id) => new Uint8Array(fs.readFileSync(path.join(dir, id)));
  return buildDossierPdf(PDFLib, orderedRows(a, 'orders'), getBytes, () => {}, { layout });
}

test('PDF final (predeterminado): A4 horizontal, 2 páginas por hoja — hoja 1 factura | copia, hoja 2 orden | prevalidación', async () => {
  const built = await buildSynthetic(undefined);
  const n = expected.orders.length;
  assert.equal(built.layout.id, 'a4-2up');
  assert.equal(built.pageCount, n * 4);
  assert.equal(built.sheetCount, n * 2);
  const out = await pagesFromBytes(built.bytes, 'salida.pdf');
  assert.equal(out.length, n * 2);
  assert.ok(out.every((p) => Math.abs(p.width - 841.89) < 0.5 && Math.abs(p.height - 595.276) < 0.5), 'todas las hojas son A4 horizontal');
  assert.deepEqual(verifyDossier(out, built.plan, helpers, built.layout).blocking, []);
  assert.deepEqual(verifyDossier(out, built.plan, helpers, built.layout).warnings, []);
  for (let k = 0; k < n; k++) {
    const [f, c] = splitSheet(out[2 * k], built.layout);
    const [o, v] = splitSheet(out[2 * k + 1], built.layout);
    assert.ok(looksLikeInvoice(f) && looksLikeInvoice(c) && looksLikeCoralOrder(o) && looksLikePrevalidation(v), `pedido ${k + 1}`);
    assert.equal(compact(f.text), compact(c.text), 'la copia es idéntica a la factura');
    assert.ok(compact(f.text).includes(expected.orders[k].invoiceNumber));
    assert.ok(compact(o.text).includes(expected.orders[k].sap) && compact(v.text).includes(expected.orders[k].sap));
  }
  // Cada media hoja contiene solo su página (nada cruza la línea central).
  assert.ok(built.plan.every((p) => p.rect.width === 841.89 / 2 && p.rect.x === p.slot * (841.89 / 2)));
});

test('PDF final (opción A5): 4 páginas A5 por pedido', async () => {
  const built = await buildSynthetic('a5');
  const out = await pagesFromBytes(built.bytes, 'salida.pdf');
  assert.equal(out.length, expected.orders.length * 4);
  assert.deepEqual(verifyDossier(out, built.plan, helpers, built.layout), { blocking: [], warnings: [], virtualPages: out });
  assert.ok(out.every((p) => Math.abs(p.width - 419.528) < 0.5 && Math.abs(p.height - 595.276) < 0.5));
});

test('PDF final: páginas de origen rotadas se colocan derechas y sin recorte', async () => {
  const src = await PDFLib.PDFDocument.create();
  const font = await src.embedFont(PDFLib.StandardFonts.Helvetica);
  const pg = src.addPage([595, 842]);
  // Caso típico de documento horizontal: el contenido está girado y /Rotate 90 lo muestra derecho.
  pg.drawText('PAGINA ROTADA DE PRUEBA 12345', { x: 100, y: 80, size: 18, font, rotate: PDFLib.degrees(90) });
  pg.setRotation(PDFLib.degrees(90));
  const bytes = await src.save();
  const srcPages = await pagesFromBytes(bytes, 'r.pdf');
  assert.ok(compact(srcPages[0].text).includes('PAGINAROTADADEPRUEBA12345'), 'en el visor la página original se lee derecha');
  const ref = { fileId: 'r', fileName: 'r.pdf', pageIndex: 0, pageNumber: 1 };
  const fake = [{ sap: 'XX000001', invoice: { page: ref, number: '001-001-000000001' }, order: { page: ref }, preval: { page: ref } }];
  const built = await buildDossierPdf(PDFLib, fake, async () => bytes, () => {}, { layout: 'a5' });
  const out = await pagesFromBytes(built.bytes, 'rot.pdf');
  assert.equal(out.length, 4);
  // El texto se extrae horizontal (las líneas giradas se descartan en el modelo): la página quedó derecha, igual que en el visor.
  assert.ok(compact(out[0].text).includes('PAGINAROTADADEPRUEBA12345'), out[0].text);
  for (const it of out[0].items) assert.ok(it.x >= 0 && it.x <= 419.6 && it.y >= 0 && it.y <= 595.3);
  // En A4 horizontal (2 por hoja) también queda derecha y dentro de su mitad.
  const built2 = await buildDossierPdf(PDFLib, fake, async () => bytes);
  const out2 = await pagesFromBytes(built2.bytes, 'rot2.pdf');
  assert.equal(out2.length, 2);
  const [left, right] = splitSheet(out2[0], built2.layout);
  assert.ok(compact(left.text).includes('PAGINAROTADADEPRUEBA12345') && compact(right.text).includes('PAGINAROTADADEPRUEBA12345'));
  for (const it of left.items) assert.ok(it.x >= 0 && it.x <= 420.95);
});
