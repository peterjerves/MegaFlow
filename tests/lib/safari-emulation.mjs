/**
 * Emulación de limitaciones de Safari (WebKit) en Chromium.
 *
 * 1) Safari NO permite recorrer un ReadableStream con `for await (... of stream)`
 *    (falta ReadableStream.prototype[Symbol.asyncIterator]). PDF.js 6 lo usa y en Safari
 *    producía "undefined is not a function (near '...t of e...')" al leer los PDF.
 * 2) Modo "legacy" (≈ Safari 16.4): además se quitan funciones que Safari incorporó después
 *    (Promise.withResolvers 17.4, Object/Map.groupBy 17.4, URL.parse 18, Iterator 18.4,
 *    Uint8Array base64 18.2, Float16Array 18.2, Response.bytes 18…) para comprobar que
 *    MegaFlow y los polyfills de PDF.js legacy las reponen.
 *
 * Los cambios se aplican en la página y en el worker de PDF.js antes de cualquier script de la app.
 */
const STREAMS = `
    delete ReadableStream.prototype[Symbol.asyncIterator];
    delete ReadableStream.prototype.values;`;
const LEGACY = `
    const del = (o, k) => { try { if (o && k in o) delete o[k]; } catch (e) {} };
    del(Promise, 'withResolvers'); del(Promise, 'try'); del(URL, 'parse');
    del(Array, 'fromAsync'); del(Math, 'sumPrecise'); del(Object, 'groupBy'); del(Map, 'groupBy');
    if (typeof Response !== 'undefined') del(Response.prototype, 'bytes');
    if (typeof Blob !== 'undefined') del(Blob.prototype, 'bytes');
    del(Uint8Array, 'fromBase64'); del(Uint8Array, 'fromHex'); del(Uint8Array.prototype, 'toBase64'); del(Uint8Array.prototype, 'toHex');
    del(Map.prototype, 'getOrInsert'); del(Map.prototype, 'getOrInsertComputed'); del(WeakMap.prototype, 'getOrInsert'); del(WeakMap.prototype, 'getOrInsertComputed');
    del(globalThis, 'Float16Array'); del(globalThis, 'Iterator');`;

const build = (mode) => `(() => {
  try {
    // Solo si MegaFlow aún no instaló su compatibilidad (simula el estado nativo de Safari).
    if (typeof ReadableStream !== 'undefined' && !globalThis.__megaflowStreamPolyfill && !globalThis.__safariEmulation) {${STREAMS}${mode === 'legacy' ? LEGACY : ''}
      globalThis.__safariEmulation = '${mode}';
    }
  } catch (e) {}
})();\n`;
export const REMOVE_STREAM_ITERATION = build('streams');

/**
 * @param {import('playwright').BrowserContext} context
 * @param {'streams'|'legacy'} mode
 */
export async function emulateSafari(context, mode = 'streams') {
  const code = build(mode);
  await context.addInitScript(code);
  for (const suffix of ['/js/compat.js', '/vendor/pdfjs/pdf.worker.min.js']) {
    await context.route(`**${suffix}`, async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      await route.fulfill({ response: res, body: code + body, headers: { ...res.headers(), 'content-type': 'text/javascript; charset=utf-8' } });
    });
  }
}
export const emulateSafariStreams = (context) => emulateSafari(context, 'streams');
