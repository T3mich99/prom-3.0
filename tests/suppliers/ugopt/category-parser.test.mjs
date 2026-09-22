import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUgoptCategoryHtml } from '../../../src/suppliers/ugopt/category-parser.mjs';

const page = ({ cards = '', pageCount = 1 } = {}) => `
<html><body>
  <div data-pagination-pages-count="${pageCount}"></div>
  <ul>${cards}</ul>
</body></html>`;

const card = ({ id, sku, url, title, price = '230 грн', image = '/images/product.jpg' }) => `
<li data-product-id="${id}">
  <a data-product-url="${url}" data-product-name="${title}">
    <span class="cs-product-list__sku"><span title="${sku}">${sku}</span></span>
    <span data-product-price="${price}"></span>
    <img data-product-big-picture="${image}">
  </a>
</li>`;

const currentCard = ({ id, sku, url, title, price = '230 ₴', image = '/images/product.jpg' }) => `
<li class="cs-product-list__item js-productad" data-product-id="${id}">
  <div class="cs-product-list__image-wrap"><a class="cs-goods-title" href="${url}"><img class="cs-product-list__image" src="${image}" /></a></div>
  <div class="cs-product-list__info-panel">
    <div class="cs-product-list__title"><a class="cs-goods-title" href="${url}">${title}</a></div>
    <div class="cs-goods-price"><span class="cs-goods-price__value cs-goods-price__value_type_product-list">${price}</span></div>
    <div class="cs-product-list__order-panel"><div class="cs-product-list__sku cs-goods-sku" title="Код:"><span title="Код:"><span title="${sku}">${sku}</span></span></div></div>
  </div>
</li>`;

test('parses UG-OPT cards in source order with traceable identity and URL', () => {
  const result = parseUgoptCategoryHtml(page({
    cards: [
      card({ id: 101, sku: '00123', url: '/ua/p101-item.html', title: 'Перший товар' }),
      card({ id: 102, sku: 'U456U', url: '/ua/p102-item.html', title: 'Другий товар', price: '1 234 грн' }),
      card({ id: 103, sku: 'Ab-001', url: '/ua/p103-item.html', title: 'Третій товар' }),
    ].join(''),
  }));

  assert.deepEqual(result.candidates.map((item) => item.selectionKey), ['ugopt:00123', 'ugopt:U456U', 'ugopt:Ab-001']);
  assert.equal(result.candidates[0].product.sourceUrl, 'https://ug-opt.in.ua/ua/p101-item.html');
  assert.equal(result.candidates[0].product.supplierSku, '00123');
  assert.equal(result.candidates[0].product.price, 230);
  assert.equal(result.candidates[1].product.price, 1234);
  assert.equal(result.candidates[2].product.supplierSku, 'Ab-001');
  assert.equal(result.pageCount, 1);
});

test('parses the current UG-OPT card markup after data-product attributes were removed', () => {
  const result = parseUgoptCategoryHtml(page({
    cards: currentCard({ id: 201, sku: '34162', url: '/ua/p201-item.html', title: 'Поясний ремінь', price: '1 010 ₴', image: '/images/current.jpg' }),
  }));

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].selectionKey, 'ugopt:34162');
  assert.equal(result.candidates[0].product.sourceUrl, 'https://ug-opt.in.ua/ua/p201-item.html');
  assert.equal(result.candidates[0].product.title, 'Поясний ремінь');
  assert.equal(result.candidates[0].product.price, 1010);
  assert.equal(result.candidates[0].product.sourceImageUrl, 'https://ug-opt.in.ua/images/current.jpg');
});

test('keeps an empty valid category distinct from parser input failure', () => {
  assert.deepEqual(parseUgoptCategoryHtml(page()), { pageCount: 1, candidates: [] });
  assert.throws(() => parseUgoptCategoryHtml(null), /html must be a string/u);
});

test('ignores malformed cards without discarding valid cards or throwing', () => {
  const result = parseUgoptCategoryHtml(page({
    cards: `${card({ id: 103, sku: '', url: '/ua/p103-item.html', title: 'Без SKU' })}${card({ id: 104, sku: '789', url: '/ua/p104-item.html', title: 'Валідний товар' })}`,
  }));
  assert.deepEqual(result.candidates.map((item) => item.product.supplierSku), ['789']);
});

test('rejects unrelated HTML without the proven category-page marker', () => {
  assert.throws(
    () => parseUgoptCategoryHtml('<html><body>unexpected page</body></html>'),
    /missing pagination marker/u,
  );
});
