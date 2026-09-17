# UG-OPT Run Orchestrator v1

## Purpose

`runUgoptProductSelection(runRequest, options)` is the first end-to-end
composition layer for dynamic UG-OPT product selection. The caller supplies
human category requests only; it does not supply supplier URLs, IDs, or a
catalog.

## Pipeline

```text
runtime request
    -> load UG-OPT category catalog once
    -> resolve requested names
    -> keep only resolved source categories for collection
    -> collect supplier candidates through the existing adapter
    -> select products through Product Selector v1
```

The returned result keeps the original `request`, the complete resolver output
under `resolution`, a compact `catalogSummary`, the existing `selection`
result, and the top-level `selectedProducts` list.

## Runtime request

```js
{
  categories: [
    { requestKey: 'hair-dryers', requestedName: 'Фени', limit: 20 },
    { requestKey: 'curlers', requestedName: 'Плойки, праски, гофре', limit: 15 },
  ],
  totalLimit: 35,
}
```

The public function is:

```js
runUgoptProductSelection(runRequest, {
  catalogLoader,
  adapterCollector,
  fetchImpl,
  catalogOptions,
  adapterOptions,
})
```

The default catalog loader and adapter collector are the existing UG-OPT
modules. Tests inject the loader and `fetchImpl`; no global monkeypatching or
live network access is needed.

## Resolver-to-adapter boundary

The resolver returns supplier metadata under `resolvedCategory`. The
orchestrator explicitly maps each resolved request to the adapter input:

```js
{
  requestKey,
  requestedName,
  sourceCategoryUrl: resolvedCategory.sourceCategoryUrl,
  sourceCategoryName: resolvedCategory.sourceCategoryName,
  limit,
}
```

`parentNames` remains visible in the resolver result but is not passed to the
adapter because it is not part of the adapter's collection input contract.

## Resolution and run status

- `resolved`: the category is eligible for product collection;
- `notFound`: no supplier category is fetched for that request;
- `ambiguous`: no supplier category is fetched and no guess is made.

Run status is:

- `completed` when every requested category resolves;
- `partial` when at least one category resolves and at least one is unresolved;
- `blocked` when zero categories resolve.

Unresolved requests remain in `resolution.categories` in their original order.
With zero resolved categories, the adapter is not called and the selector
receives an empty category list only to produce its standard empty selection
report.

## Limits, order, and deduplication

The orchestrator does not implement selection policy. It preserves each
category's `limit` and the request's `totalLimit`, then delegates both to the
existing Product Selector. Resolved categories reach the adapter in original
request order. Candidate order and cross-category first-selected-wins
deduplication remain Product Selector behavior.

## Failure behavior

Catalog loader failures propagate unchanged, including catalog HTTP, network,
and parse failures. The existing adapter reports category-page HTTP, network,
and parse failures in its result; the orchestrator detects those explicit
failure records and raises `UgoptRunOrchestrationError` rather than converting
an operational failure into a semantic `notFound` result.

Semantic `notFound` and `ambiguous` outcomes are not operational failures and
do not abort a mixed run.

## Determinism and testing

The function performs no sorting, ranking, randomization, timestamps, UUIDs,
AI matching, retries, caching, or fallback mapping. It does not mutate the
request, catalog entries, resolver output, adapter result, or product objects.
Focused tests use literal catalogs, injected catalog loaders, and injected
adapter fetches. No automated test uses live network access.

## Non-goals

This orchestrator selects supplier products. It does not:

- assign Prom categories or groups;
- generate titles, descriptions, keywords, characteristics, or other content;
- calculate pricing, commission, delivery, or profit;
- generate or validate photos;
- write Excel files;
- publish products;
- apply history exclusion, stock policy, ranking, or caching.
