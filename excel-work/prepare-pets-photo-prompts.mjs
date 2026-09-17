import fs from 'node:fs/promises';
import path from 'node:path';

const sourcePath = process.argv[2] ?? './outputs/pets-all-2026-09-05/all-pets-source-data-enriched.json';
const outputPath = process.argv[3] ?? './outputs/pets-all-2026-09-05/pets-photo-prompts.json';
const root = path.dirname(outputPath);
const data = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const clean = (v) => String(v ?? '').replace(/\s+/gu, ' ').trim();
const text = (v) => clean(v).replace(/[<>]/gu, '');
const shorten = (v, max = 34) => { const s = text(v); return s.length <= max ? s : `${s.slice(0, max - 1).replace(/[ ,;:–—-]+$/u, '')}…`; };
const kindFor = (p) => {
  const t = `${p.title} ${p.description}`.toLocaleLowerCase('uk-UA');
  if (/акваріум|fish tank/iu.test(t)) return 'aquarium';
  if (/басейн/iu.test(t)) return 'pool';
  if (/кігтеточ|кігтедер|дряп/iu.test(t)) return 'scratcher';
  if (/лежанк|будиноч|рюкзак.*перенос|перенос/iu.test(t)) return 'comfort';
  if (/одяг|курточ|кепк/iu.test(t)) return 'apparel';
  if (/повідец|повод|шлейк|нашийник/iu.test(t)) return 'walking';
  if (/машинк.*стриж|гребін|гребен|щіт|фурмін|фурмин|лапомий|дозатор мила/iu.test(t)) return 'grooming';
  if (/лоток|туалет|кістк.*зуб|зуб.*догляд/iu.test(t)) return 'hygiene';
  if (/свисток|тренер/iu.test(t)) return 'training';
  if (/миска|годівниц|поїл|кормуш|корм|бутыл|пляш|кулька.*їж|їжі/iu.test(t)) return 'feeding';
  return 'toy';
};
const roleCopy = {
  toy: { main: 'ІГРА ТА АКТИВНІСТЬ', sub: 'Іграшка для домашніх тварин', benefits: ['Цікаве дозвілля', 'Розвиває активність', 'Зручно гратися'], use: 'Для домашніх ігор та активного дозвілля' },
  feeding: { main: 'ЗРУЧНЕ ГОДУВАННЯ', sub: 'Практичний аксесуар для тварин', benefits: ['Порядок у зоні годування', 'Зручний формат', 'Для дому та прогулянок'], use: 'Для годування та напування домашніх тварин' },
  walking: { main: 'ЗРУЧНІ ПРОГУЛЯНКИ', sub: 'Аксесуар для вигулу тварин', benefits: ['Зручно використовувати', 'Допомагає контролювати тварину', 'Для щоденного вигулу'], use: 'Для прогулянок із домашнім улюбленцем' },
  grooming: { main: 'ДОГЛЯД ЗА ШЕРСТЮ', sub: 'Аксесуар для домашнього грумінгу', benefits: ['Охайний вигляд', 'Зручно використовувати', 'Для догляду вдома'], use: 'Для домашнього догляду за шерстю' },
  hygiene: { main: 'ЩОДЕННА ГІГІЄНА', sub: 'Практичний товар для догляду', benefits: ['Зручний догляд', 'Допомагає підтримувати чистоту', 'Для використання вдома'], use: 'Для догляду та підтримання чистоти' },
  aquarium: { main: 'АКУРАТНИЙ МІНІ-АКВАРІУМ', sub: 'Компактне рішення для дому', benefits: ['Компактний формат', 'Зручно розмістити вдома', 'Для акваріумного простору'], use: 'Для облаштування акваріумної зони вдома' },
  apparel: { main: 'КОМФОРТ ДЛЯ ПРОГУЛЯНОК', sub: 'Аксесуар для домашніх тварин', benefits: ['Зручна посадка', 'Для прогулянок', 'Практичний формат'], use: 'Для прогулянок у прохолодну або сонячну погоду' },
  comfort: { main: 'ЗАТИШНЕ МІСЦЕ ВДОМА', sub: 'Комфорт для домашнього улюбленця', benefits: ['Окреме місце для відпочинку', 'Зручно розмістити вдома', 'Практичний формат'], use: 'Для відпочинку та спокійного перебування тварини' },
  training: { main: 'ЗРУЧНЕ ДРЕСИРУВАННЯ', sub: 'Аксесуар для занять із собакою', benefits: ['Для базових занять', 'Зручно брати із собою', 'Допомагає утримувати увагу'], use: 'Для домашніх занять і дресирування' },
  scratcher: { main: 'ВЛАСНЕ МІСЦЕ ДЛЯ КІГТІВ', sub: 'Кігтеточка для котів', benefits: ['Окрема поверхня для кігтів', 'Зручно закріпити', 'Допомагає берегти меблі'], use: 'Для активності кота та догляду за кігтями' },
  pool: { main: 'ВОДНІ ПРОЦЕДУРИ ВДОМА', sub: 'Басейн для домашніх тварин', benefits: ['Для купання', 'Зручно використовувати влітку', 'Практичний формат'], use: 'Для купання та охолодження домашнього улюбленця' },
};
const prompts = [];
for (const p of data.products) {
  const code = clean(p.sku); const dir = path.join(root, 'sources', code); const files = (await fs.readdir(dir)).filter((f) => /\.(?:png|jpe?g|webp)$/iu.test(f)).sort().slice(0, 5); if (!files.length) throw new Error(`No supplier refs for ${code}`);
  const refs = files.map((f) => path.join(dir, f)); const kind = kindFor(p); const c = roleCopy[kind];
  const featureAttrs = (p.attributes ?? []).filter((a) => !/країн|стан|виробник|модель|артикул|код/iu.test(`${a.name} ${a.value}`)).slice(0, 4).map((a) => `${shorten(a.name, 25)}: ${shorten(a.value, 34)}`);
  const base = `Use the attached supplier reference images as the only product reference. Preserve the exact same product identity, construction, color, shape, seams, buttons, attachments, proportions and all visible details. Do not invent or alter any product element. Create a polished modern Prom.ua e-commerce image, square 1280x1280, premium category-matched composition, crisp realistic product photography, clean lighting, no people, no animals, no other products, no packaging, no brand logos, no watermarks, no price, no SKU, no model number, no Russian text, no Latin text in the design. All visible text must be Ukrainian only and must be short, readable on a phone.`;
  prompts.push({ code, sku: code, sourceDir: dir, refs, kind, titleUa: text(p.title), featureAttrs, roles: {
    '01_main': `${base} Role: main selling image. Use a strong frontal three-quarter camera angle, product large and central, clean light premium background with subtle category styling. Add only this Ukrainian headline: “${c.main}”. Add only this short subheadline: “${c.sub}”. No bullet list and no other text.`,
    '02_benefits': `${base} Role: benefits image. Use a clearly different opposite three-quarter camera angle and a new composition. Product remains the hero. Add Ukrainian heading “КЛЮЧОВІ ПЕРЕВАГИ” and exactly these short benefit phrases: “${c.benefits[0]}”, “${c.benefits[1]}”, “${c.benefits[2]}”. Use minimal elegant icons or separators, no extra wording.`,
    '03_features': `${base} Role: features image. Use a clearly different slightly top-down camera angle, clean infographic composition. Add Ukrainian heading “ОСОБЛИВОСТІ”. Show only these confirmed short labels and no invented specifications: ${featureAttrs.length ? featureAttrs.map((x) => `“${x}”`).join(', ') : '“Практичний формат”, “Для домашніх тварин”'}. Keep labels short and readable, no extra claims.`,
    '04_use': `${base} Role: usage context image. Show the exact same product in a beautiful realistic home context appropriate for its use, with a distinctly different camera angle and natural placement. Do not show any animal or person; show only an empty pet-friendly environment. Add only Ukrainian headline “${c.main}” and short phrase “${c.use}”. No other text.`,
    '05_details': `${base} Role: clean studio detail image. Use a new close-up camera angle focused on the most important visible product detail and texture. Minimal neutral studio background, premium lighting, no text at all, no circles, no arrows, no labels.`,
  }});
}
await fs.writeFile(outputPath, JSON.stringify({ createdAt: new Date().toISOString(), count: prompts.length, policy: 'fresh AI image generation from supplier references only; no old AI images', prompts }, null, 2), 'utf8');
console.log(JSON.stringify({ count: prompts.length, outputPath }));
