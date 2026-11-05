/**
 * Compatibilidad con Safari: se simula un navegador sin iteración de ReadableStream
 * ni Promise.withResolvers y se comprueba que js/compat.js los repone correctamente.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

delete ReadableStream.prototype[Symbol.asyncIterator];
delete ReadableStream.prototype.values;
delete Promise.withResolvers;
await import('../../js/compat.js');

test('ReadableStream se puede recorrer con for await (como lo usa PDF.js 6)', async () => {
  const rs = new ReadableStream({ start(c) { c.enqueue('a'); c.enqueue('b'); c.close(); } });
  const out = [];
  for await (const x of rs) out.push(x);
  assert.deepEqual(out, ['a', 'b']);
  assert.equal(rs.locked, false);
});

test('Salir antes de tiempo cancela el stream y libera el lector', async () => {
  let cancelled = false;
  let n = 0;
  const rs = new ReadableStream({ pull(c) { c.enqueue(n); }, cancel() { cancelled = true; } });
  for await (const x of rs) { if (x >= 2) break; n++; }
  assert.equal(cancelled, true);
  assert.equal(rs.locked, false);
});

test('Los errores del stream se propagan', async () => {
  const rs = new ReadableStream({ start(c) { c.error(new Error('fallo')); } });
  await assert.rejects(async () => { for await (const x of rs) void x; }, /fallo/);
});

test('Promise.withResolvers', async () => {
  const { promise, resolve } = Promise.withResolvers();
  resolve(42);
  assert.equal(await promise, 42);
});
