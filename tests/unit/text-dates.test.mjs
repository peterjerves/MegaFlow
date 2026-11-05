import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, toCents, ivaCents, isValidEan13, normId, parseSriAccessKey, sriCheckDigit, compact } from '../../js/text-utils.js';
import { addDays, addMonths, computeDueDate, isIsoDate, dateParts } from '../../js/dates.js';
import { CONFIG } from '../../js/config.js';

test('parseNumber: formatos Coral (punto) y factura (coma)', () => {
  assert.equal(parseNumber('67.5', '.'), 67.5);
  assert.equal(parseNumber('2', '.'), 2);
  assert.equal(parseNumber('1,234.50', '.'), 1234.5);
  assert.equal(parseNumber('12,000000', ','), 12);
  assert.equal(parseNumber('105,23', ','), 105.23);
  assert.equal(parseNumber('1.234,56', ','), 1234.56);
  assert.equal(parseNumber('$ 24,00', ','), 24);
  assert.ok(Number.isNaN(parseNumber('X10', '.')));
  assert.ok(Number.isNaN(parseNumber('15%', '.')));
  assert.ok(Number.isNaN(parseNumber('2026-10-30', '.')));
});

test('IVA 15 % con redondeo comercial en centavos', () => {
  assert.equal(ivaCents(9150, 15), 1373); // 13,725 → 13,73
  assert.equal(ivaCents(9330, 15), 1400); // 13,995 → 14,00
  assert.equal(ivaCents(2250, 15), 338); // 3,375 → 3,38
  assert.equal(ivaCents(4650, 15), 698); // 6,975 → 6,98
  assert.equal(ivaCents(7230, 15), 1085);
  assert.equal(toCents(2.58), 258);
  assert.equal(toCents(0.1 + 0.2), 30);
});

test('EAN-13 del catálogo válidos; dígito alterado inválido', () => {
  for (const p of CONFIG.products) assert.ok(isValidEan13(p.ean), p.ean);
  assert.equal(isValidEan13('0799192905989'), false);
  assert.equal(isValidEan13('123'), false);
});

test('normId: solo normaliza para comparar, conserva ceros', () => {
  assert.equal(normId(' al 204391 '), 'AL204391');
  assert.equal(normId('0 0 1 - 0 0 1 - 0 0 0 0 0 0 3 6 6'), '001-001-000000366');
  assert.equal(normId('001–001–000000366'), '001-001-000000366');
  assert.equal(compact('0 0 1'), '001');
});

test('Clave de acceso SRI: estructura y dígito verificador módulo 11', () => {
  const base = '01112026' + '01' + '0195168598001' + '2' + '001001' + '000000901' + '12345678' + '1';
  const key = base + sriCheckDigit(base);
  const k = parseSriAccessKey(key);
  assert.equal(k.invoiceNumber, '001-001-000000901');
  assert.equal(k.date, '2026-11-01');
  assert.equal(k.docType, '01');
  assert.equal(k.checkDigitOk, true);
  const tampered = key.slice(0, 40) + ((Number(key[40]) + 1) % 10) + key.slice(41);
  assert.equal(parseSriAccessKey(tampered).checkDigitOk, false);
  assert.equal(parseSriAccessKey('123'), null);
});

test('Vencimiento: tres meses calendario, 90 días exactos y manual', () => {
  assert.equal(computeDueDate('2026-11-01', 'months3'), '2027-02-01');
  assert.equal(computeDueDate('2026-11-01', 'days90'), '2027-01-30');
  assert.equal(computeDueDate('2026-11-01', 'manual', '2027-03-15'), '2027-03-15');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.deepEqual(dateParts('2026-10-30'), { dia: '30', mes: 'octubre', anio: '2026', compact: '2026_10_30' });
});
