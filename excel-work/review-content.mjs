import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const sourceDir = process.argv[3];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sh = wb.worksheets.getItem('Export Products Sheet');
const rows = sh.getRange('A2:DD101').values;

const files = (await fs.readdir(sourceDir)).filter((n) => n.startsWith('selected-') && n.endsWith('.json')).sort();
const source = [];
for (const file of files) source.push(...JSON.parse(await fs.readFile(path.join(sourceDir, file), 'utf8')));
const byCode = new Map(source.map((p) => [String(p.code), p]));
const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const out = rows.map((r) => {
  const code = String(r[0] ?? '').replace(/^U|U$/g, '');
  const p = byCode.get(code);
  return {
    code,
    titleRu: r[1], titleUa: r[2],
    descRuLen: clean(r[5]).length, descUaLen: clean(r[6]).length,
    categoryId: r[17], categoryName: r[18], sourceName: p?.name || '',
    sourceChars: p?.chars?.length || 0,
    publicContent: `${r[1] || ''} ${r[2] || ''} ${r[5] || ''} ${r[6] || ''}`,
  };
});
console.log(JSON.stringify({
  rows: out.length,
  missingCategory: out.filter((x) => !x.categoryId || !x.categoryName).map((x) => ({ code: x.code, categoryId: x.categoryId, categoryName: x.categoryName, titleRu: x.titleRu })),
  shortRu: out.filter((x) => x.descRuLen < 500).map((x) => ({ code: x.code, length: x.descRuLen })),
  shortUa: out.filter((x) => x.descUaLen < 500).map((x) => ({ code: x.code, length: x.descUaLen })),
  samples: out.slice(0, 10).map(({ publicContent, ...x }) => x),
}, null, 2));
