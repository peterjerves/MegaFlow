/**
 * Genera documentos SINTÉTICOS (datos ficticios) que imitan la estructura de los PDF
 * reales de Coral y Mega Suministros, para probar MegaFlow sin usar documentos reales.
 *
 * Crea en tests/fixtures/ (o en la carpeta indicada):
 *   ordenes.pdf, facturas.pdf, prevalidaciones.pdf y esperado.json
 *
 * Incluye a propósito: números de factura con letras espaciadas, descripciones con
 * "X10 UND"/"X5 UND", ciudades recortadas en la cabecera ("/ GUAYAQ", "/ QU"),
 * dos órdenes de la misma tienda, marca de agua rotada "REIMPRESION" y QR dibujado.
 *
 * Uso: node tests/make-synthetic.mjs [carpeta] [cantidad_de_pedidos]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { sriCheckDigit } from '../js/text-utils.js';
import { CATALOG } from '../js/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SYNTHETIC_ORDERS = [
  { sap: 'NT100001', oc: '5609000001', code: '1501', header: 'TIENDA CORAL NORTE PRUEBA / GUAYAQ', address: 'GUAYAQUIL, AV DE PRUEBA 123', store: 'TIENDA CORAL NORTE PRUEBA / GUAYAQUIL', lines: [['L', 30], ['XL', 10]] },
  { sap: 'NT100002', oc: '5609000002', code: '1501', header: 'TIENDA CORAL NORTE PRUEBA / GUAYAQ', address: 'GUAYAQUIL, AV DE PRUEBA 123', store: 'TIENDA CORAL NORTE PRUEBA / GUAYAQUIL', lines: [['L', 10]] },
  { sap: 'SL200003', oc: '5609000003', code: '1502', header: 'TIENDA CORAL SUR DE LA CIUDAD / QU', address: 'QUITO, CALLE FICTICIA Y OTRA', store: 'TIENDA CORAL SUR DE LA CIUDAD / QUITO', lines: [['M', 12], ['L', 10], ['XL', 10]] },
  { sap: 'CE300004', oc: '5609000004', code: '1503', header: 'TIENDA CORAL CENTRO DEMO / CUENCA', address: 'CUENCA, AV SIMULADA', store: 'TIENDA CORAL CENTRO DEMO / CUENCA', lines: [['M', 12]] },
  { sap: 'PL400005', oc: '5609000005', code: '1504', header: 'TIENDA CORAL PLAYA DEMO', address: 'MANTA, MALECON DE PRUEBA', store: 'TIENDA CORAL PLAYA DEMO', lines: [['XL', 20]] },
  { sap: 'VA500006', oc: '5609000006', code: '1505', header: 'TIENDA CORAL VALLE DEMO / GUAYAS', address: 'GUAYAQUIL,AV INVENTADA', store: 'TIENDA CORAL VALLE DEMO / GUAYAS', lines: [['L', 20], ['M', 24]] },
];

const DESC = { M: 'PADS ENTRENAMIENTO LUCKY PET TALLA M - 45X60CM -', L: 'PADS ENTRENAMIENTO LUCKY PET TALLA L - 60X60CM -', XL: 'PADS ENTRENAMIENTO LUCKY PET TALLA XL - 60X90CM -' };
const PACK = { M: 'X10 UND', L: 'X10 UND', XL: 'X5 UND' };
const num = (n) => String(Math.round(n * 100) / 100); // estilo Coral: 67.5, 2, 24
const comma = (n, d) => n.toFixed(d).replace('.', ',');
const spaced = (s) => s.split('').join(' ');

function accessKey(invoiceSeq) {
  const base = `01112026` + '01' + '0195168598001' + '2' + '001001' + String(invoiceSeq).padStart(9, '0') + '31215214' + '1';
  return base + sriCheckDigit(base);
}

export async function makeSynthetic(outDir = path.join(HERE, 'fixtures'), count = SYNTHETIC_ORDERS.length) {
  const base = SYNTHETIC_ORDERS;
  const list = count <= base.length ? base.slice(0, count) : Array.from({ length: count }, (_, k) => {
    const t = base[k % base.length];
    return { ...t, sap: t.sap.slice(0, 2) + String(100001 + k).padStart(6, '0'), oc: `56${String(10000000 + k).padStart(8, '0')}` };
  });
  fs.mkdirSync(outDir, { recursive: true });
  const ordersDoc = await PDFDocument.create();
  const invDoc = await PDFDocument.create();
  const preDoc = await PDFDocument.create();
  const fonts = async (d) => ({ r: await d.embedFont(StandardFonts.Helvetica), b: await d.embedFont(StandardFonts.HelveticaBold), i: await d.embedFont(StandardFonts.HelveticaOblique) });
  const fo = await fonts(ordersDoc); const fi = await fonts(invDoc); const fp = await fonts(preDoc);
  const H = 842;
  const T = (page, str, x, yTop, size, font, color = rgb(0, 0, 0)) => page.drawText(str, { x, y: H - yTop, size, font, color });
  const R = (page, str, xRight, yTop, size, font) => T(page, str, xRight - font.widthOfTextAtSize(str, size), yTop, size, font);
  const expected = { orders: [] };

  list.forEach((o, k) => {
    const lines = o.lines.map(([size, qty]) => { const p = CATALOG.bySize.get(size); return { size, qty, ean: p.ean, code: p.coralCode, priceCents: Math.round(p.price * 100), totalCents: qty * Math.round(p.price * 100) }; });
    const sub = lines.reduce((s, l) => s + l.totalCents, 0);
    const iva = Math.round((sub * 15) / 100);
    const seq = 901 + k;
    const invoiceNumber = `001-001-${String(seq).padStart(9, '0')}`;
    const key = accessKey(seq);
    expected.orders.push({ ...o, invoiceNumber, accessKey: key, subtotalCents: sub, ivaCents: iva, totalCents: sub + iva, lines });

    // ---------------- Orden Coral
    const pg = ordersDoc.addPage([595, 842]);
    const f = fo;
    T(pg, 'GERARDO ORTIZ E HIJOS CIA', 82, 29.8, 10, f.r);
    R(pg, o.sap, 572, 37.1, 16, f.r);
    T(pg, `${o.code} - ${o.header}`, 82, 41.8, 10, f.r, rgb(0.85, 0.1, 0.1));
    T(pg, 'Ped. Compra:', 452, 51, 8, f.r); T(pg, o.oc, 516.4, 51.8, 10, f.r);
    T(pg, 'MEGASUMINISTROS S.A.S.', 82, 53.8, 10, f.r);
    T(pg, 'RUC/Código:', 22, 64, 8, f.r); T(pg, '0195168598001 / Cod.GO: 0020090943 / Cod.SAP:0020090943', 82, 64, 8, f.r);
    T(pg, 'Fecha de Envío:', 322, 64, 8, f.r); T(pg, '2026-10-30', 412, 64, 8, f.r);
    T(pg, 'Dirección:', 22, 74, 8, f.r); T(pg, o.address, 82, 74, 8, f.r);
    T(pg, 'Fecha. Limit. Entrega:', 322, 74, 8, f.r); T(pg, '2026-11-04', 412, 74, 8, f.r);
    T(pg, 'Creado por:', 22, 84, 8, f.r); T(pg, 'SERVICE@2026-10-30 21:51', 82, 84, 8, f.r);
    T(pg, 'Autorizado por:', 322, 84, 8, f.r); T(pg, 'SERVICE@2026-10-30 21:51', 392, 84, 8, f.r);
    T(pg, 'Observaciones:', 22, 94, 8, f.r); T(pg, 'null', 82, 94, 8, f.r);
    T(pg, 'Correos:', 22, 104, 8, f.r); T(pg, 'null', 82, 103.6, 8, f.r);
    pg.drawRectangle({ x: 20, y: H - 119, width: 555, height: 11, color: rgb(0.2, 0.33, 0.6) });
    const wh = rgb(1, 1, 1);
    for (const [s, x] of [['#', 22], ['Cod.Prov', 42], ['Descripción', 122], ['Cod.GO', 357], ['Cantidad', 431], ['Precio', 490.3], ['Total', 555.2]]) T(pg, s, x, 116, 8, f.r, wh);
    lines.forEach((l, i) => {
      const y = 133 + 20 * i;
      T(pg, String(i + 1), 22, y, 8, f.r);
      T(pg, l.ean, 42, y - 4.6, 8, f.r); T(pg, l.ean, 42, y + 4.6, 8, f.r);
      T(pg, DESC[l.size], 122, y - 4.6, 8, f.r); T(pg, PACK[l.size], 122, y + 4.6, 8, f.r);
      T(pg, `${l.code}-UN`, 357, y, 8, f.r);
      R(pg, String(l.qty), 463, y, 8, f.r); R(pg, num(l.priceCents / 100), 513, y, 8, f.r); R(pg, num(l.totalCents / 100), 573, y, 8, f.r);
    });
    const ty = 133 + 20 * (lines.length - 1) + 17;
    T(pg, 'Impreso el 2026-10-31 12:12:07', 22, ty + 1, 8, f.r); T(pg, 'TOTAL:', 435, ty, 8, f.r); R(pg, num(sub / 100), 573, ty, 8, f.r);
    pg.drawText('REIMPRESION', { x: 149, y: H - 359, size: 60, font: f.b, color: rgb(0.8, 0.8, 0.8), rotate: degrees(45), opacity: 0.6 });

    // ---------------- Factura Mega Suministros
    const ip = invDoc.addPage([595, 842]);
    const g = fi;
    T(ip, spaced('Factura').replace('F a', 'Fa'), 356.5, 48.8, 12.8, g.r);
    T(ip, spaced('MEGASUMINISTROS SAS'), 41, 64.2, 10, g.r);
    T(ip, spaced(invoiceNumber), 313.3, 64.2, 12.8, g.r);
    T(ip, 'Registro Unico de Contribuyente:', 55, 77, 7, g.b);
    T(ip, `Número de autorización: ${key}`, 232, 82.7, 7, g.b);
    T(ip, '0195168598001', 82, 88.5, 7, g.r);
    for (let b = 0; b < 120; b++) if ((b * 7) % 3) ip.drawRectangle({ x: 232 + b * 2.6, y: H - 128, width: 1.3, height: 38, color: rgb(0, 0, 0) });
    T(ip, `Clave de acceso: ${key}`, 246, 131.4, 7, g.b);
    T(ip, 'Razón Social/Nombres y Apellidos', 26.2, 153.6, 7, g.r); T(ip, 'Fecha de factura', 161.9, 153.6, 7, g.r); T(ip, 'Fecha límite', 297.6, 153.6, 7, g.r); T(ip, 'Motivo de la modificación', 433.3, 153.6, 7, g.r);
    T(ip, 'Gerardo Ortiz e Hijos Cia. Ltda.', 26.2, 160.6, 7, g.r); T(ip, '01/11/2026', 161.9, 160.6, 7, g.r); T(ip, '01/02/2027', 297.6, 160.6, 7, g.r); T(ip, `OC ${o.oc} / SAP ${o.sap}`, 433.3, 160.6, 7, g.r);
    T(ip, 'Registro Unico de Contribuyente:', 26.2, 167.7, 7, g.r); T(ip, '0190072002001', 26.2, 174.7, 7, g.r);
    T(ip, 'Descripción', 124.8, 199, 7, g.r); T(ip, 'Código', 94.7, 203.5, 7, g.r); T(ip, 'Auxiliar', 94.7, 210.6, 7, g.r);
    T(ip, 'Código Principal', 31.4, 206.7, 7, g.r); T(ip, 'Cantidad', 403.8, 206.7, 7, g.r); T(ip, 'Precio unitario', 441.6, 206.7, 7, g.r); T(ip, 'Impuestos', 497.3, 206.7, 7, g.r); T(ip, 'Importe', 539.5, 206.7, 7, g.r);
    lines.forEach((l, i) => {
      const y = 228.5 + 24.3 * i;
      T(ip, l.ean, 31.4, y, 7, g.r);
      R(ip, comma(l.qty, 6), 431.6, y, 7, g.r); R(ip, 'Unidades', 431.6, y + 7, 7, g.r);
      R(ip, comma(l.priceCents / 100, 6), 486.9, y, 7, g.r);
      T(ip, 'IVA 15%', 502, y, 7, g.r); T(ip, '$', 540.2, y, 7, g.r); R(ip, comma(l.totalCents / 100, 2), 564, y, 7, g.r);
    });
    const ny = 228.5 + 24.3 * lines.length;
    T(ip, o.store, 31.4, ny, 7, g.i); T(ip, `SAP: ${o.sap}`, 31.4, ny + 7.1, 7, g.i); T(ip, `OC: ${o.oc}`, 31.4, ny + 14.1, 7, g.i);
    const sy = ny + 35.2;
    for (const [lab, val, dy] of [['Subtotal', sub, 0], ['IVA 15%', iva, 17.3], ['Total', sub + iva, 34.6]]) {
      T(ip, lab, 499, sy + dy, 7, lab === 'Total' ? g.b : g.r); T(ip, '$', 540.2, sy + dy, 7, g.r); R(ip, comma(val / 100, 2), 564, sy + dy, 7, lab === 'Total' ? g.b : g.r);
    }
    T(ip, 'Métodos de pago', 135, sy + 60, 7, g.r);
    T(ip, 'Sin utilización del sistema financiero', 29, sy + 73, 7, g.r); R(ip, `$ ${comma((sub + iva) / 100, 2)}`, 290, sy + 73, 7, g.r);
    T(ip, 'Información Adicional', 128, sy + 96, 7, g.r);
    T(ip, 'Referencia', 29, sy + 109, 7, g.r); T(ip, `Fact ${invoiceNumber}`, 129, sy + 109, 7, g.r);
    T(ip, 'TEL: 0995959214 - MAIL: info@megasuministros.shop - RUC: 0195168598001', 26, 763.5, 9, g.r);
    T(ip, 'Página 1 / 1', 515, 763.5, 9, g.r);
  });

  // ---------------- Prevalidaciones (en orden inverso, a propósito)
  for (const e of [...expected.orders].reverse()) {
    const pp = preDoc.addPage([595, 842]);
    const f = fp;
    T(pp, 'GERARDO ORTIZ E HIJOS CIA', 100, 31.4, 11, f.b);
    T(pp, 'PREVALIDACIÓN FACTURA', 100, 46.5, 11, f.b);
    T(pp, 'FECHA SOLICITUD:', 100, 57.6, 7, f.b); T(pp, '2026-11-03 12:07', 180, 57.6, 7, f.r);
    T(pp, 'CLAVE:', 100, 69.6, 7, f.b); T(pp, e.accessKey, 130, 69.6, 7, f.r);
    T(pp, 'PROVEEDOR:', 22, 82.6, 7, f.b); T(pp, '0020090943-MEGASUMINISTROS S.A.S.', 100, 82.6, 7, f.r);
    T(pp, 'FECHA FACTURA:', 22, 94.6, 7, f.b); T(pp, '2026-11-01', 100, 94.6, 7, f.r); T(pp, 'FECHA. LIMIT. ENTREGA', 180, 94.6, 7, f.b); T(pp, '2026-11-04', 280, 94.6, 7, f.r);
    T(pp, 'FECHA PEDIDO:', 22, 106.6, 7, f.b); T(pp, '2026-10-30', 100, 106.6, 7, f.r); T(pp, 'REFERENCIA:', 180, 106.6, 7, f.b); T(pp, e.invoiceNumber, 240, 106.6, 7, f.r);
    T(pp, 'PEDIDO:', 20, 124.6, 7, f.b); T(pp, e.sap, 99, 124.6, 7, f.r); T(pp, 'CENTRO:', 180, 124.6, 7, f.b); T(pp, e.header, 221, 124.6, 7, f.r);
    T(pp, 'TOTAL', 411, 124.6, 7, f.b); T(pp, num(e.totalCents / 100), 441, 124.6, 7, f.r);
    T(pp, 'TIPO PEDIDO:', 20, 136.6, 7, f.b); T(pp, 'NACIONALES', 99, 136.6, 7, f.r); T(pp, 'OBSERVACIONES:', 180, 136.6, 7, f.b); T(pp, 'Prevalidación Manual', 260, 136.6, 7, f.r);
    T(pp, 'FECHA VALIDACIÓN:', 411, 136.6, 7, f.b); T(pp, '2026-11-02', 500, 136.6, 7, f.r);
    for (const [s, x] of [['Codigo', 43.5], ['Codigo Auxiliar', 105.7], ['Codigo', 189.5], ['Descripcion', 232], ['IVA', 395], ['CANTIDA', 423.3], ['COSTO', 479], ['VALOR', 531.3]]) T(pp, s, x, 153.6, 9, f.b);
    e.lines.forEach((l, i) => {
      const y = 173 + 15 * i;
      T(pp, l.ean, 30, y, 8, f.r); T(pp, l.code, 187, y, 8, f.r); T(pp, 'PADS ENTRENAMIENTO LUCKY PET', 230, y, 8, f.r); T(pp, 'S', 400, y, 8, f.r);
      R(pp, String(l.qty), 470, y, 8, f.r); R(pp, num(l.priceCents / 100), 520, y, 8, f.r); R(pp, num(l.totalCents / 100), 573, y, 8, f.r);
    });
    const ty = 173 + 15 * (e.lines.length - 1) + 14.6;
    T(pp, 'TOTAL:', 485, ty, 9, f.b); R(pp, num(e.totalCents / 100), 573, ty, 8, f.b);
    // Patrón tipo QR (dibujo vectorial)
    for (let a = 0; a < 21; a++) for (let b = 0; b < 21; b++) if ((a * 7 + b * 13 + a * b) % 3 === 0) pp.drawRectangle({ x: 490 + a * 3.4, y: H - 100 + b * 3.4, width: 3.4, height: 3.4, color: rgb(0, 0, 0) });
    T(pp, 'Pág: 1', 552, 812.6, 7, f.r);
  }

  fs.writeFileSync(path.join(outDir, 'ordenes.pdf'), await ordersDoc.save());
  fs.writeFileSync(path.join(outDir, 'facturas.pdf'), await invDoc.save());
  fs.writeFileSync(path.join(outDir, 'prevalidaciones.pdf'), await preDoc.save());
  fs.writeFileSync(path.join(outDir, 'esperado.json'), JSON.stringify(expected, null, 2));
  return { outDir, expected };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, 'fixtures');
  const count = Number(process.argv[3] || SYNTHETIC_ORDERS.length);
  makeSynthetic(out, count).then(({ expected }) => console.log(`Documentos sintéticos creados en ${out} (${expected.orders.length} pedidos)`));
}
