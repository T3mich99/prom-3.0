import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('outputs/ugopt-hair-100-premium-v1');
const products = JSON.parse(await fs.readFile(path.join(ROOT, 'source/selection-with-refs.json'), 'utf8'));

function attribute(product, ...names) {
  const record = product.attributes?.find(item => names.some(name => item.name.toLowerCase() === name.toLowerCase()));
  return record?.value || '';
}

function typeOf(product) {
  const source = `${product.title} ${attribute(product, 'Тип')}`.toLowerCase();
  if (/фен/.test(source)) return 'dryer';
  if (/плойк|щипц.*завив/.test(source)) return 'curler';
  if (/гофре/.test(source)) return 'crimper';
  if (/випрям|праск|утюж/.test(source)) return 'straightener';
  if (/бігуд/.test(source)) return 'curlers';
  if (/гребінець|расческ|щітк/.test(source)) return 'brush';
  return 'styler';
}

function label(type) {
  return {
    dryer: ['ФЕН ДЛЯ ВОЛОССЯ', 'Сушіння та укладання'],
    curler: ['ПЛОЙКА ДЛЯ ЛОКОНІВ', 'Створюйте виразну укладку'],
    crimper: ['ГОФРЕ ДЛЯ ВОЛОССЯ', 'Текстура та об’єм у зачісці'],
    straightener: ['ВИПРЯМЛЯЧ ДЛЯ ВОЛОССЯ', 'Гладкість та охайна укладка'],
    curlers: ['БІГУДІ ДЛЯ ВОЛОССЯ', 'Локони без зайвих зусиль'],
    brush: ['ЩІТКА ДЛЯ ВОЛОССЯ', 'Догляд та зручне укладання'],
    styler: ['СТАЙЛЕР ДЛЯ ВОЛОССЯ', 'Більше можливостей для образу'],
  }[type];
}

function sceneLanguage(type, product) {
  const power = attribute(product, 'Потужність фена', 'Потужність');
  const temperatures = attribute(product, 'Кількість температурних режимів');
  const speeds = attribute(product, 'Кількість швидкостей');
  const coating = attribute(product, 'Тип покриття', 'Покриття');
  const attachments = attribute(product, 'Кількість насадок');
  const ion = attribute(product, 'Функція іонізації');
  const controls = attribute(product, 'Регулювання температури', 'Регулювання швидкості');
  const intro = label(type);
  let resultTitle = 'ВИРАЗНИЙ РЕЗУЛЬТАТ';
  let resultSub = 'Для вашого щоденного образу';
  if (type === 'dryer') { resultTitle = 'ШВИДКЕ СУШІННЯ'; resultSub = power ? `${power} для догляду` : 'Для сушіння та укладання'; }
  if (type === 'curler') { resultTitle = 'ГАРНІ ЛОКОНИ'; resultSub = 'Легко створити вдома'; }
  if (type === 'crimper') { resultTitle = 'ОБ’ЄМ ВІД КОРЕНІВ'; resultSub = 'Акцент для вашої зачіски'; }
  if (type === 'straightener') { resultTitle = 'ГЛАДКІ ПАСМА'; resultSub = 'Охайне укладання вдома'; }
  if (type === 'brush') { resultTitle = 'ДОГЛЯНУТЕ ВОЛОССЯ'; resultSub = 'Зручний крок у догляді'; }
  if (type === 'styler') { resultTitle = 'НОВИЙ ОБРАЗ'; resultSub = attachments ? `${attachments} насадки для ідей` : 'Створюйте укладку вдома'; }
  let featureTitle = 'ПРОДУМАНА КОНСТРУКЦІЯ';
  let featureSub = 'Зручність у кожному русі';
  if (temperatures && /^\d+$/.test(temperatures)) { featureTitle = `${temperatures} РЕЖИМИ ТЕМПЕРАТУРИ`; featureSub = 'Догляд під ваш тип волосся'; }
  else if (speeds && /^\d+$/.test(speeds)) { featureTitle = `${speeds} ШВИДКОСТІ`; featureSub = 'Оберіть свій темп укладання'; }
  else if (coating) { featureTitle = coating.toLocaleUpperCase('uk-UA'); featureSub = 'Для делікатного укладання'; }
  else if (attachments && /^\d+$/.test(attachments)) { featureTitle = `${attachments} НАСАДКИ`; featureSub = 'Більше варіантів для укладки'; }
  else if (controls === 'Так') { featureTitle = 'ЗРУЧНЕ НАЛАШТУВАННЯ'; featureSub = 'Керуйте укладанням легко'; }
  const detailTitle = ion === 'Так' ? 'ІОНІЗАЦІЯ' : 'ДЕТАЛІ, ЩО ВРАЖАЮТЬ';
  const detailSub = ion === 'Так' ? 'Для охайного вигляду волосся' : 'Акцент на реальній конструкції';
  return {
    1: { title: intro[0], subtitle: intro[1], kind: 'hero product photograph' },
    2: { title: resultTitle, subtitle: resultSub, kind: 'result scene with a believable beauty outcome' },
    3: { title: featureTitle, subtitle: featureSub, kind: 'feature close-up showing only a confirmed real detail' },
    4: { title: 'УКЛАДАННЯ ВДОМА', subtitle: 'Комфортно у вашому ритмі', kind: 'realistic lifestyle use scene with an adult woman correctly using the product' },
    5: { title: detailTitle, subtitle: detailSub, kind: 'authentic macro product detail' },
  };
}

