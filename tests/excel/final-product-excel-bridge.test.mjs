import { exportPromDeltaWorkbook } from '../../src/excel/prom-delta-export.mjs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildFinalProductExcelRecord,
  exportFinalProductsToWorkbook,
  FINAL_EXCEL_STATUSES,
  validatePublishableMedia,
} from '../../src/excel/final-product-excel-bridge.mjs';
import { CANONICAL_FIELDS } from '../../src/excel/schema-mapper.mjs';
import { inspectWorkbook } from '../../src/excel/template-inspector.mjs';
import { mapTemplateSchema } from '../../src/excel/schema-mapper.mjs';
import { createWorkbook, cleanupTempDir, fileHash, loadWorkbook, makeTempDir } from './support.mjs';

function description(length = 1400, prefix = 'Фен допомагає швидко висушити волосся та зручно підготувати його до щоденного укладання') {
  return Array.from({ length }, (_, index) => `${prefix}, абзац ${index + 1}.`).join(' ').slice(0, length);
}

function keywords(language) {
  const phrase = language === 'ua' ? 'фен для волосся пошук' : 'фен для волос поиск';
  const value = Array.from({ length: 25 }, (_, index) => `${phrase} ${index + 1}`).join(', ');
  return `${value}${'x'.repeat(850 - value.length)}`;
}

function contentArtifact(productKey = 'ugopt:bridge-1') {
  return {
    productKey,
    version: 1,
    sourceFacts: { type: 'фен', brand: 'VGR', model: 'V-451', power: '2200 Вт', color: 'чорний' },
    content: {
      title: { ru: 'Фен VGR 2200 Вт черный', ua: 'Фен VGR 2200 Вт чорний' },
      description: {
        ru: description(1400, 'Фен помогает быстро высушить волосы и удобно подготовить их к ежедневной укладке'),
        ua: description(),
      },
      keywords: { ru: keywords('ru'), ua: keywords('ua') },
      characteristics: [{ name: 'Потужність', value: '2200 Вт' }, { name: 'Колір', value: 'чорний' }],
    },
  };
}

function pricingDecision(productKey, amountMinor = 44900, status = 'READY') {
  const whole = Math.floor(amountMinor / 100);
  const fraction = String(amountMinor % 100).padStart(2, '0');
  return {
    productKey,
    status,
    supplier: { name: 'ug-opt', purchasePrice: { amount: '230.00', amountMinor: 23000, currency: 'UAH' }, provenance: { source: 'selected-product', productKey } },
    market: { acceptedComparableCount: 5, exactComparableCount: 5 },
    commission: { rateBps: 2000, source: 'fixture', provenance: { source: 'fixture' } },
    pricing: { recommendedPrice: { amount: `${whole}.${fraction}`, amountMinor, currency: 'UAH' } },
    profitability: { sellingPrice: { amount: `${whole}.${fraction}`, amountMinor, currency: 'UAH' } },
    reasonCodes: [],
    diagnostics: { marketSampleOnly: true },
  };
}

function approvedMedia(productKey) {
  return {
    productKey,
    version: 1,
    publication: { status: 'LOCAL_ONLY', publicUrlsAvailable: false },
    photos: Array.from({ length: 5 }, (_, index) => ({
      index: index + 1,
      assetRef: `C:\\photos\\${productKey}\\0${index + 1}-${['hero', 'usage', 'benefits', 'feature', 'final'][index]}.png`,
      width: 1280,
      height: 1280,
      format: 'png',
    })),
  };
}

function publishableMedia(productKey, media = approvedMedia(productKey)) {
  return {
    productKey,
    version: 1,
    items: media.photos.map((photo, index) => ({
      index: index + 1,
      role: ['hero', 'usage', 'benefits', 'feature', 'final'][index],
      approvedAssetRef: photo.assetRef,
      publicUrl: `https://cdn.example.test/${encodeURIComponent(productKey)}/${index + 1}.png`,
    })),
  };
}

