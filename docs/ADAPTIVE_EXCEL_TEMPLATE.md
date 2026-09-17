# Adaptive Excel Template Adapter v1

## Purpose

This boundary inspects a reasonable `.xlsx` workbook, identifies a likely
product worksheet and header row, maps proven Prom destination columns to an
internal vocabulary, and writes already-approved row values to a separate copy.

The adapter does not decide business values. It does not calculate prices,
generate content, assign supplier categories, generate photos, or publish to
Prom. It only determines where supplied values may safely be written.

## Supported format and implementation

V1 supports `.xlsx` only. `.xls`, `.xlsb`, `.ods`, `.csv`, and `.xlsm` are not
claimed as supported. The implementation is Node.js and uses the pinned public
`exceljs@4.4.0` dependency through `src/excel/xlsx-engine.mjs`. No Codex
runtime package, Python dependency, network service, LLM, or macro execution is
used.

The adapter boundary uses `loadXlsx` and `saveXlsx` to load a workbook and save
a copy. The public inspection and mapping results do not expose ExcelJS
objects.

## Inspection model

`inspectWorkbook(inputPath)` returns plain deterministic data:

```js
{
  workbookType: 'xlsx',
  sheets: [{
    name, index, hidden, serviceLike,
    usedRange: { startRow, endRow, startColumn, endColumn, rowCount, columnCount },
    candidateHeaderRows: [{ rowNumber, score, recognizedCount, ... }],
    headerCandidates: [{ rowNumber, columns: [...] }],
    columns: [...],
  }],
  candidateProductSheets: [...],
  diagnostics: [...],
}
```

The inspector scans at most the first 50 rows. A header candidate is based on
recognized exact aliases, a rectangular populated row, and string header
values. Original header text is retained beside its normalized presentation
form. No fuzzy matching, translation, embeddings, substring guessing, or
semantic AI is used.

## Sheet and header discovery

The inspector does not assume the first sheet, `Sheet1`, `Товари`, `Prom`, or
`Products`. Product-sheet evidence comes from recognized product fields and
product-signal fields such as title, code, price, description, keywords, or
image links. Service-like names such as `Reference`, `Lookup`, `Config`, `QA`,
and their Ukrainian/Russian equivalents are excluded from automatic selection.
Hidden and very-hidden worksheet states are read from the `.xlsx` workbook
metadata and are excluded from automatic selection.

If two product worksheets have equal evidence, mapping returns
`NEEDS_MAPPING` with `AMBIGUOUS_PRODUCT_SHEET`. If two header rows have equal
evidence, it returns `NEEDS_MAPPING` with `AMBIGUOUS_HEADER_ROW`. No first-match
fallback is used for either choice.

Header normalization is limited to Unicode normalization, trimming, collapsing
spaces/underscores, and normalizing dash presentation. Original header values
remain unchanged and are used by the writer validation.

## Canonical fields and aliases

The destination vocabulary is derived from the existing Prom contract fixture,
tracked templates, golden workbook snapshots, and current builders:

```text
productCode, titleRu, titleUa, descriptionRu, descriptionUa,
keywordsRu, keywordsUa, price, manufacturer, unit, photoUrls,
categoryId, categoryName, uniqueId, productId, currency, availability
```

The only required v1 field is `titleRu`. This is the smallest stable core
proven across the repository without making this adapter own pricing, identity,
content, photo, or category semantics. All other fields are optional template
destinations. A price-like header that is not an exact proven selling-price
alias still creates `NEEDS_MAPPING`; optional does not mean ambiguous values
may be guessed.

The alias registry is explicit and frozen. It includes exact Prom headers such
as `Код_товару`, `Назва_позиції`, `Назва_позиції_укр`, `Опис`, `Опис_укр`,
`Пошукові_запити`, `Пошукові_запити_укр`, `Ціна`, `Виробник`,
`Посилання_зображення`, and their proven Russian/header-spacing variants.

