import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sh = wb.worksheets.getItem('Export Products Sheet');
const rows = sh.getRange('A2:DD101').values;

const text = (v) => String(v ?? '').trim();
const norm = (v) => text(v).toLowerCase().replace(/ё/g, 'е').replace(/ґ/g, 'г').replace(/і/g, 'и').replace(/ї/g, 'и').replace(/є/g, 'е').replace(/[^\p{L}\p{N}]+/giu, ' ').trim();
const phrases = (v) => text(v).split(',').map((x) => x.trim()).filter(Boolean);
const stripHtml = (v) => text(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const ruLeak = /\b(?:дощовик|сушарка|парасоля|підставка|зволожувач|щітка|дверної|кріпильна|взуття|білизни|тримач|для дому|україн|на кухні|пошуку)\b/iu;
const uaLeak = /\b(?:дождевик|сушилка|зонт|подставка|увлажнитель|щетка|дверной|крепежн|обувь|белья|держатель|для дома|русск|поиска)\b/iu;
const forbidden = /\b(?:UG\s*OPT|UG-OPT|SKU|артикул|supplier|поставщик|source\s*code|internal\s*id)\b/iu;
const awkward = [
  /\bэлектрический\s+электросушилка\b/iu,
  /\bмногоразовый\s+многоразовая\b/iu,
  /\bкомпактный\s+компактная\b/iu,
  /\bкупить\s+[^,]+\b(?:ая|яя|а)\b/iu,
  /\bзаказать\s+[^,]+\b(?:ая|яя|а)\b/iu,
  /\bэлектричний\s+електросушарка\b/iu,
  /\bбагаторазовий\s+багаторазова\b/iu,
  /\bкомпактний\s+компактна\b/iu,
  /\bкупити\s+[^,]+\b(?:а|я)\b/iu,
  /\bзамовити\s+[^,]+\b(?:а|я)\b/iu,
];

const failures = [];
const summary = {
  rows: rows.length,
  ruKeywords25: 0,
  uaKeywords25: 0,
  ruKeywords1024: 0,
  uaKeywords1024: 0,
  htmlRu250: 0,
  htmlUa270: 0,
  categories: 0,
  retailOnly: 0,
  ids: 0,
  photoLinks5: 0,
  ruLeak: 0,
  uaLeak: 0,
  forbidden: 0,
  awkwardKeywords: 0,
  duplicateKeywords: 0,
};

for (const r of rows) {
  const code = text(r[0]);
  const ruTitle = text(r[1]);
  const uaTitle = text(r[2]);
  const ruKw = text(r[3]);
  const uaKw = text(r[4]);
  const ruDesc = stripHtml(r[5]);
  const uaDesc = stripHtml(r[6]);
  const retail = text(r[8]);
  const wholesale = text(r[12]);
  const wholesaleMin = text(r[13]);
  const photoLinks = text(r[14]).split(',').map((x) => x.trim()).filter(Boolean);
  const categoryRu = text(r[17]);
  const categoryUa = text(r[18]);
  const publicText = [ruTitle, uaTitle, ruKw, uaKw, ruDesc, uaDesc, categoryRu, categoryUa].join(' ');
  const problems = [];

  const ruP = phrases(ruKw);
  const uaP = phrases(uaKw);
  if (ruP.length >= 25) summary.ruKeywords25++;
  else problems.push(`RU keywords ${ruP.length}`);
  if (uaP.length >= 25) summary.uaKeywords25++;
  else problems.push(`UA keywords ${uaP.length}`);
  if (ruKw.length <= 1024) summary.ruKeywords1024++;
  else problems.push(`RU keywords ${ruKw.length} chars`);
  if (uaKw.length <= 1024) summary.uaKeywords1024++;
  else problems.push(`UA keywords ${uaKw.length} chars`);
  if (text(r[44]).length <= 250) summary.htmlRu250++;
  else problems.push(`HTML RU ${text(r[44]).length} chars`);
  if (text(r[45]).length <= 270) summary.htmlUa270++;
  else problems.push(`HTML UA ${text(r[45]).length} chars`);
  if (categoryRu && categoryUa) summary.categories++;
  else problems.push('category missing');
  if (retail && !wholesale && !wholesaleMin) summary.retailOnly++;
  else problems.push('wholesale fields not blank or retail missing');
  const numericCode = Number(code.replace(/^U|U$/g, ''));
  if (Number(r[24]) === numericCode && /^\d+$/.test(text(r[24]))) summary.ids++;
  else problems.push('identifier mismatch');
  if (photoLinks.length >= 5 && photoLinks.every((x) => /^https:\/\/drive\.google\.com\/uc\?export=view&id=/.test(x))) summary.photoLinks5++;
  else problems.push(`photo links ${photoLinks.length}`);

  if (ruLeak.test([ruTitle, ruKw, ruDesc].join(' '))) { summary.ruLeak++; problems.push('RU field contains UA token'); }
  if (uaLeak.test([uaTitle, uaKw, uaDesc].join(' '))) { summary.uaLeak++; problems.push('UA field contains RU token'); }
  if (forbidden.test(publicText)) { summary.forbidden++; problems.push('forbidden internal token'); }
  for (const p of [...ruP, ...uaP]) {
    if (p.includes('…')) problems.push('ellipsis in keywords');
    if (awkward.some((re) => re.test(p))) { summary.awkwardKeywords++; problems.push(`awkward keyword: ${p}`); break; }
  }
  const ruNorm = ruP.map(norm);
  const uaNorm = uaP.map(norm);
  if (new Set(ruNorm).size !== ruNorm.length || new Set(uaNorm).size !== uaNorm.length) {
    summary.duplicateKeywords++;
    problems.push('duplicate keywords');
  }
  if (problems.length) failures.push({ code, problems });
}

console.log(JSON.stringify({ summary, failureCount: failures.length, failures: failures.slice(0, 40) }, null, 2));
