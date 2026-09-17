import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const rows = wb.worksheets.getItem('Export Products Sheet').getRange('A2:AP101').values;
const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ');
const ruTokens = /\b(?:із|зі|та|під|взуття|сушарка|сушарки|білизни|помпи|щітки|дощовик|плівка|підставки|ванної|кімнати|дверної|захисту|дітей|тварин|посуду|раковини)\b/iu;
const forbidden = /\b(?:UG\s*OPT|supplier|поставщик|source|артикул|SKU|Raincoat|AND\s*[-]?\d+|AE\s*[-]?\d+|XL\s*[-]?\d+)\b/iu;
const ruLanguage = rows.filter((r) => ruTokens.test(`${r[1]} ${r[3]} ${r[5]}`)).map((r) => r[0]);
const publicForbidden = rows.filter((r) => forbidden.test(`${r[1]} ${r[2]} ${r[3]} ${r[4]} ${clean(r[5])} ${clean(r[6])}`)).map((r) => r[0]);
console.log(JSON.stringify({ rows: rows.length, ruLanguageSuspects: ruLanguage, forbiddenPublicContent: publicForbidden }, null, 2));
