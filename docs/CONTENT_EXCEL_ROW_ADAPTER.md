# Content → Canonical Excel Row Adapter v1

## Purpose

`buildContentExcelRow(input, options)` is a pure composition boundary between
the existing Product Selector result, a validated Content Artifact, and the
canonical semantic row accepted by the Adaptive Excel Writer.

It does not inspect a workbook, resolve physical columns, perform I/O, call a
network, generate content, or apply business calculations.

## Inputs and identity

The input is:

```js
{
  selectedProduct,
  contentArtifact,
  resolvedMetadata,
}
```

`selectedProduct` follows the current Product Selector output and must provide
an opaque `selectionKey` and `product`. `contentArtifact` follows the Content
Contract and is validated by the existing Content Quality validator. The
adapter requires exact equality between
`selectedProduct.selectionKey` and `contentArtifact.productKey`.

`resolvedMetadata` is optional and may contain only existing canonical field
names. Its values are passed through unchanged when they are already-resolved
and their field meaning is clear. The adapter does not generate, normalize,
wrap, strip, or coerce identifiers.

## Output and quality gate

The result has deterministic structure:

```js
{
  status,             // READY, REVIEW, or REWORK
  productKey,
  row,                // canonical row for READY; null otherwise
  deferredFields,
  quality,
  provenance,
}
```

The existing `validateContentArtifact` result is retained in `quality`,
including field-level issues and `reworkPlan`. `READY` produces a writable
row. `REVIEW` and `REWORK` are explicit blocked results and never produce an
automatic final row. Malformed contract input and identity mismatch throw
explicit errors instead of becoming vague statuses.

## Canonical content mapping

The adapter maps exact Content Artifact values without trimming, translation,
HTML stripping, rewriting, or SEO enrichment:

| Content Artifact | Canonical field |
| --- | --- |
| `content.title.ru` | `titleRu` |
| `content.title.ua` | `titleUa` |
| `content.description.ru` | `descriptionRu` |
| `content.description.ua` | `descriptionUa` |
| `content.keywords.ru` | `keywordsRu` |
| `content.keywords.ua` | `keywordsUa` |

Rows are emitted in `CANONICAL_FIELDS` order and every key is checked against
that existing vocabulary. The Adaptive Writer remains responsible for mapping
canonical fields to physical workbook columns.

## Deferred and non-responsible fields

`content.characteristics` is valid content but is not an ordinary canonical
Excel field. The canonical row adapter still reports it as deferred:

```js
{ field: 'characteristics', reason: 'NO_CANONICAL_EXCEL_TARGET' }
```

For a workbook whose inspected mapping exposes supported dynamic characteristic
slots, `buildCharacteristicColumnPlan` in the separate characteristic-column
adapter consumes the same Content Artifact and produces the writer sidecar.
The canonical row adapter does not add dynamic keys to `row` and does not
silently remove this deferred marker.

The repository has no single proven final selling-price contract for this
boundary, so `price` is never copied into the row. Supplier price, purchase
price, RRP, commission, margin, and historical pricing formulas are not used.
Likewise, there is no proven approved-media artifact here, so `photoUrls` is
never treated as ready media and raw, generated, or legacy supplier images are
not used. Supplied values for either field are reported as deferred.

Categories are not resolved or inferred. Supplier category names and source
category metadata are ignored. Explicit canonical category values may pass
through only when the caller supplies them as already-resolved metadata.

Identifiers and other optional metadata are pass-through only. Missing
manufacturer, unit, currency, availability, category, and identifier values
are omitted; no defaults are invented. Leading-zero strings remain strings.

## Relationship with Adaptive Writer

For `READY` content, `result.row` can be supplied directly as one item in
`writeAdaptiveWorkbook({ rows: [result.row], ... })`. The adapter does not
know worksheet names, header rows, column letters, or mappings. A canonical row
ready for the Adaptive Writer does **not** mean a complete Prom product ready
to publish: pricing, category approval, media approval, required Prom fields,
and downstream publication remain separate contracts.

## Intentionally out of scope

This v1 boundary does not modify Product Selector behavior, supplier scraping,
UG-OPT category resolution, identifier algorithms, Content Quality thresholds
or rework semantics, pricing, photos, Prom publishing, workbook mapping, or
golden fixtures. It is synchronous, deterministic, side-effect free, and has
no filesystem, network, LLM, timestamp, random, or environment dependency.
