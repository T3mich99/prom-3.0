import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const inputPath = process.argv[2];
const mapPath = process.argv[3];
const map = JSON.parse(await fs.readFile(mapPath, 'utf8')).images ?? {};
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sh = wb.worksheets.getItem('Export Products Sheet');
const used = sh.getUsedRange();
const h = used.values[0];
const ix = Object.fromEntries(h.map((x, i) => [x, i]));
const rows = used.values.slice(1).filter((r) => String(r[ix['Код_товару']] ?? '').trim());
const roles = ['01_main.png', '02_benefits.png', '03_features.png', '04_use.png', '05_details.png'];
const idFrom = (url) => String(url ?? '').match(/[?&]id=([^&]+)/)?.[1] ?? '';
const failures = [];
for (const r of rows) {
  const code = String(r[ix['Код_товару']] ?? '').trim();
  const links = String(r[ix['Посилання_зображення']] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const expected = roles.map((role) => map[code]?.[role] ?? '');
  const actual = links.map(idFrom);
  if (links.length !== 5 || expected.some((x, i) => !x || actual[i] !== x) || links.some((x) => !/^https:\/\/drive\.google\.com\/uc\?export=(?:download|view)&id=/.test(x))) failures.push({ code, links, actual, expected });
}
console.log(JSON.stringify({ folderId: JSON.parse(await fs.readFile(mapPath, 'utf8')).folderId, rows: rows.length, exactFiveNewPhotoRows: rows.length - failures.length, failures: failures.slice(0, 10) }, null, 2));
