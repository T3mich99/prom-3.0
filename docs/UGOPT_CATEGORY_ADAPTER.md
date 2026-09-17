# UG-OPT Category Adapter v1

Status: the supplier adapter boundary for `feature/supplier-category-adapter-v1`.

This phase connects runtime-requested UG-OPT source categories to the existing
Dynamic Product Selector. It stops at selected-products data. Content, photos,
pricing, Excel export, Prom publishing, history exclusion, stock policy, and
category assignment remain downstream concerns.

## Boundary

```text
Runtime Category Request
        |
        v
UG-OPT Category Adapter
        |
        v
Candidate Sets
        |
        v
Dynamic Product Selector
        |
        v
Selected Products
```

The runtime request supplies explicit source category references. A category
list can contain one or many entries and can change between runs without a
source-code edit:

```js
{
  categories: [
    {
      requestKey: 'hair-dryers',
      requestedName: 'Фени',
      sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g38298691-feny',
      limit: 20,
    },
  ],
  totalLimit: 20,
}
```

`sourceCategoryUrl`, `requestKey`, and `requestedName` are technical adapter
inputs. The adapter does not fuzzy-match names, invent aliases, guess URLs or
supplier IDs, or fall back to another category.

## Modules

- `src/suppliers/ugopt/category-parser.mjs` is pure HTML-to-candidate parsing.
- `src/suppliers/ugopt/category-adapter.mjs` validates runtime references,
  fetches pages, maps failures, preserves order, and calls the selector in the
  optional integration function `collectAndSelectUgoptCategories`.

The parser follows the card structure already used by the legacy UG-OPT
selectors. It reads the product ID, supplier SKU, product URL, title, optional
card price, and optional card image. It does not fetch product detail pages.

## Pagination and ordering

The adapter requests page 1 with `product_items_per_page=48`, reads the
proven `data-pagination-pages-count` category-page marker, and then requests
pages 2 through that reported count. A missing marker is a parse failure; a
reported count of zero is conservatively treated as one page, matching the
audited selectors' `Math.max(..., 1)` fallback without requesting an
unproven extra page. Candidate order is the source page traversal order; no
SKU, title, price, popularity, or margin sorting is performed.

Repeated cards for the same supplier SKU within one requested category are
removed at the supplier boundary, keeping the first occurrence. This only
prevents duplicate DOM/pagination entries for the same UG-OPT product. The
global cross-category deduplication remains exclusively in Product Selector.

## Candidate and identity model

Each candidate is compatible with Product Selector v1:

```js
{
  selectionKey: 'ugopt:00123',
  product: {
    supplier: 'ug-opt',
    sourceUrl: 'https://ug-opt.in.ua/ua/p123-item.html',
    supplierSku: '00123',
    title: '...',
    sourceProductId: '123',
    price: 230,
    sourceImageUrl: 'https://...',
  },
}
```

`selectionKey` is the extracted supplier SKU namespaced as
`ugopt:<supplierSku>`. Extraction preserves the existing UG-OPT semantics:
HTML entities are decoded, runs of whitespace are collapsed, and surrounding
whitespace is trimmed. It does not convert the result to a number, strip
leading zeros or outer `U` characters, lowercase it, or apply
`parseInt`/`stripOuterU`. Product Selector treats the resulting string as
opaque and performs global first-selected-wins deduplication.

Successful categories carry:

```js
resolvedCategory: {
  source: 'ug-opt',
  sourceCategoryUrl,
  sourceCategoryName,
}
```

`sourceCategoryName` is the explicit `sourceCategoryName` request value when
provided, otherwise the caller's `requestedName` trace label. No supplier
category ID is invented.

## Empty pages and failures

A fetched and parsed category with zero cards is a successful resolved
category with `candidates: []`. It is not silently converted to a failure.

Only the exact hostname `ug-opt.in.ua`, confirmed by the existing repository
URLs, is accepted by this supplier-specific adapter. Other hosts are rejected
before `fetchImpl` is called. Fetches use injected `fetchImpl` in tests and
`globalThis.fetch` by default.
Non-OK HTTP responses and network/body errors return an explicit category with
`resolution: 'notFound'`, an empty candidate list, and a structured `failure`
object. HTTP 404, HTTP 500, network errors, and parser errors remain
distinguishable by `failure.kind` (`http`, `network`, or `parse`). No retry
framework is introduced in v1.

The returned failure shape is compatible with Product Selector's unresolved
category contract, so a failed category remains visible in selection reports
and never borrows candidates from another category.

## Non-responsibilities and next step

The adapter does not apply historical exclusions, stock filters, pricing or
profit rules, ranking, Prom category assignment, identifiers, content, photos,
Excel fields, or publishing. A later phase may add a separate eligibility or
enrichment boundary between supplier candidates and the downstream processing
pipeline. Automated tests use small synthetic HTML and injected fetches; no
live UG-OPT availability is required for CI.
