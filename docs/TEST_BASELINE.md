# Test Baseline

**Branch:** `refactor/software-engineering-v1`
**Phase:** characterization and safety testing
**Date:** 2026-09-11

## 1. Test structure

The repository now has lightweight tests based on Node’s built-in `node:test` runner; no large framework or production dependency was added.

```text
tests/
  fixtures/
    product-fixture.json
    prom-contract.fixture.json
    photo-manifest-complete.json
    photo-manifest-incomplete.json
  characterization/
    support.mjs
    pricing-current.test.mjs
    identifiers-categories-current.test.mjs
    content-photo-contract.test.mjs
    workflow-smoke.test.mjs
  integration/
    prom-excel-contract.test.mjs
  support/
    xlsx-compat.mjs
  quality-gate.mjs
```

The fixtures are synthetic and small. They contain no personal data, credentials, production product dataset, or live asset dependency.

`support.mjs` reads current production source and evaluates only isolated pure functions where the legacy file exposes them inside the module. For top-level loops that import files, access the network, or write workbooks, the tests use input→output contract helpers plus source locks that fail if the characterized production expression disappears or changes. This is an intentional temporary bridge; it is not a replacement for future extracted modules.

## 2. Commands

Run all tests with the bundled/current Node runtime in PowerShell:

```text
$testFiles = Get-ChildItem tests -Recurse -File -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
node --test @testFiles
```

Run only characterization tests:

```text
node --test tests/characterization
```

Run the workbook contract tests:

```text
node --test tests/integration/prom-excel-contract.test.mjs
```

Run syntax checks without executing production workflows:

```text
node --check build-prom-products.mjs
node --check excel-work/build-prom-v3-final.mjs
node --check excel-work/build-prom-photo-price-fixed.mjs
node --check scripts/build-bigdrop-hair-prom-xlsx.mjs
```

The golden and integration tests use the small portable `tests/support/xlsx-compat.mjs` adapter so they can run on a clean CI runner without the desktop-only private `@oai/artifact-tool` package. Production workbook scripts remain unchanged and may continue to use the configured workspace runtime. No dependency directory was modified and no package installation was performed.

For the complete cross-platform local quality gate, use `node tests/quality-gate.mjs all` (see `docs/CI.md`).

## 3. Business behavior protected

The baseline protects the current behavior of:

- root tiered pricing, dropship markup 1.3, five-percent safety margin, additional rate components, commercial anchors, and hard floors;
- the separate `apply-price-rule.mjs` tier table, expected delivery 105, worst-case delivery 120, and ceiling rounding;
- strict 20% commission orientation and `purchase × 1.90 / 0.80` pricing with its 5/10-unit retail rounding;
- U-wrapper stripping, numeric unique IDs, U-wrapped product identifiers, malformed-ID rejection, and duplicate detection semantics;
- known category-label mappings, missing-category errors, explicit-category QA, and current blank category-link behavior;
- unknown manufacturer fallback to `AND`, known manufacturer preservation in strict builders, and retail-only blank wholesale fields;
- five photo role names/order, direct Drive URL shape, 1280×1280 PNG metadata, current/generated provenance, and strict incomplete-set exclusion;
- separate RU/UA keyword lists, 25-phrase fixture minimum, HTML limits, and current fallback/padding behavior where the legacy builder permits it;
- actual tracked short-template sheet names and header rows;
- actual workbook cell values after exporting and reopening a synthetic Prom workbook.

Subjective marketing quality is deliberately not tested. The objective is to detect accidental behavior changes, not to declare copy “good.”

## 4. Pricing implementations protected

### Root `build-prom-products.mjs`

Inputs: purchase price and optional commission rate. Current behavior applies `dropshipMarkup=1.3`, `safetyMarginPercent=5`, a fallback commission of `0.125`, additional rate components `0.07 + 0.05 + 0.03 + 0.02`, tiered multiplier/minimum profit, commercial anchors, and a hard floor.

Characterized cases include purchase prices 0, 10, 100, 249.5, 1000, `NaN`, and an explicit zero commission.

### `excel-work/apply-price-rule.mjs`

Inputs: purchase price and commission percentage from the QA row. Current behavior uses a separate tier table, delivery 105 for expected profit, 120 for worst-case reporting, minimum-profit floor, and `Math.ceil`.

Characterized cases include 40, 99.5, 230, 1200, 5200 and invalid `NaN` tier fall-through.

### Strict photo/price builder

