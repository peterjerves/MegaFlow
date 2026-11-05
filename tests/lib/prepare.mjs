/**
 * Prepara las variantes de entrada para las pruebas a partir de tres PDF fuente:
 *  - órdenes, facturas y prevalidaciones consolidadas (copias)
 *  - cada PDF dividido en archivos de UNA página (individuales)
 *  - prevalidaciones y facturas DESORDENADAS (permutación con semilla fija)
 *  - prevalidaciones con UNA página quitada (prueba de faltantes)
 *  - archivos inválidos: no PDF, vacío, dañado, escaneado (imagen sin texto), con contraseña
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument, rgb } from 'pdf-lib';

function seededShuffle(arr, seed = 20261030) {
  const a = [...arr];
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function subset(srcBytes, indices) {
  const src = await PDFDocument.load(srcBytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

export async function prepareInputs({ orders, invoices, prevals, outDir }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const P = (...x) => path.join(outDir, ...x);
  const read = (f) => fs.readFileSync(f);
  const o = read(orders); const i = read(invoices); const p = read(prevals);
  fs.writeFileSync(P('ordenes.pdf'), o);
  fs.writeFileSync(P('facturas.pdf'), i);
  fs.writeFileSync(P('prevalidaciones.pdf'), p);

  const count = async (b) => (await PDFDocument.load(b)).getPageCount();
  const [no, ni, np] = [await count(o), await count(i), await count(p)];

  const split = async (bytes, n, dir, prefix, order) => {
    fs.mkdirSync(P(dir), { recursive: true });
    const files = [];
    for (const [k, idx] of order.entries()) {
      const f = P(dir, `${prefix}_${String(k + 1).padStart(3, '0')}.pdf`);
      fs.writeFileSync(f, await subset(bytes, [idx]));
      files.push(f);
    }
    return files;
  };
  const range = (n) => [...Array(n).keys()];
  const orderFiles = await split(o, no, 'ordenes_individuales', 'orden', range(no));
  const invoiceOrder = seededShuffle(range(ni), 7);
  const invoiceFiles = await split(i, ni, 'facturas_individuales', 'factura', invoiceOrder);
  const preOrder = seededShuffle(range(np), 11);
  fs.writeFileSync(P('prevalidaciones_desordenadas.pdf'), await subset(p, preOrder));
  const removedIndex = preOrder[Math.floor(np / 2)];
  fs.writeFileSync(P('prevalidaciones_falta_una.pdf'), await subset(p, preOrder.filter((x) => x !== removedIndex)));
  const ordersShuffled = seededShuffle(range(no), 3);
  fs.writeFileSync(P('ordenes_desordenadas.pdf'), await subset(o, ordersShuffled));

  // --- Archivos inválidos ---------------------------------------------------
  fs.writeFileSync(P('no_es_pdf.txt'), 'Este archivo no es un PDF.');
  fs.writeFileSync(P('vacio.pdf'), Buffer.alloc(0));
  fs.writeFileSync(P('danado.pdf'), Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(Array.from({ length: 4000 }, (_, k) => (k * 37) % 256))]));
  // Escaneado: una página que solo contiene un dibujo (sin texto seleccionable).
  const scan = await PDFDocument.create();
  const sp = scan.addPage([595, 842]);
  for (let k = 0; k < 40; k++) sp.drawRectangle({ x: 40 + (k % 8) * 60, y: 700 - Math.floor(k / 8) * 40, width: 50, height: 12, color: rgb(0.2, 0.2, 0.2) });
  fs.writeFileSync(P('escaneado.pdf'), await scan.save());
  let protectedFile = null;
  try {
    execFileSync('qpdf', ['--encrypt', 'clave123', 'clave123', '256', '--', P('escaneado.pdf'), P('con_contrasena.pdf')], { stdio: 'ignore' });
    protectedFile = P('con_contrasena.pdf');
  } catch { /* qpdf no disponible: la prueba se marcará como no ejecutada */ }

  return {
    dir: outDir,
    counts: { orders: no, invoices: ni, prevals: np },
    orders: P('ordenes.pdf'), ordersShuffled: P('ordenes_desordenadas.pdf'), orderFiles,
    invoices: P('facturas.pdf'), invoiceFiles,
    prevals: P('prevalidaciones.pdf'), prevalsShuffled: P('prevalidaciones_desordenadas.pdf'),
    prevalsMissingOne: P('prevalidaciones_falta_una.pdf'), removedPrevalIndex: removedIndex,
    invalid: { txt: P('no_es_pdf.txt'), empty: P('vacio.pdf'), corrupt: P('danado.pdf'), scanned: P('escaneado.pdf'), protected: protectedFile },
  };
}
