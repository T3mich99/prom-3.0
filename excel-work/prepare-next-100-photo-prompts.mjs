import fs from 'node:fs/promises';
import path from 'node:path';

const sourcePath = process.argv[2];
const overridesPath = process.argv[3];
const outputPath = process.argv[4];
const root = path.dirname(outputPath);
const data = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8'));

const clean = (v) => String(v ?? '').replace(/\s+/gu, ' ').trim();
const text = (v) => clean(v).replace(/[<>]/gu, '');
const isGarden = (t) => /сад|обприс|газонокос|секатор|культиватор|рослин|садов/iu.test(t);
const isTool = (t) => /інструмент|инструмент|дрил|пил|викрут|шуруп|гайков|болгар|паял|драб|штанген|молот|лобз|компрес|ножиц|лопат|мультиметр|цвях|дюбел|розпил|подовжувач|удлинител/iu.test(t);

const shorten = (v, max = 34) => {
  const s = text(v);
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/[ ,;:–—-]+$/u, '')}…`;
};

const prompts = [];
for (const p of data.products) {
  const code = clean(p.sku);
  const dir = path.join(root, 'sources', code);
  const files = (await fs.readdir(dir)).filter((f) => /\.(?:png|jpe?g|webp)$/iu.test(f)).sort().slice(0, 5);
  if (!files.length) throw new Error(`No supplier source images for ${code}`);
  const refs = files.map((f) => path.join(dir, f));
  const title = overrides[code] ?? { ru: text(p.title), ua: text(p.title) };
  const all = `${title.ua} ${p.title} ${(p.attributes ?? []).map((a) => `${a.name} ${a.value}`).join(' ')}`;
  const kind = isGarden(all) ? 'garden' : isTool(all) ? 'tool' : 'home';
  const attrs = (p.attributes ?? [])
    .filter((a) => !/країн|стан|виробник/iu.test(`${a.name} ${a.value}`))
    .slice(0, 4)
    .map((a) => `${shorten(a.name, 24)}: ${shorten(a.value, 30)}`);
  const benefits = kind === 'garden'
    ? ['Для догляду за ділянкою', 'Зручний формат роботи', 'Практичне рішення для саду']
    : kind === 'tool'
      ? ['Для ремонтних робіт', 'Зручно тримати під рукою', 'Практичний формат']
      : ['Допомагає підтримувати порядок', 'Зручний формат використання', 'Охайне рішення для дому'];
  const usePhrase = kind === 'garden'
    ? 'Для саду, дачі та догляду за рослинами'
    : kind === 'tool'
      ? 'Для домашньої майстерні та господарських робіт'
      : 'Для зручного використання вдома';
  prompts.push({ code, sourceDir: dir, refs, title, attrs, benefits, usePhrase, kind });
}

await fs.writeFile(outputPath, JSON.stringify({ createdAt: new Date().toISOString(), count: prompts.length, prompts }, null, 2), 'utf8');
console.log(JSON.stringify({ count: prompts.length, outputPath }));
