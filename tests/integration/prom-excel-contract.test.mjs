import assert from 'node:assert/strict';
import test from 'node:test';
import { FileBlob, SpreadsheetFile, Workbook } from '../support/xlsx-compat.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoPath } from '../characterization/support.mjs';

const contractFixture = JSON.parse(await fs.readFile(repoPath('tests', 'fixtures', 'prom-contract.fixture.json'), 'utf8'));

test('tracked Prom short template preserves actual sheet names and header rows', async () => {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(repoPath('prom-import-short-template.xlsx')));
  const products = wb.worksheets.getItem('Export Products Sheet');
  const groups = wb.worksheets.getItem('Export Groups Sheet');
  assert.deepEqual(products.getUsedRange().values[0], [
    'Название_позиции', 'Поисковые_запросы', 'Описание', 'Тип_товара', 'Цена',
    'Валюта', 'Единица_измерения', 'Ссылка_изображения', 'Наличие',
    'Идентификатор_товара', 'Идентификатор_группы',
  ]);
  assert.deepEqual(groups.getUsedRange().values[0], [
    'Номер_группы', 'Название_группы', 'Идентификатор_группы', 'Номер_родителя', 'Идентификатор_родителя',
  ]);
});

test('synthetic Prom fixture survives XLSX export/import with actual cell values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'product-automation-prom-'));
  const input = path.join(directory, 'fixture.xlsx');
  const wb = Workbook.create();
  const products = wb.worksheets.add('Export Products Sheet');
  products.getRangeByIndexes(0, 0, 2, contractFixture.headers.length).values = [contractFixture.headers, contractFixture.row];
  const groups = wb.worksheets.add('Export Groups Sheet');
  groups.getRangeByIndexes(0, 0, 2, 3).values = [
    ['Номер_групи', 'Назва_групи', 'Ідентифікатор_групи'],
    [100004, 'Соковижималки', 611],
  ];
  const out = await SpreadsheetFile.exportXlsx(wb);
  await out.save(input);

  const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  const values = reopened.worksheets.getItem('Export Products Sheet').getUsedRange().values;
  assert.deepEqual(values[0], contractFixture.headers);
  assert.deepEqual(values[1], contractFixture.row);
  assert.equal(values[1][0], 'U1001U');
  assert.equal(values[1][7], 550);
  assert.equal(values[1][11], 1001);
  assert.equal(values[1][16], null);
  assert.equal(values[1][17], null);
  assert.match(values[1][9], /^https:\/\/lh3\.googleusercontent\.com\/d\/example1=w1280/u);
});

test('synthetic Prom fixture contains the required semantic fields', () => {
  const index = Object.fromEntries(contractFixture.headers.map((header, i) => [header, i]));
  for (const header of [
    'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Пошукові_запити',
    'Пошукові_запити_укр', 'Опис', 'Опис_укр', 'Ціна', 'Посилання_зображення',
    'Унікальний_ідентифікатор', 'Ідентифікатор_товару', 'Ідентифікатор_підрозділу',
    'Назва_групи', 'Виробник', 'Оптова_ціна', 'Мінімальне_замовлення_опт',
  ]) assert.notEqual(index[header], undefined, header);
  assert.equal(typeof contractFixture.row[index['Ціна']], 'number');
  assert.equal(typeof contractFixture.row[index['Унікальний_ідентифікатор']], 'number');
  assert.equal(contractFixture.row[index['Оптова_ціна']], null);
  assert.equal(contractFixture.row[index['Мінімальне_замовлення_опт']], null);
});
