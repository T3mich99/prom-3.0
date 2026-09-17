import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContentGenerationRequest,
  buildContentReworkRequest,
  CONTENT_GENERATION_RESPONSE_FORMAT,
} from '../../src/content/content-generation-prompt.mjs';

const input = {
  productKey: 'ugopt:F-001',
  sourceFacts: { color: 'чорний', power: '2200 Вт' },
  sourceText: { title: 'Фен для волосся', supplierDescription: 'Перевірений опис постачальника' },
  categoryContext: { source: 'ug-opt', name: 'Фени' },
};

test('generation request is deterministic and provider-neutral', () => {
  const first = buildContentGenerationRequest(structuredClone(input));
  const second = buildContentGenerationRequest(structuredClone(input));
  assert.deepEqual(first, second);
  assert.deepEqual(first.responseFormat, { type: 'json_object' });
  assert.equal(first.metadata.productKey, input.productKey);
  assert.match(first.prompt, /sourceFacts as the sole authority/iu);
  assert.match(first.prompt, /numeric or specification claim from sourceText.*supported by sourceFacts/iu);
  assert.match(first.prompt, /never reproduce prices.*sourceText/iu);
  assert.match(first.prompt, /Russian and Ukrainian/iu);
  assert.match(first.prompt, /Do not add price/iu);
  assert.equal(first.prompt.includes('C:\\'), false);
  assert.equal(first.prompt.includes('timestamp'), false);
});

test('sourceText remains contextual input rather than factual authority', () => {
  const request = buildContentGenerationRequest(input);
  assert.match(request.prompt, /SOURCE TEXT \(contextual wording only; not authoritative for factual values\)/u);
  assert.match(request.prompt, /supplierDescription/u);
});

test('generation request has an independent response-format object', () => {
  const request = buildContentGenerationRequest(input);
  request.responseFormat.type = 'changed';
  assert.deepEqual(CONTENT_GENERATION_RESPONSE_FORMAT, { type: 'json_object' });
});

test('rework request contains only target fields, reason codes and previous target values', () => {
  const request = buildContentReworkRequest({
    productKey: input.productKey,
    sourceFacts: input.sourceFacts,
    fields: [{ field: 'description', reasonCodes: ['DESCRIPTION_TOO_SHORT'] }],
    previousValues: { description: { ru: 'old ru', ua: 'old ua' } },
  });
  assert.deepEqual(request.metadata.fields, ['description']);
  assert.deepEqual(request.metadata.reasonCodes, [{ field: 'description', reasonCodes: ['DESCRIPTION_TOO_SHORT'] }]);
  assert.match(request.prompt, /DESCRIPTION_TOO_SHORT/u);
  assert.match(request.prompt, /old ru/u);
  assert.equal(request.prompt.includes('old title'), false);
  assert.equal(request.prompt.includes('old keywords'), false);
  assert.deepEqual(request.responseFormat, { type: 'json_object' });
});

test('generation input rejects unsupported or non-verified shapes', () => {
  assert.throws(() => buildContentGenerationRequest({ ...input, selectedProduct: {} }), /Unsupported generation input field/u);
  assert.throws(() => buildContentGenerationRequest({ ...input, sourceFacts: { power: undefined } }), /JSON-compatible/u);
  assert.throws(() => buildContentGenerationRequest({ ...input, sourceText: { title: 123 } }), /sourceText.title/u);
});

test('generation input rejects price-like and economic source fact keys', () => {
  for (const key of [
    'price',
    'purchasePrice',
    'purchase_price',
    'purchase-price',
    'sellingPrice',
    'salePrice',
    'rrp',
    'cost',
    'commission',
    'margin',
    'currency',
  ]) {
    assert.throws(
      () => buildContentGenerationRequest({ ...input, sourceFacts: { ...input.sourceFacts, [key]: 230 } }),
      /forbidden business metadata/u,
      key,
    );
  }
});