function physicalRules(type) {
  const typeRule = {
    dryer: 'For any use scene, show the dryer aimed plausibly at hair; do not add a concentrator or diffuser unless it is clearly present in the supplied reference.',
    curler: 'For any use scene, show a credible curling action with the exact barrel/clamp arrangement from the reference; never add an extra barrel or attachment.',
    crimper: 'For any use scene, show the exact crimping plates from the reference used safely on a hair section; never turn it into a straightener.',
    straightener: 'For any use scene, show the exact plates from the reference used naturally on a hair section; never turn it into a curler.',
    curlers: 'For any use scene, show the exact confirmed curler form and quantity only; do not add electrical parts.',
    brush: 'For any use scene, show the exact bristle/comb construction from the reference; do not make it an electrical appliance unless shown in the reference.',
    styler: 'For any use scene, preserve exactly the confirmed main device and included attachments from the reference, with no additional tools.',
  }[type];
  return `Preserve exact silhouette, dimensions, body color, surface finish, genuine brand mark, number and positions of every button, display, nozzle, barrel, plate, bristle, cable and all included accessories exactly as on the supplied product-reference images. ${typeRule} Do not show the box or any printed model/SKU/article from packaging. Never add a logo or alter a real visible brand. Never show a model number, SKU, article, price, discount, promotion, watermark, collage, icon labels, or pre-rendered text.`;
}

const manifest = products.flatMap(product => {
  const type = typeOf(product);
  const texts = sceneLanguage(type, product);
  const references = product.referenceFiles.slice(0, 2);
  return [1, 2, 3, 4, 5].map(position => ({
    productIndex: product.index,
    sku: product.sku,
    outputName: `${String(position).padStart(2, '0')}_${['main', 'result', 'feature', 'use', 'detail'][position - 1]}.png`,
    sceneName: ['MAIN', 'RESULT', 'FEATURE', 'USE', 'DETAIL'][position - 1],
    references,
    title: texts[position].title,
    subtitle: texts[position].subtitle,
    prompt: `Create one standalone 1280x1280 premium beauty e-commerce image for Prom.ua. Use the supplied product-reference images as the sole physical source of truth. ${physicalRules(type)} This is the ${texts[position].kind}. Premium Ukrainian beauty campaign visual language: warm cream, beige, nude and ivory palette, soft daylight, subtle realistic shadows, polished editorial composition, photorealistic product rendering. No text whatsoever inside the generated image—the exact Ukrainian typography is added later. Make this scene commercially and compositionally distinct from the other four images for this SKU. Leave a clean upper-left negative area for later typography.`,
  }));
});

await fs.writeFile(path.join(ROOT, 'source/photo-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), products: products.length, tasks: manifest.length, firstTasks: manifest.slice(0, 5) }, null, 2));
