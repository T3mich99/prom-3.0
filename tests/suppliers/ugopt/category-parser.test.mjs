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
