import assert from 'node:assert/strict';
import test from 'node:test';

import { collectUgoptProductDetail } from '../../../src/suppliers/ugopt/product-detail-adapter.mjs';
import { parseUgoptProductDetailHtml } from '../../../src/suppliers/ugopt/product-detail-parser.mjs';

function page({ description = 'Потужність: 100 Вт. Місткість: 600 мл.', capacity = '0.6 л', title = 'Сауна для обличчя' } = {}) {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'Product', name: title, description, image: ['https://images.prom.ua/one.jpg', 'https://images.prom.ua/two.jpg'],
  })}</script></head><body><table>
    <tr><td>Потужність</td><td>100 Вт</td></tr>
    <tr><td>Об'єм резервуара для води</td><td>${capacity}</td></tr>
  </table></body></html>`;
}

test('parses official product facts, characteristics, and ordered images into READY evidence', () => {
  const result = parseUgoptProductDetailHtml(page(), { productKey: 'ugopt:1', sourceUrl: 'https://ug-opt.in.ua/ua/p1' });
  assert.equal(result.status, 'READY');
  assert.equal(result.sourceFacts.type.ua, 'Сауна для обличчя');
  assert.equal(result.sourceText.characteristics.length, 2);
  assert.equal(result.sourceImages.length, 2);
  assert.equal(result.provenance.authority, 'official-product-page');
});

test('blocks conflicting measurements and ambiguous assortment instead of guessing', () => {
  const result = parseUgoptProductDetailHtml(page({
    description: 'Місткість: 60 мл. Товар постачається у різних кольорах в асортименті.',
  }), { productKey: 'ugopt:2', sourceUrl: 'https://ug-opt.in.ua/ua/p2' });
  assert.equal(result.status, 'REVIEW');
  assert.deepEqual(result.diagnostics.map((item) => item.code).sort(), ['SOURCE_FACT_CONFLICT', 'SOURCE_VARIANT_AMBIGUOUS']);
});

test('detail adapter accepts only official HTTPS pages and maps fetch failures explicitly', async () => {
  const candidate = { selectionKey: 'ugopt:3', product: { sourceUrl: 'https://ug-opt.in.ua/ua/p3' } };
  const result = await collectUgoptProductDetail(candidate, { fetchImpl: async () => new Response(page()) });
  assert.equal(result.productKey, candidate.selectionKey);
  await assert.rejects(() => collectUgoptProductDetail({ ...candidate, product: { sourceUrl: 'https://example.com/p3' } }, { fetchImpl: async () => new Response(page()) }), /official HTTPS host/u);
  await assert.rejects(() => collectUgoptProductDetail(candidate, { fetchImpl: async () => new Response('', { status: 500 }) }), (error) => error.code === 'UGOPT_PRODUCT_HTTP_ERROR');
});