function productionArtifact(productKey = 'ugopt:bridge-1', overrides = {}) {
  const base = {
    productKey,
    workflowStatus: 'READY_FOR_EXPORT',
    selectedProduct: { selectionKey: productKey, product: { supplierSku: '0007' } },
    pricingDecision: pricingDecision(productKey),
    contentArtifact: contentArtifact(productKey),
    approvedMedia: approvedMedia(productKey),
    resolvedMetadata: {
      productCode: 'U0007U',
      uniqueId: '0007',
      productId: 'U0007U',
      manufacturer: 'VGR',
      unit: 'шт.',
      currency: 'UAH',
      availability: '+',
      categoryId: '611',
      categoryName: 'Фени',
    },
    provenance: {
      supplier: 'ug-opt',
      pricing: 'PR22 market-pricing.mjs',
      content: 'commercial-prom-v2',
      photos: 'PR24 real-photo-production.mjs',
      publication: 'local-media-only; Prom/Excel bridge deferred',
    },
    diagnostics: [],
  };
  return {
    ...base,
    ...overrides,
    selectedProduct: overrides.selectedProduct ?? base.selectedProduct,
    pricingDecision: overrides.pricingDecision ?? base.pricingDecision,
    contentArtifact: overrides.contentArtifact ?? base.contentArtifact,
    approvedMedia: overrides.approvedMedia ?? base.approvedMedia,
    resolvedMetadata: overrides.resolvedMetadata ?? base.resolvedMetadata,
    provenance: overrides.provenance ?? base.provenance,
  };
}

function headers() {
  return [
    'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Опис', 'Опис_укр',
    'Пошукові_запити', 'Пошукові_запити_укр', 'Ціна', 'Виробник', 'Одиниця_виміру',
    'Посилання_зображення', 'Ідентифікатор_групи', 'Назва_групи', 'Унікальний_ідентифікатор',
    'Ідентифікатор_товару', 'Валюта', 'Наявність',
    'Назва_Характеристики', 'Одиниця_виміру_Характеристики', 'Значення_Характеристики',
    'Назва_Характеристики_2', 'Одиниця_виміру_Характеристики_2', 'Значення_Характеристики_2',
  ];
}

async function mappedTemplate(t, templateHeaders = headers()) {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const inputPath = path.join(dir, 'template.xlsx');
  await createWorkbook(inputPath, [
    { name: 'Reference', values: [['Key', 'Value'], ['keep', 'yes']] },
    { name: 'Products', values: [templateHeaders, Array(templateHeaders.length).fill(null)] },
  ]);
  const mapping = mapTemplateSchema(await inspectWorkbook(inputPath));
  return { dir, inputPath, mapping };
}

test('builds a canonical final row from PR22 selling price and publishable media only', () => {
  const artifact = productionArtifact();
  const result = buildFinalProductExcelRecord({ productionArtifact: artifact, publishableMedia: publishableMedia(artifact.productKey, artifact.approvedMedia) });
  assert.equal(result.status, FINAL_EXCEL_STATUSES.READY_FOR_EXCEL);
  assert.equal(result.row.price, 449);
  assert.notEqual(result.row.price, 230);
  assert.equal(result.row.photoUrls, 'https://cdn.example.test/ugopt%3Abridge-1/1.png, https://cdn.example.test/ugopt%3Abridge-1/2.png, https://cdn.example.test/ugopt%3Abridge-1/3.png, https://cdn.example.test/ugopt%3Abridge-1/4.png, https://cdn.example.test/ugopt%3Abridge-1/5.png');
  assert.equal(result.row.photoUrls.includes('C:\\photos'), false);
  assert.deepEqual(Object.keys(result.row), CANONICAL_FIELDS.filter((field) => Object.hasOwn(result.row, field)));
  assert.equal(result.row.uniqueId, '0007');
});

test('uses exact PR22 minor-to-major conversion without repricing', () => {
  const artifact = productionArtifact('ugopt:kopeck', { pricingDecision: pricingDecision('ugopt:kopeck', 44901) });
  const result = buildFinalProductExcelRecord({ productionArtifact: artifact, publishableMedia: publishableMedia(artifact.productKey, artifact.approvedMedia) });
  assert.equal(result.row.price, 449.01);
  artifact.pricingDecision.pricing.recommendedPrice.amountMinor = 23000;
  assert.equal(buildFinalProductExcelRecord({ productionArtifact: artifact, publishableMedia: publishableMedia(artifact.productKey, artifact.approvedMedia) }).status, FINAL_EXCEL_STATUSES.EXPORT_REVIEW);
});

test('waits explicitly for public media and never turns local approved paths into URLs', () => {
  const artifact = productionArtifact();
  const result = buildFinalProductExcelRecord({ productionArtifact: artifact });
  assert.equal(result.status, FINAL_EXCEL_STATUSES.WAITING_FOR_MEDIA_PUBLICATION);
  assert.equal(result.row, null);
  assert.equal(result.diagnostics[0].code, 'PUBLISHABLE_MEDIA_REQUIRED');
});

