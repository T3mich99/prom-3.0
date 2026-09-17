import fs from 'node:fs/promises';

const sourcePath = process.argv[2] ?? 'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-01/next-100-source-data-enriched.json';
const outputPath = process.argv[3];
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8')).products;
const categories = JSON.parse(await fs.readFile('C:/Users/Dell/Documents/kasta/outputs/prom-commission-categories.json', 'utf8'))
  .filter((c) => Array.isArray(c.path) && c.path.includes('товари для дому') && Number(c.level) >= 3 && c.order_commission != null);
const stop = new Set('для та з із на у в до під над це цей ця його її новий нове нова набір універсальний побутовий побутова домашній домашня різні товар загальне загальна'.split(' '));
const stem = (s) => String(s ?? '').toLocaleLowerCase('uk-UA').replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter((x) => x.length >= 4 && !stop.has(x));
const overlap = (a, b) => {
  const aa = new Set(stem(a));
  const bb = new Set(stem(b));
  let score = 0;
  for (const x of aa) for (const y of bb) if (x === y || x.startsWith(y) || y.startsWith(x)) score += x === y ? 3 : 1;
  return score;
};
const out = source.map((p) => {
  const text = [p.title, p.description, ...(p.attributes ?? []).flatMap((a) => [a.name, a.value])].join(' ');
  const ranked = categories.map((c) => ({ c, score: overlap(text, c.name + ' ' + c.path.slice(-3).join(' ')) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.c.name).localeCompare(String(b.c.name), 'uk'))
    .slice(0, 5)
    .map((x) => ({ id: x.c.id, name: x.c.name, score: x.score, commission: x.c.order_commission }));
  return { sku: p.sku, title: p.title, top: ranked };
});
const serialized = JSON.stringify(out, null, 2);
if (outputPath) await fs.writeFile(outputPath, serialized, 'utf8');
console.log(serialized);
