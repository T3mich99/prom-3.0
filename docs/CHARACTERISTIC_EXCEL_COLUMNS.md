# Characteristics → Dynamic Excel Columns v1

## Purpose

`buildCharacteristicColumnPlan` is the separate Excel boundary for mapping
validated Content Artifact characteristics to physical dynamic-characteristic
columns. It does not generate characteristics, change canonical row fields,
insert workbook columns, or publish products to Prom.

## Audited workbook model

Repository fixtures, historical workbooks, and legacy builders establish one
safe v1 model: a contiguous block of repeated three-column slots:

```text
Назва_Характеристики | Одиниця_виміру_Характеристики | Значення_Характеристики
Назва_Характеристики | Одиниця_виміру_Характеристики | Значення_Характеристики
```

Historical Russian templates use the same roles with indexed suffixes after
the first slot, for example `Название_характеристики_2`,
`Единица_измерения_характеристики_2`, and
`Значение_характеристики_2`. The Ukrainian repeated-header and Russian
indexed-header variants are the supported formats. The unit column is a
structural part of each slot, but repository golden exports prove it is
optional: valid rows commonly leave it blank while the complete value, such as
`2200 Вт` or `1 шт.`, remains in the value column. The current Content Artifact
contains `{ name, value }`, so the v1 plan exposes
`unitHandling: 'leave-unwritten'`, writes only name and value, and never
infers or splits a unit. A historical row may contain a separate unit value,
but no current regression requires one for this boundary.

Named property columns, arbitrary name/value pairs, characteristic columns
whose role or slot number cannot be established, and other unproven formats are
unsupported. V1 has no explicit characteristic-name mapping option because
the audited production format is positional rather than name-addressed.

## API and result

```js
buildCharacteristicColumnPlan({ contentArtifact, mapping }, options)
```

The adapter reads only `contentArtifact.content.characteristics` after calling
the existing Content Quality validator. It returns a deterministic,
library-neutral result:

```js
{
  status,
  productKey,
  unitHandling: 'leave-unwritten',
  writes: [{ characteristicIndex, role, value, columnIndex, columnLetter, originalHeader }],
  mappedCharacteristics: [{ characteristicIndex, slotIndex, name, value, nameColumnIndex, valueColumnIndex }],
  unresolvedCharacteristics,
  diagnostics,
  quality,
}
```

`SAFE` means every characteristic in the artifact has an unambiguous supported
slot. `NEEDS_MAPPING` means the workbook structure is recognized but is
ambiguous, conflicting, or has insufficient capacity. `UNSUPPORTED` means the
workbook does not expose the supported v1 structure. Malformed programmer
input is rejected with `TypeError`.

## Detection, normalization, and order

The adapter reuses `inspectWorkbook` and `mapTemplateSchema`; it does not scan
the workbook a second time. The schema mapper already preserves
`dynamicCharacteristicColumns` with absolute `columnIndex`, `columnLetter`,
and `originalHeader` metadata.

Header matching uses only the repository's `normalizeHeader` behavior:
Unicode NFKC normalization, trimming, whitespace/underscore collapsing, dash
normalization, and safe case normalization. This normalization is structural
only. It never trims, translates, splits, coerces, or otherwise changes an
exported characteristic value. Fuzzy matching, synonyms, substring guessing,
embeddings, LLM matching, and translation guessing are deliberately not used.

Characteristics are assigned sequentially in their Content Artifact order to
the first, second, and subsequent safe slots. Existing unit columns and extra
unused slots remain unchanged. No new columns are inserted. If capacity is
insufficient, every excess characteristic is returned in
`unresolvedCharacteristics` with reason `INSUFFICIENT_CHARACTERISTIC_CAPACITY`
and no partial write plan is emitted. Duplicate physical targets, incomplete
slots, normalization collisions, invalid slot order, and non-contiguous slot
numbers are never resolved by choosing a first or last column.

## Content Quality gate

Only a `READY` Content Artifact can produce a writable characteristic plan.
`REVIEW` and `REWORK` are returned without writes and retain the existing
quality result. The adapter does not independently decide that a characteristic
looks valid and does not derive values from titles, descriptions, keywords,
supplier data, URLs, categories, or images.

## Adaptive Writer sidecar

The canonical `rows` argument remains unchanged. The optional
`characteristicPlans` argument is a separate, one-plan-per-row sidecar:

```js
writeAdaptiveWorkbook({
  inputPath,
  outputPath,
  mapping,
  rows,
  characteristicPlans,
})
```

When supplied, `characteristicPlans.length` must equal `rows.length`, every
plan must be `SAFE`, and each write must target a detected dynamic column with
matching absolute index, letter, and original header. Each characteristic
target has a separate name and value write; duplicate targets and unresolved
plans are rejected. The sidecar is written on the exact same physical output
row as its canonical row. If it is omitted, the existing writer path and its
result shape are unchanged.

The writer applies the existing safety boundary to dynamic targets as well as
canonical targets. Any formula in a target column is rejected with
`FORMULA_TARGET_UNSAFE`. Any target inside an existing merged range, including
an anchor or non-anchor cell, is rejected with `MERGED_CELL_CONFLICT`. Existing
rows are not backfilled and no template headers are changed.

After saving and reloading, the writer validates every canonical and
characteristic value, unchanged headers, worksheet names/order, and unchanged
input SHA-256 hash. ExcelJS objects do not cross the adapter boundary.

The writer appends after the last used physical row. Consequently, a value in
a would-be appended row makes that row part of the existing used range; the
writer selects the following row instead. It does not overwrite such a
pre-existing unit value, and the genuinely appended row is blank before the
sidecar writes.

## Relationship to the Content Row Adapter

`buildContentExcelRow` remains responsible only for the canonical semantic row.
Its deferred `characteristics` marker remains accurate for callers that have
not constructed a dynamic sidecar. A caller combines the canonical row and a
`SAFE` characteristic plan when the inspected workbook exposes supported
dynamic slots.

`SAFE` characteristic mapping does not mean that the complete Prom product is
publishable. Pricing, categories, identifiers, required Prom fields, media,
and publication remain separate contracts.
