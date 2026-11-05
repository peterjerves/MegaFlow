/**
 * Prueba de rendimiento en navegador real: N pedidos sintéticos (por defecto 100)
 * → lectura, análisis, 2 Excel y PDF final de N×4 páginas. Mide tiempos.
 * Uso: node tests/perf.mjs [cantidad]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './static-server.mjs';
import { makeSynthetic } from './make-synthetic.mjs';

const N = Number(process.argv[2] || 100);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'megaflow-perf-'));
await makeSynthetic(dir, N);
const srv = await startServer();
const browser = await chromium.launch();
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(srv.url);
await page.waitForFunction(() => window.__megaflowReady);
const t = () => performance.now();
const pick = async (btn, file) => { const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click(btn)]); await c.setFiles(file); };
const waitCount = (sel, txt) => page.waitForFunction(([s, x]) => document.querySelector(s).textContent.includes(x) && !/leyendo/.test(document.querySelector(s).textContent), [sel, txt], { timeout: 300000 });
const out = {};

let t0 = t();
await pick('#dz-p1-orders [data-pick]', path.join(dir, 'ordenes.pdf'));
await waitCount('#count-p1-orders', `${N} pedidos detectados`);
out.lecturaOrdenes = t() - t0;
t0 = t();
await page.click('#p1-run');
await page.waitForSelector('#p1-results [data-download="odoo"]', { timeout: 300000 });
out.analisisYExcel = t() - t0;

await page.click('#tab-dossiers');
t0 = t();
await pick('#dz-p2-orders [data-pick]', path.join(dir, 'ordenes.pdf'));
await pick('#dz-p2-invoices [data-pick]', path.join(dir, 'facturas.pdf'));
await pick('#dz-p2-prevals [data-pick]', path.join(dir, 'prevalidaciones.pdf'));
await waitCount('#count-p2-orders', `${N} pedidos`); await waitCount('#count-p2-invoices', `${N} facturas`); await waitCount('#count-p2-prevals', `${N} prevalidaciones`);
out.lectura3Archivos = t() - t0;
t0 = t();
await page.click('#p2-run');
await page.waitForSelector('#p2-results [data-act="generate"]:not([disabled])', { timeout: 300000 });
out.matching = t() - t0;
t0 = t();
await page.click('#p2-results [data-act="generate"]');
await page.waitForSelector('#p2-results [data-act="download"]', { timeout: 600000 });
out.pdfGeneradoYVerificado = t() - t0;
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#p2-results [data-act="download"]')]);
const f = path.join(dir, dl.suggestedFilename()); await dl.saveAs(f);
const hint = await page.$eval('#p2-results .downloads .hint', (e) => e.textContent);
await browser.close(); await srv.close();
console.log(JSON.stringify({ pedidos: N, ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${(v / 1000).toFixed(1)} s`])), pdf: `${(fs.statSync(f).size / 1024).toFixed(0)} KB`, detalle: hint.trim(), errores: errors }, null, 2));
