import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const outDir = path.dirname(outputPath);
await fs.mkdir(outDir, { recursive: true });

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const used = products.getUsedRange();
const values = used.values;
const headers = values[0].map((v) => String(v ?? ''));
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const rows = values.slice(1);
const norm = (v) => String(v ?? '').replace(/^U/iu, '').replace(/U$/iu, '').trim();
const targetIndex = rows.findIndex((r) => norm(r[ix['Код_товару']]) === '35214');
const referenceIndex = rows.findIndex((r) => norm(r[ix['Код_товару']]) === '13119');
if (targetIndex < 0) throw new Error('Product 35214 not found');
if (referenceIndex < 0) throw new Error('Reference cleaning-brush category product 13119 not found');

const target = [...rows[targetIndex]];
const reference = rows[referenceIndex];
const oldCategory = {
  number: target[ix['Номер_групи']],
  name: target[ix['Назва_групи']],
  subdivisionId: target[ix['Ідентифікатор_підрозділу']],
};
// 35214 is a window-cleaning tool, not a spare part. Reuse the existing
// accepted cleaning-tools store group used by product 13119 so Prom does not
// infer the spare-parts category that requires Code part/manufacturer.
for (const field of ['Номер_групи', 'Назва_групи', 'Ідентифікатор_підрозділу']) {
  target[ix[field]] = reference[ix[field]];
}
if (ix['Посилання_підрозділу'] !== undefined) target[ix['Посилання_підрозділу']] = null;
products.getRangeByIndexes(targetIndex + 1, 0, 1, headers.length).values = [target];

const groupSheet = wb.worksheets.getItem('Export Groups Sheet');
const groupUsed = groupSheet.getUsedRange();
const groupValues = groupUsed.values;
const groupId = String(target[ix['Номер_групи']]);
const groupRowIndex = groupValues.slice(1).findIndex((r) => String(r[0] ?? '') === groupId);
if (groupRowIndex < 0) throw new Error(`Group ${groupId} not found in Export Groups Sheet`);

const formulas = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'category fix formula scan',
});
const check = {
  product: target[ix['Код_товару']],
  oldCategory,
  newCategory: {
    number: target[ix['Номер_групи']],
    name: target[ix['Назва_групи']],
    subdivisionId: target[ix['Ідентифікатор_підрозділу']],
  },
  referenceProduct: reference[ix['Код_товару']],
  groupExists: groupRowIndex >= 0,
  formulaErrors: formulas.ndjson || '',
};
if (!check.groupExists || !/matched 0 entries/iu.test(check.formulaErrors)) throw new Error(JSON.stringify(check));

const preview = await wb.render({ sheetName: 'Export Products Sheet', range: 'Q1:U12', scale: 1, format: 'png' });
await fs.writeFile(path.join(outDir, 'fix-35214-category-preview.png'), new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile(path.join(outDir, 'fix-35214-category-qa.json'), JSON.stringify(check, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, check }, null, 2));