`excel-work/build-prom-photo-price-fixed.mjs` uses `cost × 1.90 / 0.80`, a fixed 20% commission orientation, and a 5-unit step below 100 / 10-unit step from 100. Characterized cases include 40, 99.5, 230, 1000, 1250 and invalid `NaN`.

### Conflict preserved

These implementations intentionally remain separate. The tests do not normalize them and do not select a new canonical formula.

## 5. Known conflicting behavior

1. Pricing engines produce different values for the same purchase cost because they include different markups, delivery assumptions, rate components, floors, and rounding.
2. `fix-prom-identifiers.mjs` writes numeric `Код_товару`, while strict later builders write `U<code>U`; product identifier and unique ID fields have different semantics.
3. Some final photo builders accept current AI links, old Drive links, supplier links, or padded duplicates; strict builders exclude products without five current target-folder assets.
4. Google image URL forms differ (`uc?export`, `file/view`, and `lh3.googleusercontent.com`); only some flows perform remote status/MIME checks.
5. Category repair blanks `Посилання_підрозділу` while another final QA vocabulary expects explicit category data through other fields.
6. Some builders preserve a known manufacturer, while `qa-prom-ready-final.mjs` expects every manufacturer value to equal `AND`.
7. Some QA reports incomplete photo sets without failing the build; other builders throw or exclude rows.
8. The tracked short template uses a compact English-header schema, while newer builders expect expanded Ukrainian-header fields. This is characterized as an actual template fact, not resolved here.
9. Photo typography policy differs between the active prose spec and helper implementations that either generate text in the scene or add a later overlay.

## 6. Areas not yet testable

- full supplier page selection/enrichment against frozen HTML snapshots;
- exact parsing behavior for every UG-OPT and BigDrop page shape;
- live Google Drive permission behavior and Prom’s actual HTTP fetch behavior;
- AI generation output identity, composition quality, Ukrainian typography quality, and absence of hallucinated accessories;
- complete workbook parity for every dated builder and every template variant;
- end-to-end publication without touching external production resources;
- restart/recovery behavior for long-running or interrupted batches;
- performance and rate limits at thousands of products;
- Python/PowerShell image output parity across host runtimes.

These are deferred because current scripts are top-level, hardcoded, networked, or have external side effects.

## 7. External dependencies requiring isolation

| Dependency | Isolation approach now | Future test target |
|---|---|---|
| UG-OPT / BigDrop | No live call in tests; use synthetic JSON fixtures | Frozen HTML/JSON fixtures and mocked HTTP adapter |
| Google Drive | No upload/access change; synthetic IDs and URL construction only | Mocked public asset probe plus controlled integration check |
| Prom.ua | No upload; synthetic workbook only | Import-contract fixture and sandbox/manual verification |
| `@oai/artifact-tool` | Read tracked short template and create temp synthetic workbook | Versioned dependency and golden workbook suite |
| Sharp/System.Drawing/Python image stack | Metadata-only photo fixtures | Isolated renderer tests with tiny PNG fixtures |

## 8. Recommended next extraction targets

1. Extract pricing policies into pure modules while retaining all current formulas as named versions.
2. Extract identity normalization/formatting and duplicate validation.
3. Extract a header-driven Prom workbook schema adapter and golden-file checks.
4. Extract photo manifest/provenance/URL validation with strict versus fallback mode explicit.
5. Extract category/manufacturer decision services with source provenance.
6. Only after those contracts are stable, isolate supplier adapters and content generation.

If exposing a production function requires modifying the existing script, stop and document the seam instead of changing production code. The current tests deliberately use no such production modifications.

## 9. Baseline execution result

The final local run produced:

| Check | Result |
|---|---:|
| Node characterization/integration tests | 34 passed, 0 failed |
| Node syntax checks | 103 checked, 0 failed (98 production modules + 5 test modules) |
| Python syntax checks | 8 checked, 0 failed |
| PowerShell syntax checks | 3 checked, 0 failed |

Read-only existing QA smoke runs against the tracked short template also exited successfully for `qa-prom-ready-final.mjs`, `qa-public-content.mjs`, `verify-categories.mjs`, and `inspect-current-workbook.mjs`. Their output is not a readiness claim: the short template has no product rows, while fixed-range QA reported 100 blank rows for some checks. This confirms the documented fixed-range/empty-row weakness.

A failing characterization test is treated as evidence of behavior drift or an incomplete characterization—not as permission to fix production logic in this phase.
