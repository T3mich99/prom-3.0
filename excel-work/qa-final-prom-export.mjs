import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const xlsx = process.argv[2];
const mapPath = process.argv[3];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(xlsx));
const sh = wb.worksheets.getItem('Export Products Sheet');
const used = sh.getUsedRange();
const values = used.values;
const headers = values[0];
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const rows = values.slice(1).filter((r) => String(r[ix['Код_товару']] ?? '').trim());
const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const files = map.files ?? {};
const idSet = new Set(Object.values(files).map((v) => v.id));
const photoIds = (v) => String(v ?? '').match(/id=([A-Za-z0-9_-]+)/g)?.map((x) => x.slice(3)) ?? [];
const nameSlots = headers.map((h, i) => h === 'Назва_Характеристики' ? i : -1).filter((i) => i >= 0);
const valueSlots = headers.map((h, i) => h === 'Значення_Характеристики' ? i : -1).filter((i) => i >= 0);
const problems = [];
for (const r of rows) {
  const code = String(r[ix['Код_товару']]);
  const photos = photoIds(r[ix['Посилання_зображення']]);
  if (photos.length !== 5 || photos.some((id) => !idSet.has(id))) problems.push(`${code}: photo set`);
  if (!String(r[ix['Назва_групи']] ?? '').trim()) problems.push(`${code}: category`);
  if (!/^U\d+U$/u.test(String(r[ix['Ідентифікатор_товару']])) || !Number.isInteger(Number(r[ix['Унікальний_ідентифікатор']])) || Number(r[ix['Унікальний_ідентифікатор']]) <= 0) problems.push(`${code}: ids`);
  if (String(r[ix['Пошукові_запити']] ?? '').split(', ').length < 25 || String(r[ix['Пошукові_запити']] ?? '').length > 1024) problems.push(`${code}: ru keywords`);
  if (String(r[ix['Пошукові_запити_укр']] ?? '').split(', ').length < 25 || String(r[ix['Пошукові_запити_укр']] ?? '').length > 1024) problems.push(`${code}: ua keywords`);
  if (!String(r[nameSlots[0]] ?? '').trim() || !String(r[valueSlots[0]] ?? '').trim()) problems.push(`${code}: characteristics`);
}
const inspect = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'final export formula scan' });
console.log(JSON.stringify({
  products: rows.length,
  folderId: map.folderId,
  photoSets5: rows.filter((r) => photoIds(r[ix['Посилання_зображення']]).length === 5).length,
  photoIdsInTargetMap: rows.filter((r) => photoIds(r[ix['Посилання_зображення']]).every((id) => idSet.has(id))).length,
  categories: rows.filter((r) => String(r[ix['Назва_групи']] ?? '').trim()).length,
  characteristics: rows.filter((r) => String(r[nameSlots[0]] ?? '').trim() && String(r[valueSlots[0]] ?? '').trim()).length,
  problems,
  formulaErrors: inspect.ndjson || '',
}, null, 2));
