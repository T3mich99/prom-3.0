import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
const used = sh.getUsedRange();
const h = used.values[0];
const ix = Object.fromEntries(h.map((x, i) => [x, i]));
const rows = used.values.slice(1).filter((r) => String(r[ix['Код_товару']] ?? '').trim());
const uaChars = /[іїєґІЇЄҐ]/u;
const ruChars = /[ыэёъЫЭЁЪ]/u;
const stripHtml = (value) => String(value ?? '').replace(/<[^>]*>/gu, ' ');
const model = /(модель|артикул|sku|ug[- ]?opt|поставщик|supplier|source code)/iu;
const out = rows.map((r) => ({
  code: r[ix['Код_товару']],
  ruTitle: r[ix['Назва_позиції']],
  uaTitle: r[ix['Назва_позиції_укр']],
  ruDesc: r[ix['Опис']],
  uaDesc: r[ix['Опис_укр']],
  ruKw: r[ix['Пошукові_запити']],
  uaKw: r[ix['Пошукові_запити_укр']],
}));
const fields = ['ruTitle', 'ruDesc', 'ruKw', 'uaTitle', 'uaDesc', 'uaKw'];
for (const f of fields) {
  const bad = out.filter((x) => f.startsWith('ru') ? uaChars.test(stripHtml(x[f])) : ruChars.test(stripHtml(x[f])));
  console.log(JSON.stringify({ field: f, bad: bad.length, samples: bad.slice(0, 8).map((x) => ({ code: x.code, value: x[f] })) }));
}
const modelBad = out.filter((x) => model.test([x.ruTitle, x.uaTitle, x.ruDesc, x.uaDesc, x.ruKw, x.uaKw].join(' ')));
console.log(JSON.stringify({ modelOrInternalTokens: modelBad.length, samples: modelBad.slice(0, 8).map((x) => ({ code: x.code, ruTitle: x.ruTitle, uaTitle: x.uaTitle })) }));
const ukWords = new Set();
for (const x of out) for (const f of ['ruTitle', 'ruDesc', 'ruKw']) for (const word of String(x[f] ?? '').match(/[\p{L}]*[іїєґІЇЄҐ][\p{L}]*/gu) ?? []) ukWords.add(word);
console.log(JSON.stringify({ ukWords: [...ukWords].sort((a, b) => a.localeCompare(b, 'uk-UA')) }));