test('publishable media contract rejects local, duplicate, malformed, and mismatched public media', () => {
  const artifact = productionArtifact();
  const valid = publishableMedia(artifact.productKey, artifact.approvedMedia);
  const invalidCases = [
    (value) => { value.items.pop(); },
    (value) => { value.items[1].publicUrl = value.items[0].publicUrl; },
    (value) => { value.items[0].publicUrl = 'file:///C:/photos/1.png'; },
    (value) => { value.items[0].publicUrl = 'C:\\photos\\1.png'; },
    (value) => { value.items[0].publicUrl = 'https://localhost/photos/1.png'; },
    (value) => { value.items[0].role = 'usage'; },
    (value) => { value.items[0].approvedAssetRef = 'other-local-file.png'; },
    (value) => { value.productKey = 'other'; },
    (value) => { [value.items[0], value.items[1]] = [value.items[1], value.items[0]]; },
  ];
  for (const mutate of invalidCases) {
    const value = structuredClone(valid);
    mutate(value);
    assert.throws(() => validatePublishableMedia({ productKey: artifact.productKey, approvedMedia: artifact.approvedMedia, publishableMedia: value }));
  }
});

test('blocks non-READY production, pricing, commercial content, and identity mismatch', () => {
  const artifact = productionArtifact();
  const media = publishableMedia(artifact.productKey, artifact.approvedMedia);
  assert.equal(buildFinalProductExcelRecord({ productionArtifact: productionArtifact('bad-state', { workflowStatus: 'PHOTO_READY' }), publishableMedia: publishableMedia('bad-state') }).status, FINAL_EXCEL_STATUSES.EXPORT_REVIEW);
  assert.equal(buildFinalProductExcelRecord({ productionArtifact: productionArtifact('price-review', { pricingDecision: pricingDecision('price-review', 44900, 'PRICE_REVIEW') }), publishableMedia: publishableMedia('price-review') }).status, FINAL_EXCEL_STATUSES.EXPORT_REVIEW);
  const invalidContent = structuredClone(artifact.contentArtifact);
  invalidContent.content.title.ua = '';
  assert.equal(buildFinalProductExcelRecord({ productionArtifact: productionArtifact(artifact.productKey, { contentArtifact: invalidContent }), publishableMedia: media }).status, FINAL_EXCEL_STATUSES.EXPORT_REVIEW);
  assert.equal(buildFinalProductExcelRecord({ productionArtifact: productionArtifact(artifact.productKey, { approvedMedia: approvedMedia('other') }), publishableMedia: media }).status, FINAL_EXCEL_STATUSES.EXPORT_REVIEW);
});

test('does not allow resolved metadata to override price or media authorities', () => {
  const artifact = productionArtifact();
  artifact.resolvedMetadata.price = 1;
  const result = buildFinalProductExcelRecord({ productionArtifact: artifact, publishableMedia: publishableMedia(artifact.productKey, artifact.approvedMedia) });
  assert.equal(result.status, FINAL_EXCEL_STATUSES.EXPORT_REVIEW);
  assert.equal(result.diagnostics[0].code, 'AUTHORITATIVE_FIELD_OVERRIDE');
});

test('template mapping builds the existing characteristic sidecar and requires explicit mapped category', async (t) => {
  const fixture = await mappedTemplate(t);
  assert.equal(fixture.mapping.status, 'SAFE');
  const artifact = productionArtifact();
  const ready = buildFinalProductExcelRecord({ productionArtifact: artifact, publishableMedia: publishableMedia(artifact.productKey, artifact.approvedMedia), mapping: fixture.mapping });
  assert.equal(ready.status, FINAL_EXCEL_STATUSES.READY_FOR_EXCEL);
  assert.equal(ready.characteristicPlan.status, 'SAFE');
  assert.deepEqual(ready.characteristicPlan.writes.map((entry) => entry.value), ['Потужність', '2200 Вт', 'Колір', 'чорний']);
  const missingCategory = productionArtifact(artifact.productKey, { resolvedMetadata: { ...artifact.resolvedMetadata, categoryId: undefined } });
  assert.equal(buildFinalProductExcelRecord({ productionArtifact: missingCategory, publishableMedia: publishableMedia(artifact.productKey, missingCategory.approvedMedia), mapping: fixture.mapping }).status, FINAL_EXCEL_STATUSES.EXPORT_REVIEW);
});

test('unsafe or incomplete template mapping produces NEEDS_TEMPLATE_MAPPING without a row', async (t) => {
  const fixture = await mappedTemplate(t, ['Назва_позиції', 'Ціна']);
  const artifact = productionArtifact();
  const result = buildFinalProductExcelRecord({ productionArtifact: artifact, publishableMedia: publishableMedia(artifact.productKey, artifact.approvedMedia), mapping: fixture.mapping });
  assert.equal(result.status, FINAL_EXCEL_STATUSES.NEEDS_TEMPLATE_MAPPING);
  assert.equal(result.row, null);
});

