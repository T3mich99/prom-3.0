import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';
import { canonicalGroups, canonicalProducts } from './canonical.mjs';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? '' : String(process.argv[index + 1] ?? '');
}

const inputPath = option('input');
const outputDir = option('output');
const fixtureId = option('id');
const workflow = option('workflow');
const sourceArtifact = option('source-artifact');

if (!inputPath || !outputDir || !fixtureId || !workflow || !sourceArtifact) {
  throw new Error('Usage: --input <xlsx> --output <dir> --id <id> --workflow <label> --source-artifact <repo-relative-label>');
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const productSheet = workbook.worksheets.getItem('Export Products Sheet');
const productValues = productSheet.getUsedRange().values;
const productHeaders = (productValues[0] ?? []).map((value) => String(value ?? ''));
const codeIndex = productHeaders.findIndex((header) => ['Код_товару', 'Код_товара'].includes(header));
if (codeIndex < 0) throw new Error('Product sheet has no product-code column');

const requestedCode = option('code').replace(/^U/iu, '').replace(/U$/iu, '');
const productRow = productValues.slice(1).find((row) => {
  const code = String(row[codeIndex] ?? '').replace(/^U/iu, '').replace(/U$/iu, '');
  return code === requestedCode;
});
if (!productRow) throw new Error(`Product code ${requestedCode} was not found in ${inputPath}`);

const product = canonicalProducts([productHeaders, productRow]);
let group = null;
try {
  const groupSheet = workbook.worksheets.getItem('Export Groups Sheet');
  group = canonicalGroups(groupSheet.getUsedRange().values, product);
} catch {
  group = null;
}

const fixture = {
  fixtureId,
  sourceArtifact,
  workflow,
  selectedSourceCode: requestedCode,
  sheetNames: ['Export Products Sheet', ...(group ? ['Export Groups Sheet'] : [])],
  products: product,
  groups: group,
  sanitization: {
    removedNonPhotoUrls: true,
    preservedBusinessValues: true,
    excludedAbsolutePaths: true,
  },
};

const destination = path.resolve(outputDir);
await fs.mkdir(destination, { recursive: true });
await fs.writeFile(path.join(destination, 'snapshot.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

const derived = Workbook.create();
const derivedProducts = derived.worksheets.add('Export Products Sheet');
derivedProducts.getRangeByIndexes(0, 0, 2, product.headers.length).values = [product.headers, product.row];
if (group) {
  const derivedGroups = derived.worksheets.add('Export Groups Sheet');
  const groupRows = [group.headers, ...group.rows];
  derivedGroups.getRangeByIndexes(0, 0, groupRows.length, group.headers.length).values = groupRows;
}
const exported = await SpreadsheetFile.exportXlsx(derived);
await exported.save(path.join(destination, 'workbook.xlsx'));

console.log(JSON.stringify({ fixtureId, outputDir: destination, sourceArtifact, photoCount: product.important.photoCount }, null, 2));
