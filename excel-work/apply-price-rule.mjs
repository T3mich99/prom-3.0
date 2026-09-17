import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const qa = wb.worksheets.getItem('Pricing QA');

const productRows = products.getRange('A2:I101').values;
const qaRows = qa.getRange('A2:M101').values;

const normalizeCode = (value) => String(value ?? '').replace(/^U|U$/g, '').trim();

function priceRule(purchase) {
  if (purchase <= 100) return { markup: 200, minMarkup: 150, minProfit: 0 };
  if (purchase <= 300) return { markup: 150, minMarkup: 0, minProfit: 0 };
  if (purchase <= 500) return { markup: 120, minMarkup: 0, minProfit: 0 };
  if (purchase <= 800) return { markup: 80, minMarkup: 0, minProfit: 0 };
  if (purchase <= 1000) return { markup: 90, minMarkup: 0, minProfit: 500 };
  if (purchase <= 1500) return { markup: 70, minMarkup: 0, minProfit: 500 };
  if (purchase <= 2000) return { markup: 60, minMarkup: 0, minProfit: 600 };
  if (purchase <= 3000) return { markup: 50, minMarkup: 0, minProfit: 700 };
  if (purchase <= 5000) return { markup: 40, minMarkup: 0, minProfit: 900 };
  if (purchase <= 7500) return { markup: 35, minMarkup: 0, minProfit: 1200 };
  if (purchase <= 10000) return { markup: 30, minMarkup: 0, minProfit: 1500 };
  return { markup: 25, minMarkup: 0, minProfit: Math.max(1800, purchase * 0.15) };
}

const qaByCode = new Map();
for (let i = 0; i < qaRows.length; i++) qaByCode.set(normalizeCode(qaRows[i][0]), { row: qaRows[i], index: i });

const newProductPrices = [];
const newQa = [];
const report = [];

for (let i = 0; i < productRows.length; i++) {
  const code = normalizeCode(productRows[i][0]);
  const qaItem = qaByCode.get(code);
  if (!qaItem) throw new Error(`Pricing QA row missing for ${code}`);

  const qaRow = qaItem.row;
  const purchase = Number(qaRow[3]);
  const commissionPct = Number(qaRow[4]);
  const commission = commissionPct / 100;
  const delivery = 105;
  if (!Number.isFinite(purchase) || !Number.isFinite(commission)) throw new Error(`Invalid pricing inputs for ${code}`);

  const rule = priceRule(purchase);
  const priceByMarkup = purchase * (1 + rule.markup / 100);
  // For every tier, protect against a loss when delivery is paid by us.
  // For lower tiers the rule has no positive MIN_NET_PROFIT, so the floor is 0.
  const priceByMinProfit = (purchase + rule.minProfit + delivery) / (1 - commission);
  const rawPrice = Math.max(priceByMarkup, priceByMinProfit);
  const finalPrice = Math.ceil(rawPrice);
  const netExpected = finalPrice - finalPrice * commission - purchase - delivery;
  const netWorst = finalPrice - finalPrice * commission - purchase - 120;
  const status = netExpected + 1e-9 < rule.minProfit ? 'PRICE_RULE_ERROR' : 'OK';
  if (status !== 'OK') throw new Error(`Net profit QA failed for ${code}`);

  newProductPrices.push([finalPrice]);

  const updated = [...qaRow];
  updated[5] = delivery;
  updated[6] = 120;
  updated[7] = rule.minProfit;
  updated[8] = Math.max(rule.minProfit, Math.round(netExpected * 100) / 100);
  updated[9] = finalPrice;
  updated[10] = Math.round(netExpected * 100) / 100;
  updated[11] = Math.round(netWorst * 100) / 100;
  updated[12] = status;
  newQa.push(updated);
  report.push({ code, purchase, commissionPct, markupPct: rule.markup, minProfit: rule.minProfit, priceByMarkup, priceByMinProfit, finalPrice, netExpected, netWorst, status });
}

products.getRange('I2:I101').values = newProductPrices;
qa.getRange('A2:M101').values = newQa;

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'price rule formula error scan',
});
const preview = await wb.render({ sheetName: 'Pricing QA', range: 'A1:M18', scale: 1, format: 'png' });
await fs.writeFile(path.join(path.dirname(outputPath), 'pricing-qa-preview.png'), new Uint8Array(await preview.arrayBuffer()));

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
await fs.writeFile(path.join(path.dirname(outputPath), 'pricing-rule-report.json'), JSON.stringify({ rule: 'MASTER PRICE RULE — UG OPT → PROM.UA', delivery: 105, products: report, formulaErrors: formulaErrors.ndjson || '' }, null, 2), 'utf8');

const summary = {
  rows: report.length,
  minPrice: Math.min(...report.map((x) => x.finalPrice)),
  maxPrice: Math.max(...report.map((x) => x.finalPrice)),
  avgNetExpected: report.reduce((sum, x) => sum + x.netExpected, 0) / report.length,
  statuses: report.reduce((acc, x) => { acc[x.status] = (acc[x.status] || 0) + 1; return acc; }, {}),
  outputPath,
  formulaErrors: formulaErrors.ndjson || '',
};
console.log(JSON.stringify(summary));
