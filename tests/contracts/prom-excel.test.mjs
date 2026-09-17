import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PROM_SHEETS, headerIndex } from '../../src/contracts/prom-excel.mjs';
import { repoPath } from '../characterization/support.mjs';

const contractFixture = JSON.parse(await fs.readFile(
  repoPath('tests', 'fixtures', 'prom-contract.fixture.json'),
  'utf8',
));
const strictGolden = JSON.parse(await fs.readFile(
  repoPath('tests', 'fixtures', 'golden', 'strict-ready', 'snapshot.json'),
  'utf8',
));

test('canonical sheet names match independent golden workbook metadata', () => {
  assert.deepEqual(
    [PROM_SHEETS.PRODUCTS, PROM_SHEETS.GROUPS],
    strictGolden.sheetNames,
  );
});

test('exact header lookup preserves independent Prom fixture positions', () => {
  assert.equal(headerIndex(contractFixture.headers, 'Код_товару'), 0);
  assert.equal(headerIndex(contractFixture.headers, 'Посилання_зображення'), 9);
  assert.equal(headerIndex(contractFixture.headers, 'Мінімальне_замовлення_опт'), 17);
  assert.equal(headerIndex(contractFixture.headers, 'missing'), -1);
  assert.equal(headerIndex(['duplicate', 'duplicate'], 'duplicate'), 0);
});

test('headerIndex matches Array#indexOf for duplicate and missing headers', () => {
  const headers = ['duplicate', 'duplicate'];
  assert.equal(headerIndex(headers, 'duplicate'), headers.indexOf('duplicate'));
  assert.equal(headerIndex(headers, 'missing'), headers.indexOf('missing'));
  assert.equal(headerIndex(headers, 'missing'), -1);
});
