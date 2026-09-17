import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet').getRange('A2:DD101').values;
const groups = wb.worksheets.getItem('Export Groups Sheet').getRange('A2:O317').values;

const byInternal = new Map();
const byExternal = new Map();
for (const row of groups) {
  const internal = String(row[0] ?? '').trim();
  const external = String(row[3] ?? '').trim();
  if (internal) byInternal.set(internal, row);
  if (external) byExternal.set(external, row);
}

const failures = [];
for (const row of products) {
  const code = String(row[0] ?? '');
  const internal = String(row[17] ?? '').trim();
  const nameRu = String(row[18] ?? '').trim();
  const external = String(row[26] ?? '').trim();
  const group = byInternal.get(internal);
  const externalGroup = byExternal.get(external);
  if (!group || !externalGroup || nameRu !== String(group[1] ?? '').trim()) {
    failures.push({ code, internal, nameRu, external, hasInternalGroup: Boolean(group), hasExternalCategory: Boolean(externalGroup), groupNameRu: group?.[1] ?? '' });
  }
}

const result = {
  products: products.length,
  groups: groups.filter((r) => String(r[0] ?? '').trim()).length,
  productsWithInternalGroup: products.filter((r) => byInternal.has(String(r[17] ?? '').trim())).length,
  productsWithExternalCategory: products.filter((r) => byExternal.has(String(r[26] ?? '').trim())).length,
  categoryFailures: failures,
};
console.log(JSON.stringify(result, null, 2));