Repeated Prom characteristic columns are classified structurally as
`dynamicCharacteristic` when their headers match the proven
`Назва/Одиниця/Значення_Характеристики` pattern. Their values are not
interpreted or rewritten.

## Mapping statuses

`mapTemplateSchema(schema, options)` returns:

- `SAFE` means the workbook structure and current mapping are safe for this
  adapter's write operation. It means one sheet and header row are resolved,
  required fields have exactly one mapping, and no conflicting mapping remains.
  It does not mean the workbook is a complete Prom import workbook, that all
  Prom-required business fields exist, that pricing is ready, that a product is
  publishable, that content is approved, or that photos are ready;
- `NEEDS_MAPPING`: the workbook is readable but a user must choose a sheet,
  header row, or mapping, including any ambiguous price or duplicate-column
  case;
- `UNSUPPORTED`: no usable product structure exists or the format is outside
  v1 support.

Normal `NEEDS_MAPPING` is a result, not an exception. Invalid explicit mapping
options are rejected because silently repairing a user decision is unsafe.

Automatic confidence is categorical: `exact-alias` or
`explicit-user-mapping`. Numeric confidence percentages are not used.

## Explicit mapping

Explicit options may select a worksheet, one-based header row, and canonical
columns:

```js
{
  sheetName: 'Products',
  headerRow: 3,
  columns: {
    titleRu: 'Назва товару',
    price: 'Ціна продажу',
  },
}
```

Column values may be a zero-based column index, an Excel column letter, or an
exact original header. Explicit mappings override automatic mappings, but the
target must exist. Unknown canonical keys, missing headers, duplicate physical
assignment to incompatible fields, and ambiguous exact-header selection are
rejected.

In particular, a sheet containing `Ціна закупівлі`, `Ціна продажу`, and `РРЦ`
does not automatically map `price`. An explicit mapping is required unless a
single exact registered selling-price alias exists.

## Safe writer

`writeAdaptiveWorkbook({ inputPath, outputPath, mapping, rows, mode })` accepts a
`SAFE` mapping and canonical row records. V1 supports only `appendRows` mode.
Rows are appended after the used range, never silently overwriting existing
product rows. The writer does not calculate or transform supplied values.

Unknown row keys are rejected. `undefined` optional values leave the target
cell untouched; `null` writes a blank cell. Strings, finite numbers, and
booleans preserve their primitive types. Identifier-like strings, including
leading zeros, remain strings.

The input and output paths must both be `.xlsx` and must resolve to different
files. The input is loaded into memory and the output is saved separately.
The input SHA-256 hash is checked before and after the operation.

Formula-bearing mapped target columns are rejected rather than overwritten.
Writes to any cell inside an existing merged range, including its anchor, are
rejected; the writer never unmerges or reformats a workbook. Existing
worksheet names/order, header values, unrelated sheets, and mapped values are
validated after the output is reopened.

## Preservation and limitations

The adapter uses copy-and-save through ExcelJS, so it
preserves worksheet order, unrelated sheets, existing styles, column/row
layout, formulas outside written targets, merged cells, and data validation
as covered by the fidelity tests. It does not redesign, autofit,
restyle, or clean up spreadsheets.

This is not a promise of byte-for-byte XLSX fidelity: ExcelJS may
re-serialize package XML, unsupported Excel extensions may be normalized, and
advanced features not exposed by the boundary are not guaranteed. Macros,
encrypted/protected workbooks, `.xls` binary files, external connections,
PivotTable fidelity, and arbitrary Excel formula recalculation are outside v1.
Formula targets are conservatively blocked rather than recalculated.

## Non-goals and future integration

This PR does not rewrite existing builders or change their business values. It
does not modify Content Quality, Product Selector, identifiers, pricing,
categories, photos, Prom publishing, golden extraction, or golden fixtures.
Future work can integrate this boundary with a product/content/photo pipeline
after each pipeline provides an explicit neutral row contract and mapping
policy.