test('exports only ready products to a separate workbook while preserving template and exact values', async (t) => {
  const fixture = await mappedTemplate(t);
  const first = productionArtifact('ugopt:first', { pricingDecision: pricingDecision('ugopt:first', 44901) });
  const waiting = productionArtifact('ugopt:waiting');
  const before = await fileHash(fixture.inputPath);
  const outputPath = path.join(fixture.dir, 'output.xlsx');
  const result = await exportFinalProductsToWorkbook({
    inputPath: fixture.inputPath,
    outputPath,
    products: [
      { productionArtifact: first, publishableMedia: publishableMedia(first.productKey, first.approvedMedia) },
      { productionArtifact: waiting },
    ],
  });
  assert.equal(result.status, FINAL_EXCEL_STATUSES.EXPORTED);
  assert.deepEqual(result.products.map((item) => item.status), [FINAL_EXCEL_STATUSES.EXPORTED, FINAL_EXCEL_STATUSES.WAITING_FOR_MEDIA_PUBLICATION]);
  assert.equal(await fileHash(fixture.inputPath), before);
  const workbook = await loadWorkbook(outputPath);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Reference', 'Products']);
  const sheet = workbook.getWorksheet('Products');
  assert.equal(sheet.getCell(2, 8).value, 449.01);
  assert.equal(sheet.getCell(2, 11).value, 'https://cdn.example.test/ugopt%3Afirst/1.png, https://cdn.example.test/ugopt%3Afirst/2.png, https://cdn.example.test/ugopt%3Afirst/3.png, https://cdn.example.test/ugopt%3Afirst/4.png, https://cdn.example.test/ugopt%3Afirst/5.png');
  assert.equal(sheet.getCell(2, 14).value, '0007');
  assert.equal(sheet.getCell(2, 18).value, 'Потужність');
  assert.equal(sheet.getCell(2, 20).value, '2200 Вт');
  assert.equal(sheet.getCell(2, 21).value, 'Колір');
  assert.equal(sheet.getCell(2, 23).value, 'чорний');
  await fs.access(outputPath);
});

test('bridge inputs stay immutable and deterministic', () => {
  const artifact = productionArtifact();
  const media = publishableMedia(artifact.productKey, artifact.approvedMedia);
  const input = { productionArtifact: artifact, publishableMedia: media };
  const before = structuredClone(input);
  const first = buildFinalProductExcelRecord(input);
  const second = buildFinalProductExcelRecord(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});


test('production artifact exports through delta bridge into the exact 108-column user template', async (t) => {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const inputPath = fileURLToPath(new URL('../../templates/prom-reference.xlsx', import.meta.url));
  const outputPath = path.join(dir, 'delta.xlsx');
  const hash = await fileHash(inputPath);
  const artifact = productionArtifact('ugopt:audit-test');
  artifact.selectedProduct.product.supplierSku = '990000001';
  artifact.resolvedMetadata.productCode = 'U990000001U';
  const result = await exportPromDeltaWorkbook({ inputPath, outputPath, products: [{
    productionArtifact: artifact,
    publishableMedia: publishableMedia(artifact.productKey),
    physicalFields: { Номер_групи: '149376358', Посилання_підрозділу: 'https://prom.ua/Feny-dlya-volos' },
  }] });
  assert.equal(result.status, 'EXPORTED', JSON.stringify(result.error));
  const [source, output] = await Promise.all([loadWorkbook(inputPath), loadWorkbook(outputPath)]);
  const sheet = output.getWorksheet('Export Products Sheet');
  const h = sheet.getRow(1).values;
  assert.equal(h.length - 1, 108);
  assert.deepEqual(h, source.getWorksheet('Export Products Sheet').getRow(1).values);
  assert.equal(sheet.actualRowCount, 2);
  assert.equal(sheet.getCell(2, h.indexOf('Код_товару')).value, 'U990000001U');
  assert.equal(sheet.getCell(2, h.indexOf('Ціна')).value, 449);
  assert.equal(sheet.getCell(2, h.indexOf('Тип_товару')).value, 'r');
  assert.equal(sheet.getCell(2, h.indexOf('Одиниця_виміру')).value, 'шт.');
  assert.equal(sheet.getCell(2, h.indexOf('Унікальний_ідентифікатор')).value, null);
  assert.equal(h.filter((x) => x === 'Назва_Характеристики').length, 19);
  assert.equal(sheet.getCell(2, h.indexOf('Назва_Характеристики')).value, 'Потужність');
  assert.deepEqual(output.getWorksheet('Export Groups Sheet').getSheetValues(), source.getWorksheet('Export Groups Sheet').getSheetValues());
  assert.equal(await fileHash(inputPath), hash);
});
