import fs from 'node:fs/promises';

const inputPath = process.argv[2] ?? './outputs/hair-styling-all-2026-09-05/hair-styling-source-data-enriched.json';
const outputPath = process.argv[3] ?? './outputs/hair-styling-all-2026-09-05/hair-styling-requested-source-data.json';
const data = JSON.parse((await fs.readFile(inputPath, 'utf8')).replace(/^\uFEFF/u, ''));
const source = Array.isArray(data) ? data : data.products;
const clean = (v) => String(v ?? '').replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim();
const included = source.filter((p) => {
  const t = [p.title, p.description, ...(p.attributes ?? []).flatMap((a) => [a.name, a.value])].map(clean).join(' ');
  return !/гребін|гребен|расчес|розчіс|масажн|массажн/iu.test(t) || /бигуд|бігуд|термобігуд|термобигуд/iu.test(t);
});
const out = { ...data, products: included, scannedUnique: source.length, selectedCount: included.length, selectionRule: 'Requested types only: hair dryers, curling irons, crimpers/straighteners and curlers; combs excluded.' };
await fs.writeFile(outputPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ input: source.length, output: included.length, excluded: source.length - included.length, outputPath }, null, 2));
