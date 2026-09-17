import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.argv[2] ?? './outputs/hair-styling-all-2026-09-05/hair-styling-source-data-enriched.json';
const outputPath = process.argv[3] ?? './outputs/hair-styling-all-2026-09-05/hair-photo-prompts.json';
const root = path.dirname(outputPath);
const data = JSON.parse((await fs.readFile(inputPath, 'utf8')).replace(/^\uFEFF/u, ''));
const products = Array.isArray(data) ? data : data.products;
if (!Array.isArray(products) || !products.length) throw new Error('No products in enriched source data');

const clean = (v) => String(v ?? '').replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim();
const text = (p) => [p.title, p.description, ...(p.attributes ?? []).flatMap((a) => [a.name, a.value])].map(clean).join(' ');
const kind = (p) => {
  const t = text(p).toLocaleLowerCase('uk-UA');
  if (/бигуд|бігуд|термобігуд|термобигуд|curl/iu.test(t)) return 'bigudi';
  if (/гребін|гребен|расчес|розчіс|масажн|массажн/iu.test(t)) return 'comb';
  if (/гофре|гофр/iu.test(t)) return 'gofre';
  if (/випрям|выпрям|утюж|праск|straight/iu.test(t)) return 'gofre';
  if (/плой|щипц|завив|локон|curl/iu.test(t)) return 'ployki';
  return 'feny';
};
const names = {
  feny: { ru: 'фен для волос', ua: 'фен для волосся' },
  ployki: { ru: 'плойка для волос', ua: 'плойка для волосся' },
  gofre: { ru: 'выпрямитель для волос', ua: 'випрямляч для волосся' },
  bigudi: { ru: 'бигуди для волос', ua: 'бігуді для волосся' },
  comb: { ru: 'расческа для волос', ua: 'гребінець для волосся' },
};
const attrs = (p) => (p.attributes ?? []).filter((a) => {
  const n = clean(a.name).toLocaleLowerCase('uk-UA');
  return n && !/модель|артикул|код|sku|виробник|бренд|торгова марка|країна|страна/iu.test(n);
});
const facts = (p, lang) => attrs(p).slice(0, 5).map((a) => `${clean(a.name)}: ${clean(a.value)}`).join('; ');
const roleText = (k, role, lang, p) => {
  const ua = lang === 'ua';
  const n = names[k][lang];
  const f = facts(p, lang);
  const common = 'Точний реальний товар із наданих фото постачальника; збережи його форму, колір, пропорції, корпус, кнопки, насадки, шнур і всі конструктивні деталі без змін. Не вигадуй нових елементів і не замінюй товар іншим.';
  const no = 'Без людей, рук, тварин, сторонніх товарів, логотипів, водяних знаків, цін, SKU, моделей та тексту постачальника.';
  if (role === '01_main') return `${common} ${no} Квадратне комерційне фото 1280×1280 у сучасному стилі Prom.ua, фронтальний ракурс 3/4, товар крупно займає більшу частину кадру, чистий світлий преміальний фон, м'яке студійне світло, акуратна тінь. Зліва залиш місце для короткого українського заголовка: «${ua ? 'ЗРУЧНЕ УКЛАДАННЯ ВДОМА' : 'ЗРУЧНЕ УКЛАДАННЯ ВДОМА'}». Додай лише короткий підзаголовок українською: «${n}». ${f ? `Показуй лише підтверджені параметри, без додаткових написів: ${f}.` : ''}`;
  if (role === '02_benefits') return `${common} ${no} Квадратне фото 1280×1280, протилежний 3/4 ракурс, інша композиція та положення товару, світлий нейтральний e-commerce фон. Товар головний і чіткий. Додай зліва компактний блок українською з заголовком «КЛЮЧОВІ ПЕРЕВАГИ» і 3 короткими фразами лише про підтверджені можливості: «Зручний формат», «Для домашнього укладання», «Легко зберігати». Не використовуй медичних або непідтверджених обіцянок.`;
  if (role === '03_features') return `${common} ${no} Квадратне фото 1280×1280, новий ракурс трохи зверху, чиста предметна композиція, товар на світлому фоні. Додай мінімалістичну українську інфографіку: заголовок «ОСОБЛИВОСТІ» та 3–5 коротких підписів тільки за цими підтвердженими даними: «${f || 'Конструкція та призначення за фото товару'}». Не додавай розміри, потужність, режими чи матеріали, якщо їх немає серед підтверджених даних.`;
  if (role === '04_use') return `${common} ${no} Квадратне lifestyle-фото 1280×1280 у реальній красивій обстановці біля дзеркала або на охайному туалетному столику, без людей у кадрі. Постав товар у природний контекст використання, але не змінюй його вигляд і не додавай інші товари крупним планом. Інший ракурс, ніж на попередніх фото. Додай лише короткий український заголовок «ЗРУЧНО ЩОДНЯ» і фразу «Для домашнього укладання волосся».`;
  return `${common} ${no} Квадратне чисте studio close-up 1280×1280 з іншої точки, крупний план корпусу, робочої частини, покриття, кнопок або насадки, різка деталізація, мінімальний нейтральний фон, без довгого тексту. Можна залишити фото без написів; якщо додаєш текст, тільки український заголовок «ДЕТАЛІ» і 2 короткі підписи до реально видимих деталей. ${f ? `Не змінюй підтверджені параметри: ${f}.` : ''}`;
};

const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
const result = [];
for (const p of products) {
  const sku = String(p.sku);
  const sourceDir = path.join(root, 'sources', sku);
  let files = [];
  try { files = (await fs.readdir(sourceDir)).filter((f) => /^source.*\.(?:jpg|jpeg|png|webp)$/iu.test(f)).sort().slice(0, 5).map((f) => path.resolve(sourceDir, f)); } catch {}
  if (!files.length) throw new Error(`No local supplier references for ${sku}`);
  result.push({ sku, page_id: String(p.page_id), kind: kind(p), source_url: p.source_url, sourceImages: files, roles: Object.fromEntries(roles.map((role) => [role, { prompt: roleText(kind(p), role, 'ua', p), references: files }])) });
}
await fs.writeFile(outputPath, JSON.stringify({ createdAt: new Date().toISOString(), policy: 'new AI photos only; local supplier images are references only', count: result.length, products: result }, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, products: result.length, assets: result.length * roles.length, missingReferences: result.filter((x) => !x.sourceImages.length).length }, null, 2));
