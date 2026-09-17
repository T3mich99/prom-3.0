# Dynamic Product Selection

Status: Product Selector v1 on `feature/dynamic-product-selector-v1`.

This phase adds a small pure selector core and a strict run-request contract.
It does not crawl suppliers, resolve category names, modify existing selectors,
choose pricing or stock policy, or change any Prom/Excel behavior.

## Pipeline boundary

```text
Run Request
    |
    v
Category Resolver [future adapter]
    |
    v
Candidate Collector [future adapter]
    |
    v
Eligible Candidate Sets
    |
    v
Dynamic Product Selector
    |
    v
Selected Products
    |
    v
Existing Processing Pipeline
```

The selector receives already-resolved category candidate sets. Category
resolution is deliberately outside this phase: the selector does not decide
that a requested name corresponds to a supplier ID, URL, slug, alias, or
taxonomy node.

## Request model

`validateRunRequest` accepts a request with:

```js
{
  categories: [
    {
      requestKey: 'category-a',
      requestedName: 'Category A',
      resolvedCategory: {
        source: 'fixture',
        sourceCategoryKey: 'source-a'
      },
      limit: 20,
      candidates: [
        {
          selectionKey: 'supplier:fixture:a-1',
          product: { /* original product data */ }
        }
      ]
    },
    {
      requestKey: 'unknown-category',
      requestedName: 'Unknown category',
      resolution: 'notFound',
      candidates: []
    }
  ],
  totalLimit: 30
}
```

`requestKey`, `requestedName`, and candidate `selectionKey` are required
non-empty strings. `resolvedCategory` is an opaque resolver result; the
selector does not validate its taxonomy fields. A resolved category has a
candidate array. An unresolved category must explicitly use
`resolution: 'notFound'`, have no `resolvedCategory`, and have an empty
candidate array.

`limit` and `totalLimit`, when present, must be non-negative integers. Values
such as `-1`, `1.5`, and `'1'` are rejected rather than coerced. A value of
zero selects zero products. An absent limit means no cap.

## Selection behavior

`selectProducts(request)` is pure and deterministic. It reads only the passed
request and does not access the filesystem, network, supplier sites, Prom,
Excel, environment variables, process arguments, Drive, or a database.

- Categories are processed in request order.
- Candidates are considered in candidate-array order.
- No sorting, randomization, popularity, price, margin, AI, or newest-first
  ranking is performed.
- Both category and total limits apply.
- The total limit is global and is consumed in request order.
- If candidates are insufficient, all available unique candidates are selected
  and the report contains the shortfall.
- With no per-category or total limit, all unique candidates are selected.

Input order is only a deterministic transport order. It is not a business
claim that earlier products are better.

## Opaque identity and deduplication

Each candidate supplies an explicit `selectionKey`. The selector treats this
key as opaque: it does not trim it, convert it with `Number`, strip `U`, call
`parseInt`, lowercase it, or otherwise normalize it. Supplier SKU, Prom code,
internal ID, and U-wrapped code are not assumed to be interchangeable.

Deduplication is global across the complete request and uses deterministic
first-wins semantics. When a key has already been selected, a later candidate
with that exact key is rejected and counted in the relevant category's
`duplicateCount`. The first selected product and its trace remain unchanged.

Only candidates actually considered before a category or total cap stops
selection can be recorded as duplicates. A candidate skipped because a cap was
already reached is not silently counted as selected or duplicated.

## Result model

The result has three parts:

```text
selectedProducts: wrapper records
categories: per-request-category reports
summary: aggregate counts
```

Each selected wrapper contains:

- `requestKey`;
- `requestedCategory`;
- `resolvedCategory` or `null`;
- the opaque `selectionKey`;
- the original `product` value.

The selector does not mutate the original request, category arrays, candidate
arrays, or product objects.

Each category report contains its request key/name, resolution status,
resolved-category trace, candidate count, requested limit, selected count,
duplicate count, and shortfall. An absent limit is reported as `null` and has
no shortfall. A requested limit reports `max(limit - selectedCount, 0)`.

The aggregate summary contains requested, resolved, and unresolved category
counts; total candidate, selected, and duplicate counts; and the optional
global limit.

## Unresolved categories

An unresolved category remains visible in the per-category report with
`resolutionStatus: 'notFound'` and selects zero products. It cannot borrow
candidates from another category and never silently substitutes a fallback
category. If a requested category cannot be resolved, the future resolver or
caller must report that failure explicitly.

## Deliberate non-responsibilities

The selector does not:

- discover category URLs or crawl supplier pages;
- perform fuzzy matching, AI matching, transliteration, or aliases;
- invent fallback source categories;
- apply historical exclusion files or local artifact lookup;
- filter by stock or availability;
- filter or rank by price, profit, margin, commission, or profitability;
- assign a Prom category or group to a product;
- change descriptions, keywords, photos, identifiers, pricing, or Excel rows.

Historical exclusion is a separate policy. Future adapters may perform:

```text
supplier candidates
    -> history exclusion
    -> eligible candidate sets
    -> Product Selector
```

Stock eligibility is likewise decided by candidate collection. The selector
chooses only from the candidate list it receives.

## Tests and next integration step

The selector tests use neutral synthetic categories and literal expected
values. They cover limits, total-limit precedence, shortfalls, unresolved
categories, opaque keys, first-wins deduplication, ordering, validation
errors, summary counts, and input immutability.

The next phase may connect one existing supplier adapter/workflow to this core:
it must resolve requested categories, collect candidates, apply any approved
history/stock policy, assign explicit selection keys, and pass eligible sets
into `selectProducts`. Broad supplier integration is outside Product Selector
v1.
