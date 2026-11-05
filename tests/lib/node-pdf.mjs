/**
 * Utilidades de prueba en Node: lee PDFs con pdfjs-dist (misma versión que vendor/)
 * y produce modelos de página con el MISMO código de la aplicación (js/pdf-reader.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openPdf, readAllPages } from '../../js/pdf-reader.js';

export { pdfjs };

export async function pagesFromBytes(bytes, fileName, fileId = fileName) {
  const { doc, close } = await openPdf(pdfjs, new Uint8Array(bytes));
  try {
    return await readAllPages(pdfjs, doc, { fileId, fileName });
  } finally {
    await close();
  }
}

export async function pagesFromFile(file, fileId) {
  return pagesFromBytes(fs.readFileSync(file), path.basename(file), fileId || path.basename(file));
}
