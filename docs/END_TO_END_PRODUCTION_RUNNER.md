# End-to-End Production Runner v1

## Purpose

`src/orchestration/end-to-end-production-runner.mjs` is the single stateless
composition entry point for a production run. It coordinates existing PR13,
PR22, PR25 and PR26 contracts; it is not a new pricing, content, photo,
identifier, category or Excel implementation.

```js
await runEndToEndProduction(request, options)
```

The runner is Plus-first by default. It does not call the ChatGPT web UI,
automate a browser or login, require an OpenAI/API key, publish to Prom, upload
media, host images, persist jobs, retry work, or schedule background runs.

## Request

The request is JSON and has one of two modes:

```json
{
  "mode": "EXPLICIT_CATEGORIES",
  "categories": [{ "requestKey": "hair", "requestedName": "Hair tools" }],
  "maxProducts": 6000,
  "productInputs": {
    "ugopt:SKU-1": {
      "sourceFacts": { "type": "Фен" },
      "marketEvidence": { "productKey": "ugopt:SKU-1", "comparables": [] }
    }
  }
}
```

`FULL_CATALOG` has no `categories` property. It loads the current live
UG-OPT category catalog, then collects every current category through the
existing supplier adapter. No static category list is embedded in PR #27.

`productInputs` is keyed by the existing canonical `selectionKey`. It may
carry only existing PR25/PR26 artifacts: supplier state, PR22-compatible
pricing input/evidence, content/photo/approved-media artifacts, verified
source facts, resolved metadata, characteristics mapping and publishable
media. Resume is purely logical: supply completed artifacts in a later
request. There is no database or hidden state file.

Category request `limit` is a final per-category maximum, not a supplier-fetch
or candidate-analysis limit. PR27 collects and prices every in-scope candidate,
then walks the existing PR22 global ranking in rank order. A category may
contribute at most its configured limit; a category without a limit is subject
only to the global `maxProducts` limit. This lets a later stronger candidate
displace a weaker earlier candidate in the same category. The canonical
Product Selector first-wins `selectionKey` trace remains the category authority
when a supplier product occurred in more than one category.

Optional export is explicit:

```json
{
  "export": {
    "inputPath": "template.xlsx",
    "outputPath": "result.xlsx",
    "mappingOptions": {}
  }
}
```

The source workbook is never overwritten. Output paths are caller supplied.

## Pipeline and authorities

```text
UG-OPT catalog/categories -> all deduplicated candidates
  -> PR22 market evidence + pricing -> PR22 rank -> PR22 top <= 6000
  -> PR25 content/photos -> publishable media -> PR26 Excel export
```

All candidates are evaluated economically before the global top-product cap.
`6000` is a hard maximum, never a candidate collection limit or a target.
Thus an economically stronger later supplier candidate can displace an earlier
one. `PRICE_REVIEW` and `SKIP` never enter PR25 content or photo work.

Missing market evidence without an injected PR22 researcher returns one
`MARKET_RESEARCH` operator task per product. After evidence is returned,
selected products move through PR25's current field-level content and
photo tasks. `approvedMedia` remains local-only. Without valid public
Publishable Media, a product is `WAITING_FOR_MEDIA_PUBLICATION`; no local path
is converted to a URL.

PR26 remains the only Excel bridge. An Excel result of `EXPORTED` means an
XLSX file was written; it does not mean published, live or imported to Prom.

## Result and statuses

The deterministic result contains `scope`, `catalog`, `candidates`, `pricing`,
`ranking`, `selected`, independent `products`, current `operatorTasks`,
optional `export`, counters and diagnostics. Run statuses are:

- `COMPLETED` — valid run completed its current scope;
- `PARTIAL` — valid mixed run, such as unavailable public media or skips;
- `WAITING_FOR_OPERATOR` — current per-product operator tasks exist;
- `REVIEW_REQUIRED` — category or pricing review is needed;
- `FAILED` — no runnable product result could be produced.

Per-product statuses come from PR25 and PR26, including
`WAITING_FOR_MARKET_RESEARCH`, `WAITING_FOR_CONTENT`, `WAITING_FOR_PHOTOS`,
`PHOTO_REWORK`, `READY_FOR_EXPORT`, `WAITING_FOR_MEDIA_PUBLICATION`,
`PRICING_REVIEW`, `SKIPPED`, `FAILED` and `EXPORTED` where applicable.

Supplier category failures are preserved in `failedCategories` diagnostics;
they are never rewritten as unavailable, removed or skipped products.

## CLI

```text
npm run production -- --request production-request.json --result production-result.json
```

The CLI only reads strict JSON, invokes the canonical runner and writes the
returned JSON. Exit code `0` means a valid result was produced, including a
valid `WAITING_FOR_OPERATOR` result. Exit code `1` means malformed arguments,
invalid JSON/request, or a system failure. It adds no business logic.

## Manual scenarios

- One category without evidence: `MARKET_RESEARCH` tasks only.
- Multiple categories with evidence: PR22 ranks first; only selected products
  receive PR25 content tasks.
- More than 6000 READY decisions: all are priced and ranked; only PR22's first
  6000 ranked READY decisions proceed.
- Resume with content: PR25 returns photo tasks only.
- Five approved local photos without public URLs: media-publication waiting.
- Complete artifacts and safe workbook mapping: PR26 writes `EXPORTED`.
- Mixed batches retain independent product statuses.
- A failed supplier category remains a partial-scope diagnostic.
- `PRICE_REVIEW` and `SKIP` have no content/photo task.
- CLI output is the same structured domain result as the direct runner.

## Limits and PR #28

This runner is deterministic for deterministic injected inputs and supports
candidate pools larger than 6000 without a giant LLM prompt. It does not add
durable persistence, a scheduler, retries, queues, alerts, a service/daemon,
concurrency manager, hosting, a Prom API, a live AI API or automatic 24/7
execution. Those are explicitly PR #28 concerns.
