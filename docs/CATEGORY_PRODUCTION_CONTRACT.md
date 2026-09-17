# Category Production Contract v2

`CATEGORY_PRODUCTION` is the category-first production mode. It accepts one
canonical UG-OPT `categoryUrl` or an injected `categoryId` resolver and sends
the eligible new-product delta, or an explicit targetCount batch, through the existing production gates.

## Flow

```text
UG-OPT category
  -> full pagination
  -> persistent Prom registry filter
  -> PR22 category pricing
  -> PR25 single-product orchestration
  -> commercial content and characteristics
  -> individual PHOTO_ART_DIRECTION brief and diversity checks
  -> PR20 photo plan/prompt foundation
  -> PR24 PNG/Photo QA
  -> Drive publication boundary
  -> Prom master-template delta export
```

The implementation is `src/orchestration/category-production-runner.mjs`.
It does not call `selectTopProfitableProducts()`. All pages are collected and
registry/eligibility filtering runs first. An explicit positive integer
`targetCount` selects up to that many NEW eligible products in source order;
without it the full delta is processed. Ranking is analytics only.
`selectedProductKeys` pins a requested batch on resume; absent/blocked selected
keys block completion. Deferred candidates do not receive production tasks.

## Registry policy

The canonical supplier identity is `ugopt:${supplierSku}` and the Prom code is
the existing `buildPromProductCode()` result. Candidates are excluded when the
persistent registry contains `EXISTING_IN_PROM`, `CONFIRMED_IN_PROM`, or
`RESERVED_FOR_IMPORT`, or when the code is a registry collision. Duplicate
codes inside the collected category are excluded as candidate-pool
collisions. No SKU suffix is generated to bypass this policy.

## Category pricing

Category pricing uses the existing PR22 money, commission, profitability, and
ranking machinery. The category policy fixes Prom commission at 20% (2000
bps) and uses this piecewise-linear net-ROI curve:

| Purchase price (UAH) | Target net ROI |
| ---: | ---: |
| 50 or below | 130% |
| 100 | 115% |
| 300 | 85% |
| 600 | 75% |
| 1,000 | 65% |
| 2,000 | 55% |
| 5,000 | 45% |
| 10,000 | 35% |
| 20,000 or above | 25% |

The selling price uses the existing PR22 profitability calculation and
`C × (1 + targetNetROI) / (1 - 0.20)`. The market median, quartiles, and
difference are retained as analytics. A price above the market does not by
itself produce `SKIP` or `PRICE_REVIEW` in this mode.

Market research is optional analytics in `CATEGORY_PRODUCTION`. When no
evidence or researcher is supplied, PR22 records `NOT_RESEARCHED` market
analytics and calculates the selling price from supplier cost and the
category dynamic net-ROI curve. Generic production modes retain their
mandatory market-research gate.

## Content, photos, and export

Content is still validated by the existing commercial Content Contract. The
category runner does not add claims or completeness/package sections.

Photo work is delegated to the existing PR20/PR24 planner, prompt builder,
byte validator, visual QA, and selective rework implementation. The runner
does not create a second photo contract or add an ad-hoc prompt. The existing
five canonical roles remain the source of truth: `hero`, `usage`, `benefits`,
`feature`, and `final`. The Drive bridge maps these roles to its public upload
filenames.

The runner creates a media-publication operator task for local approved media
that has no verified public HTTPS URLs. It never invents a URL. The existing
Prom delta exporter can create a workbook only after validated public media,
category mapping, and the saved Prom master-template contract are available.

When a durable state store and existing `runId` are supplied, the runner first
rehydrates the stored request artifacts through the PR28 `reconstructRequest()`
boundary, then persists each product result and the final aggregate. Newly
supplied `productInputs` override the rehydrated values for operator resume.
The runner never creates a replacement run implicitly.

## Full-category completion and built-in execution

Codex executes operator tasks in its active session with its built-in tools;
missing provider callbacks in Node are not a request for a paid API. The CLI
itself cannot call a ChatGPT session's image tool and cannot bypass account limits.
See CODEX_CATEGORY_EXECUTION.md for the concrete operator loop.

The category runner exports only when every eligible new product is
READY_FOR_EXPORT, there are no operator tasks, no invalid candidates and all
media are published. Manual-review/failed products block the final workbook;
`completion` identifies blocked and registry-skipped products. Existing Prom
products remain excluded from this new-product route. An empty new-product delta
never produces an empty final workbook.

The CLI now connects the existing SQLite production state store, checkpoints each
product and merges resumed product fields. Final Excel readiness is
`completion.finalWorkbookReady`; successful CLI reservations additionally require
`reservationStatus=COMPLETE`. Never label WAITING_FOR_OPERATOR as final delivery.

## Requested-count completion

For targetCount batches, invalid candidates outside the selection are reported
but do not block the selected valid batch. All selected products must pass the
same content, image, public-media and Excel gates. `selectedBatchReady` describes
that scope; `wholeCategoryReady` remains literal whole-category readiness.
`requestedCountMet` compares the selected count with targetCount. A ready smaller
batch may export with `partialWorkbookReady=true`, `finalWorkbookReady=false`
and status INSUFFICIENT_NEW_PRODUCTS. Empty batches never export.

The CLI defaults export input to config/category-workflow.json catalogPath,
remembers successfully bootstrapped explicit inputs and derives an XLSX output
beside the result JSON. A different targetCount needs a new batch/result path.
Existing registry reservations survive later batches within the same project.
