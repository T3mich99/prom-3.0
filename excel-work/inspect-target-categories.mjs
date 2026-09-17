import fs from 'node:fs/promises';

const cats = JSON.parse(await fs.readFile('C:/Users/Dell/Documents/kasta/outputs/prom-commission-categories.json', 'utf8'));
const terms = [
  'унітаз','аерофрит','органайзер','швабр','килим','дозатор','відкривач','пральн','мочал','підставк','судоч','тримач','смітт','щіт','термометр','фільтр','плівк','дзеркал','помп','стрічк','сушар','душ','контейнер','кошик','масаж','парасол','таблетниц','штор','світловідбив','мегафон','сигналізац','пульс','тонометр','зубн','гачок','вакуум','вешал','вивіш','лямп','сік','горіх','клей','стопер','мило','бритв','білизн','взутт','іграшк','рушник','холодильн','чохл','ванн','продукт','ящик','набір'
];
const rx = new RegExp(terms.join('|'), 'iu');
const out = cats
  .filter((c) => Array.isArray(c.path) && c.path.includes('товари для дому'))
  .filter((c) => Number(c.level) >= 3)
  .filter((c) => rx.test(String(c.name) + ' ' + c.path.join(' ')))
  .sort((a,b) => String(a.name).localeCompare(String(b.name), 'uk'))
  .map((c) => ({ id: c.id, name: c.name, path: c.path, commission: c.order_commission }));
console.log(JSON.stringify(out, null, 2));
