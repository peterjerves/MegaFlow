/**
 * Servidor HTTP estático equivalente a GitHub Pages para pruebas locales.
 * Publica la carpeta del proyecto bajo una SUBRUTA (por defecto /megaflow/), igual que
 * https://usuario.github.io/megaflow/. Solo sirve archivos: no procesa nada.
 *
 * Uso:  node tests/static-server.mjs [puerto] [subruta]
 *       node tests/static-server.mjs 8080 /megaflow/
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8',
};
const BLOCKED = /^\/(node_modules|tests|\.git)(\/|$)/;

export function startServer({ port = 0, base = '/megaflow/', log = false } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname });
    if (log) console.log(req.method, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Método no permitido: sitio estático'); return; }
    if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end('404'); return; }
    let rel = decodeURIComponent(url.pathname.slice(base.length - 1));
    if (rel.endsWith('/')) rel += 'index.html';
    if (BLOCKED.test(rel)) { res.writeHead(404); res.end('404'); return; }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const { port: p } = server.address();
    resolve({ server, port: p, url: `http://127.0.0.1:${p}${base}`, requests, close: () => new Promise((r) => server.close(r)) });
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2] || 8080);
  const base = process.argv[3] || '/megaflow/';
  startServer({ port, base, log: true }).then((s) => console.log(`MegaFlow disponible en ${s.url}`));
}
