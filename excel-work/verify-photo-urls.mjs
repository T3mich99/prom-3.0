import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { PROM_SHEETS, headerIndex } from '../src/contracts/prom-excel.mjs';

const inputPath = process.argv[2];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sh = wb.worksheets.getItem(PROM_SHEETS.PRODUCTS);
const values = sh.getUsedRange().values;
const headers = values[0].map((v) => String(v ?? ''));
const codeIx = headerIndex(headers, 'Код_товару');
const photoIx = headerIndex(headers, 'Посилання_зображення');
const rows = values.slice(1).filter((r) => String(r[codeIx] ?? '').trim());
const urls = rows.flatMap((r) => String(r[photoIx] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const results = [];
let cursor = 0;
const worker = async () => {
  while (true) {
    const i = cursor++;
    if (i >= urls.length) return;
    const url = urls[i];
    try {
      const response = await fetch(url, { headers: { Range: 'bytes=0-1023' }, redirect: 'follow' });
      const contentType = response.headers.get('content-type') ?? '';
      const contentLength = response.headers.get('content-length') ?? '';
      await response.body?.cancel();
      results[i] = { url, status: response.status, contentType, contentLength };
    } catch (error) {
      results[i] = { url, error: String(error?.message ?? error) };
    }
  }
};
await Promise.all(Array.from({ length: 12 }, worker));
const bad = results.filter((r) => r.error || r.status < 200 || r.status >= 300 || !/^image\/(png|jpe?g|gif)$/iu.test(r.contentType));
console.log(JSON.stringify({
  products: rows.length,
  urls: urls.length,
  directLh3Urls: urls.filter((u) => /^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]+=w1280$/u.test(u)).length,
  badCount: bad.length,
  bad: bad.slice(0, 20),
  contentTypes: [...new Set(results.map((r) => r.contentType).filter(Boolean))],
}, null, 2));
