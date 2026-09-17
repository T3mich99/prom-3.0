import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputDir = process.argv[3];
const sourceDataDir = process.argv[4];
const manifestPath = process.argv[5];
const driveMapPath = process.argv[6];
await fs.mkdir(outputDir, { recursive: true });

const parseJsonFiles = async (dir, prefix) => {
  const names = (await fs.readdir(dir)).filter((n) => n.startsWith(prefix) && n.endsWith('.json')).sort();
  const all = [];
  for (const n of names) all.push(...JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')));
  return all;
};
const source = await parseJsonFiles(sourceDataDir, 'selected-');
const byCode = new Map(source.map((p) => [String(p.code), p]));
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const bySku = new Map((manifest.selected || []).map((p) => [String(p.sourceSku), p]));
const drive = new Map();
for (const line of (await fs.readFile(driveMapPath, 'utf8')).split(/\r?\n/).filter(Boolean)) {
  const x = JSON.parse(line); if (x.name) drive.set(x.name, x);
}

const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const short = (s, max) => { const t = clean(s); return t.length <= max ? t : `${t.slice(0, max - 1).trim()}…`; };
const imageUrl = (code, index, p) => {
  const role = ['01_main', '02_benefits', '03_features', '04_use', '05_details'][index];
  const item = drive.get(`${code}_${role}.png`);
  if (item?.success && item.id) return `https://drive.google.com/uc?export=view&id=${item.id}`;
  const imgs = Array.isArray(p?.images) ? p.images : [];
  return imgs[index] || imgs.at(-1) || '';
};

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = wb.worksheets.getItem('Export Products Sheet');
const data = sheet.getRange('A2:DD101').values;
const imageValues = [];
const categoryValues = [];
const groupNameValues = [];
const wholesaleValues = [];
const htmlValues = [];
const categoryIdValues = [];
const quality = [];

for (let i = 0; i < data.length; i++) {
  const row = data[i];
  const code = String(row[0] ?? '').replace(/^U|U$/g, '');
  const p = byCode.get(code);
  const m = bySku.get(code);
  const links = [0, 1, 2, 3, 4].map((j) => imageUrl(code, j, p));
  const catId = m?.categoryId ?? row[26] ?? '';
  const catName = m?.categoryName ?? '';
  const ruName = row[1] || clean(p?.name || 'Товар');
  const uaName = row[2] || clean(p?.name || 'Товар');
  const htmlRu = `<p>${esc(short(ruName, 105))}. Практичный товар для дома и повседневного использования.</p>`;
  const htmlUa = `<p>${esc(short(uaName, 125))}. Практичний товар для дому та щоденного використання.</p>`;
  imageValues.push([links.join(', ')]);
  categoryValues.push([Number.isFinite(Number(catId)) && String(catId).trim() !== '' ? Number(catId) : catId]);
  groupNameValues.push([catName]);
  wholesaleValues.push([null, null]);
  htmlValues.push([htmlRu, htmlUa]);
  categoryIdValues.push([catId]);
  quality.push({ code, links, category: catName, htmlRuLength: htmlRu.length, htmlUaLength: htmlUa.length, wholesaleBlank: row[12] == null && row[13] == null });
}

sheet.getRange('O2:O101').values = imageValues;
sheet.getRange('R2:R101').values = categoryValues;
sheet.getRange('S2:S101').values = groupNameValues;
sheet.getRange('M2:N101').values = wholesaleValues;
sheet.getRange('AO2:AP101').values = htmlValues;
sheet.getRange('AA2:AA101').values = categoryIdValues;

const checks = {
  rows: quality.length,
  fiveLinks: quality.filter((x) => x.links.filter(Boolean).length === 5).length,
  categories: quality.filter((x) => x.category).length,
  retailOnly: quality.filter((x) => x.wholesaleBlank).length,
  htmlRuOk: quality.filter((x) => x.htmlRuLength <= 250).length,
  htmlUaOk: quality.filter((x) => x.htmlUaLength <= 270).length,
};
if (Object.values(checks).some((v) => v !== checks.rows && v !== checks.fiveLinks && v !== checks.categories && v !== checks.retailOnly && v !== checks.htmlRuOk && v !== checks.htmlUaOk)) {}
if (checks.rows !== 100 || checks.fiveLinks !== 100 || checks.categories !== 100 || checks.htmlRuOk !== 100 || checks.htmlUaOk !== 100) throw new Error(`QA failed: ${JSON.stringify(checks)}`);

const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan' });
const preview = await wb.render({ sheetName: 'Export Products Sheet', range: 'A1:T15', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'products-preview.png'), new Uint8Array(await preview.arrayBuffer()));
const out = await SpreadsheetFile.exportXlsx(wb);
const outputPath = path.join(outputDir, 'Prom-UGOPT-100-final-with-500-photos.xlsx');
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, formulaErrors: errors.ndjson || '' }));
