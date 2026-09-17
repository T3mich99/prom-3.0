import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const groups = wb.worksheets.getItem('Export Groups Sheet');
const productValues = products.getUsedRange().values;
const groupValues = groups.getUsedRange().values;
const headers = productValues[0].map((v) => String(v ?? ''));
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const clean = (v) => String(v ?? '').trim();
const productRows = productValues.slice(1).filter((r) => clean(r[ix['Код_товару']]) !== '');
const groupRows = groupValues.slice(1).filter((r) => clean(r[0]) !== '');
const groupMap = new Map(groupRows.map((r) => [clean(r[0]), clean(r[1])]));
const directPhoto = /^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]+=w1280$/u;
const problems = [];
for (const row of productRows) {
  const code = clean(row[ix['Код_товару']]);
  const photos = clean(row[ix['Посилання_зображення']]).split(',').map((s) => s.trim()).filter(Boolean);
  if (!/^U\d+U$/u.test(code)) problems.push(`${code}: code`);
  if (photos.length !== 5 || photos.some((u) => !directPhoto.test(u))) problems.push(`${code}: photos`);
  const groupNumber = clean(row[ix['Номер_групи']]);
  const groupName = clean(row[ix['Назва_групи']]);
  if (!groupNumber || !groupName || groupMap.get(groupNumber) !== groupName) problems.push(`${code}: category`);
  if (clean(row[ix['Виробник']]) !== 'AND') problems.push(`${code}: manufacturer`);
  if (!Number.isInteger(Number(row[ix['Унікальний_ідентифікатор']])) || Number(row[ix['Унікальний_ідентифікатор']]) <= 0) problems.push(`${code}: unique id`);
  if (clean(row[ix['Оптова_ціна']]) || clean(row[ix['Мінімальне_замовлення_опт']])) problems.push(`${code}: wholesale`);
  if (clean(row[ix['Пошукові_запити']]).split(',').filter(Boolean).length < 25) problems.push(`${code}: ru keywords`);
  if (clean(row[ix['Пошукові_запити_укр']]).split(',').filter(Boolean).length < 25) problems.push(`${code}: ua keywords`);
}
const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'Prom final formula scan' });
const qa = {
  products: productRows.length,
  groups: groupRows.length,
  categoriesCovered: productRows.filter((r) => groupMap.get(clean(r[ix['Номер_групи']])) === clean(r[ix['Назва_групи']])).length,
  manufacturerAND: productRows.filter((r) => clean(r[ix['Виробник']]) === 'AND').length,
  fiveDirectPhotos: productRows.filter((r) => clean(r[ix['Посилання_зображення']]).split(',').map((s) => s.trim()).filter(Boolean).length === 5 && clean(r[ix['Посилання_зображення']]).split(',').every((s) => directPhoto.test(s.trim()))).length,
  problems,
  formulaErrors: formulaErrors.ndjson || '',
};
console.log(JSON.stringify(qa, null, 2));
if (problems.length || !/matched 0 entries/iu.test(qa.formulaErrors)) process.exitCode = 1;
