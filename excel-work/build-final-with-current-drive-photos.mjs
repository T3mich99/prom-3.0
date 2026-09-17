import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputDir = process.argv[3];
const sourceDataDir = process.argv[4];
const manifestPath = process.argv[5];
const driveMapPath = process.argv[6];

if (!inputPath || !outputDir || !sourceDataDir || !manifestPath || !driveMapPath) {
  throw new Error('Usage: node build-final-with-current-drive-photos.mjs <input.xlsx> <outputDir> <sourceDataDir> <manifest.json> <drive-map.json>');
}

await fs.mkdir(outputDir, { recursive: true });

const parseJsonFiles = async (dir, prefix) => {
  const names = (await fs.readdir(dir))
    .filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
    .sort();
  const all = [];
  for (const n of names) all.push(...JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')));
  return all;
};

const source = await parseJsonFiles(sourceDataDir, 'selected-');
const byCode = new Map(source.map((p) => [String(p.code), p]));
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const bySku = new Map((manifest.selected || []).map((p) => [String(p.sourceSku), p]));
const drive = JSON.parse(await fs.readFile(driveMapPath, 'utf8'));
const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];

const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const sourceImageUrl = (p, index) => {
  const imgs = Array.isArray(p?.images) ? p.images.filter(Boolean) : [];
  return imgs[index] || imgs.at(-1) || '';
};
const linkFor = (code, role) => {
  const item = drive[code + '_' + role + '.png'];
  return item?.id ? 'https://drive.google.com/uc?export=download&id=' + item.id : '';
};
const linksFor = (code, p) => {
  const ai = roles.map((role) => linkFor(code, role));
  const sourceLinks = roles.map((_, index) => sourceImageUrl(p, index));
  const links = ai.map((url, index) => url || sourceLinks[index]).filter(Boolean);
  return { links, aiCount: ai.filter(Boolean).length, sourceFallbackCount: ai.filter((url) => !url && sourceLinks[ai.indexOf(url)]).length };
};

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = wb.worksheets.getItem('Export Products Sheet');
const data = sheet.getRange('A2:DD101').values;
const imageValues = [];
const categoryValues = [];
const groupNameValues = [];
const categoryIdValues = [];
const wholesaleValues = [];
const photoQa = [];

for (let i = 0; i < data.length; i++) {
  const row = data[i];
  const code = String(row[0] ?? '').replace(/^U|U$/g, '');
  const p = byCode.get(code);
  const m = bySku.get(code);
  const photo = linksFor(code, p);
  const catId = m?.categoryId ?? row[26] ?? '';
  const catName = m?.categoryName ?? row[18] ?? '';

  imageValues.push([photo.links.join(', ')]);
  categoryValues.push([Number.isFinite(Number(catId)) && String(catId).trim() !== '' ? Number(catId) : catId]);
  groupNameValues.push([catName]);
  categoryIdValues.push([catId]);
  wholesaleValues.push([null, null]);
  photoQa.push({
    code,
    aiLinks: photo.aiCount,
    totalLinks: photo.links.length,
    sourceFallback: photo.aiCount < 5,
    sourceImageCount: Array.isArray(p?.images) ? p.images.filter(Boolean).length : 0,
    category: catName,
    note: photo.aiCount === 5 ? '5 AI-фото в Google Drive' : (code === '10583' ? 'AI-фото не создано: модерация; оставлены исходные фото поставщика' : 'Часть AI-фото временно недоступна из-за лимита загрузки Drive; оставлены исходные фото поставщика')
  });
}

sheet.getRange('O2:O101').values = imageValues;
sheet.getRange('R2:R101').values = categoryValues;
sheet.getRange('S2:S101').values = groupNameValues;
sheet.getRange('AA2:AA101').values = categoryIdValues;
sheet.getRange('M2:N101').values = wholesaleValues;

const checks = {
  rows: data.length,
  categories: photoQa.filter((x) => x.category).length,
  retailOnly: data.length,
  fiveAiPhotos: photoQa.filter((x) => x.aiLinks === 5).length,
  allRowsHavePhotoLink: photoQa.filter((x) => x.totalLinks > 0).length,
  fallbackRows: photoQa.filter((x) => x.sourceFallback).length
};
if (checks.rows !== 100 || checks.categories !== 100 || checks.allRowsHavePhotoLink !== 100) {
  throw new Error('Photo/category QA failed: ' + JSON.stringify(checks));
}

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan'
});

const previews = [
  ['products-preview.png', { sheetName: 'Export Products Sheet', range: 'A1:T15', scale: 1, format: 'png' }],
  ['groups-preview.png', { sheetName: 'Export Groups Sheet', range: 'A1:L15', scale: 1, format: 'png' }],
  ['pricing-preview.png', { sheetName: 'Pricing QA', range: 'A1:M18', scale: 1, format: 'png' }]
];
for (const [fileName, options] of previews) {
  const preview = await wb.render(options);
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await preview.arrayBuffer()));
}

await fs.writeFile(path.join(outputDir, 'photo-qa.json'), JSON.stringify({ checks, photoQa, formulaErrors: formulaErrors.ndjson || '' }, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
const outputPath = path.join(outputDir, 'Prom-UGOPT-100-final-2026-08-31.xlsx');
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, formulaErrors: formulaErrors.ndjson || '' }));
