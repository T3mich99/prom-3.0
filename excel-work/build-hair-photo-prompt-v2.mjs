import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const photoMapPath = process.argv[4];
const localRoot = process.argv[5];
if (!inputPath || !outputPath || !photoMapPath || !localRoot) {
  throw new Error('Usage: node build-hair-photo-prompt-v2.mjs <input.xlsx> <output.xlsx> <photo-map.json> <local-photo-root>');
}

const roles = [
  ['01_main', '01_main.png'],
  ['02_benefits', '02_benefits.png'],
  ['03_features', '03_features.png'],
  ['04_use', '04_use.png'],
  ['05_details', '05_details.png'],
];
const clean = (v) => String(v ?? '').trim();
const coreCode = (v) => clean(v).replace(/^U/iu, '').replace(/U$/iu, '');
const normalizeCode = (v) => clean(v).replace(/^U/iu, '').replace(/U$/iu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '').toLocaleLowerCase('uk-UA');
const publicUrl = (id) => `https://lh3.googleusercontent.com/d/${id}=w1280`;

const rawMap = JSON.parse((await fs.readFile(photoMapPath, 'utf8')).replace(/^\uFEFF/u, ''));
const photoByKey = new Map();
const localSkuByNormalized = new Map();
for (const item of rawMap) {
  if (item?.sku != null) localSkuByNormalized.set(normalizeCode(item.sku), clean(item.sku));
  if (item?.sku != null && item?.role && item?.id) photoByKey.set(`${normalizeCode(item.sku)}::${clean(item.role)}`, clean(item.id));
}

const pngSize = async (filePath) => {
  const b = await fs.readFile(filePath);
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const used = products.getUsedRange().values;
if (!used?.length) throw new Error('Export Products Sheet is empty');
const headers = used[0].map(clean);
const ix = (name) => headers.indexOf(name);
const codeIx = ix('Код_товару');
const photoIx = ix('Посилання_зображення');
if (codeIx < 0 || photoIx < 0) throw new Error('Required columns Код_товару or Посилання_зображення are missing');

const rows = used.slice(1).filter((r) => clean(r[codeIx]) !== '');
if (rows.length !== 100) throw new Error(`Expected 100 products, got ${rows.length}`);

const photoQa = [];
const urlChecks = [];
for (const row of rows) {
  const code = coreCode(row[codeIx]);
  const normalizedCode = normalizeCode(code);
  const localSku = localSkuByNormalized.get(normalizedCode) ?? code;
  const links = [];
  const statuses = [];
  for (const [role, fileName] of roles) {
    const filePath = path.join(localRoot, localSku.replace(/[\\/]/gu, path.sep), fileName);
    const dims = await pngSize(filePath);
    if (!dims || dims.width !== 1280 || dims.height !== 1280) {
      throw new Error(`Invalid PNG size for ${code}/${fileName}: ${JSON.stringify(dims)}`);
    }
    const id = photoByKey.get(`${normalizedCode}::${role}`);
    if (!id) throw new Error(`Missing public Drive photo ID for ${code}/${role}`);
    const url = publicUrl(id);
    links.push(url);
    statuses.push({ role, file: filePath, url, dimensions: `${dims.width}×${dims.height}` });
    urlChecks.push({ code, role, url });
  }
  row[photoIx] = links.join(', ');
  photoQa.push({
    code: `U${code}U`,
    count: links.length,
    dimensions: '1280×1280',
    main: 'готово',
    benefits: 'готово',
    features: 'готово',
    use: 'готово',
    details: 'готово',
    source: 'локальні AI-фото з папки hair-styling-all-2026-09-05/photos; посилання з Google Drive',
    status: 'Готово',
    note: '5 окремих PNG; 01–04 з короткою українською інфографікою, 05 чисте предметне фото; доступ без авторизації перевіряється нижче.',
    statuses,
  });
}
products.getRange(`A2:DD${rows.length + 1}`).values = rows;

const qaSheet = wb.worksheets.add('Фото QA');
const qaHeaders = ['Код', 'Кількість фото', 'Розмір', '01_main', '02_benefits', '03_features', '04_use', '05_details', 'Джерело', 'Статус', 'Примітка'];
const qaValues = photoQa.map((q) => [q.code, q.count, q.dimensions, q.main, q.benefits, q.features, q.use, q.details, q.source, q.status, q.note]);
qaSheet.getRange(`A1:K${qaValues.length + 1}`).values = [qaHeaders, ...qaValues];
qaSheet.getRange('A1:K1').format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' }, wrap_text: true, vertical_alignment: 'center' };
qaSheet.getRange(`A2:K${qaValues.length + 1}`).format = { wrap_text: true, vertical_alignment: 'top' };
qaSheet.getRange('A:A').format.column_width = 14;
qaSheet.getRange('B:C').format.column_width = 15;
qaSheet.getRange('D:H').format.column_width = 14;
qaSheet.getRange('I:I').format.column_width = 58;
qaSheet.getRange('J:J').format.column_width = 14;
qaSheet.getRange('K:K').format.column_width = 70;
try { qaSheet.tables.add(`A1:K${qaValues.length + 1}`, true, 'HairPhotoPromptQA'); } catch {}

const urlResults = [];
let urlOk = 0;
let urlFail = 0;
const concurrency = 24;
for (let i = 0; i < urlChecks.length; i += concurrency) {
  const chunk = urlChecks.slice(i, i + concurrency);
  const results = await Promise.all(chunk.map(async (item) => {
    try {
      const response = await fetch(item.url, { method: 'HEAD', redirect: 'follow' });
      return { ...item, status: response.status, contentType: response.headers.get('content-type') ?? '', ok: response.ok };
    } catch (error) {
      return { ...item, status: 0, contentType: '', ok: false, error: String(error?.message ?? error) };
    }
  }));
  urlResults.push(...results);
  urlOk += results.filter((x) => x.ok && /^image\//iu.test(x.contentType)).length;
  urlFail += results.length - results.filter((x) => x.ok && /^image\//iu.test(x.contentType)).length;
}

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 300 },
  summary: 'hair photo prompt v2 formula error scan',
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
for (const [name, options] of [
  ['hair-photo-prompt-v2-preview.png', { sheetName: 'Export Products Sheet', range: 'A1:O8', scale: 1, format: 'png' }],
  ['hair-photo-prompt-v2-qa-preview.png', { sheetName: 'Фото QA', range: 'A1:K15', scale: 1, format: 'png' }],
]) {
  const image = await wb.render(options);
  await fs.writeFile(path.join(path.dirname(outputPath), name), new Uint8Array(await image.arrayBuffer()));
}

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
const report = {
  inputPath,
  outputPath,
  products: rows.length,
  photos: urlChecks.length,
  allPhotoFilesPresent: true,
  allPhotoFiles1280Square: true,
  allFivePerProduct: photoQa.every((q) => q.count === 5),
  publicUrlChecks: { ok: urlOk, failed: urlFail, total: urlResults.length, allOk: urlFail === 0 },
  formulaErrors: formulaErrors.ndjson || '',
  sourceFolderLocal: localRoot,
  mapPath: photoMapPath,
  sampleProductsReviewed: ['35077', '35082', '23290'],
  urlResults,
};
await fs.writeFile(path.join(path.dirname(outputPath), 'hair-photo-prompt-v2-qa.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, products: rows.length, photos: urlChecks.length, publicUrlChecks: report.publicUrlChecks, formulaErrors: report.formulaErrors }, null, 2));
