/**
 * Compatibilidad con Safari (WebKit). Se carga en la página y en el worker de PDF.js,
 * ANTES de PDF.js. Solo agrega lo que falta; en Chrome, Edge y Firefox no cambia nada.
 *
 * 1) Iteración de ReadableStream: Safari no permite recorrer un ReadableStream con
 *    `for await (const x of stream)` (no implementa ReadableStream.prototype[Symbol.asyncIterator]
 *    ni .values()). PDF.js 6 lo usa internamente y en Safari provocaba el error
 *    "undefined is not a function (near '...t of e...')" al leer los PDF.
 *    Se agregan siguiendo la especificación WHATWG Streams.
 *
 * 2) Promise.withResolvers: PDF.js 6 lo usa y Safari lo incorporó en la versión 17.4.
 */
(function installReadableStreamIteration(g) {
  const RS = g.ReadableStream;
  if (typeof RS !== 'function' || typeof RS.prototype[Symbol.asyncIterator] === 'function') return;

  function values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    let finished = false;
    const iterator = {
      async next() {
        if (finished) return { value: undefined, done: true };
        try {
          const result = await reader.read();
          if (result.done) { finished = true; reader.releaseLock(); }
          return result;
        } catch (err) {
          finished = true;
          reader.releaseLock();
          throw err;
        }
      },
      async return(value) {
        if (!finished) {
          finished = true;
          if (!preventCancel) {
            const cancelPromise = reader.cancel(value);
            reader.releaseLock();
            await cancelPromise;
          } else {
            reader.releaseLock();
          }
        }
        return { value, done: true };
      },
      [Symbol.asyncIterator]() { return this; },
    };
    return iterator;
  }

  Object.defineProperty(RS.prototype, 'values', { value: values, writable: true, configurable: true });
  Object.defineProperty(RS.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
  g.__megaflowStreamPolyfill = true;
})(globalThis);

(function installPromiseWithResolvers() {
  if (typeof Promise.withResolvers === 'function') return;
  Object.defineProperty(Promise, 'withResolvers', {
    value: function withResolvers() {
      let resolve;
      let reject;
      const promise = new this((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
    writable: true,
    configurable: true,
  });
})();

export {};
