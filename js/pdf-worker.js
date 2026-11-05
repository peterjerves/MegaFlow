/**
 * Worker de PDF.js para MegaFlow.
 * Primero instala la compatibilidad de streams para Safari y después carga el worker
 * original de PDF.js (vendor/). El orden de los import garantiza que el polyfill
 * se ejecute antes. Se reexportan sus símbolos por si PDF.js usa el modo sin worker.
 */
import './compat.js';
export * from '../vendor/pdfjs/pdf.worker.min.js';
