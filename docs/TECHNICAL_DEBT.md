# Technical Debt Register

This register ranks debt by the probability and cost of producing an incorrect listing, rejected Prom.ua import, unrecoverable run, or non-reproducible result.

## Critical

### TD-C01 — No canonical pipeline or source of truth

- **Evidence:** multiple root and `excel-work` final builders, separate repair scripts, date/batch-specific paths, no orchestrator or run manifest.
- **Impact:** the same product can be rebuilt with different prices, photos, categories, IDs, and text depending on script choice/order.
- **Containment now:** record the exact entry point and every input artifact for each run; do not call a workbook “final” without its QA report.
- **Remediation:** introduce a run-scoped manifest and normalized product contract; keep existing builders as legacy adapters until parity is measured.

### TD-C02 — Conflicting pricing engines

- **Evidence:** dropship markup/safety formula in `build-prom-products.mjs`; delivery/tier logic in `apply-price-rule.mjs` and the dated ten-photo builder; 20%/90%-of-cost formula in strict later builders.
- **Impact:** margin can be below target or price can be noncompetitive; changing one script does not change the others.
- **Containment now:** label every export with pricing policy/version and retain purchase, commission, delivery, target profit, unrounded price, and final price in QA.
- **Remediation:** extract a pure versioned pricing service and fixture-test each historical formula before selecting the canonical policy.

### TD-C03 — Conflicting identifier semantics

- **Evidence:** `fix-prom-identifiers.mjs` writes numeric `Код_товару`; `fix-product-code-u-format.mjs` restores `U...U`; strict builders write numeric unique ID and U-wrapped product ID.
- **Impact:** Prom rejects files, updates target the wrong item, or duplicate IDs are created.
- **Containment now:** run one identifier QA script against the exact export and do not chain repairs without inspecting the post-step workbook.
- **Remediation:** define a typed identity object and one schema-aware writer; make legacy repair scripts read-only or retire them only after parity tests.

### TD-C04 — Photo fallback and duplicate-link leakage

- **Evidence:** `build-prom-final-2026-09-01.mjs` intentionally checks current, current-fallback, old map, supplier URL, then pads links; current-drive/final XLSX variants also fall back to source images.
- **Impact:** old photos reappear, assets do not match the product, or Prom sees five repeated/invalid URLs.
- **Containment now:** strict mode must fail if any photo is fallback, duplicate, missing, wrong role, or not from the target map; run remote status/MIME checks.
- **Remediation:** represent each asset with provenance and validation status; make fallback an explicit opt-in mode, never an implicit builder default.

### TD-C05 — No universal publication gate

- **Evidence:** QA behavior varies; some builders report instead of throw; some only check URL regex; `build-final-xlsx.mjs` has a no-op conditional; BigDrop QA does not fail on incomplete five-photo coverage.
- **Impact:** a workbook can be delivered as ready while violating a hard import or photo requirement.
- **Containment now:** manually require schema, semantic, asset, and remote URL reports to all pass before publishing.
- **Remediation:** central validator with hard/soft severities and an atomic publish command.

### TD-C06 — Category and mandatory-field policy split

- **Evidence:** source category tokens, hardcoded maps, external category JSON, category repair scripts, and different category-link expectations; manufacturer policies also conflict.
- **Impact:** automatic category assignment, missing required characteristics, or import errors.
- **Containment now:** require explicit category provenance and a required-field checklist per category.
- **Remediation:** versioned category catalog and attribute policy, with one export adapter.

## High

### TD-H01 — Hardcoded workstation paths and IDs

- **Evidence:** absolute `C:/Users/...` and `C:\Users\...` paths, fixed Drive folder IDs, supplier URLs, batch filenames, Windows font/runtime paths.
- **Impact:** nonportable runs, stale artifact selection, accidental use of another batch, sensitive local path leakage.
- **Remediation:** run config with validated roots, relative artifact references, and explicit external resource IDs; retain compatibility shims during migration.

### TD-H02 — No dependency contract

- **Evidence:** no package manifest/lockfile; `sharp` imported from an absolute Codex runtime path; Python scripts assume host libraries/fonts.
- **Impact:** behavior cannot be reproduced on another host or after runtime upgrades.
- **Remediation:** document current runtime first, then add a minimal manifest/lockfile and smoke test; do not change dependency versions during behavior migration.

### TD-H03 — Fixed ranges and positional workbook assumptions

- **Evidence:** fixed `A2:A101`, `A2:DD101`, 50/89/100-row assumptions and direct positional fields in builders/QA.
- **Impact:** wrong row edits, skipped products, failures when Prom template changes, silent data loss.
- **Remediation:** header-driven schema adapter with row identity and explicit count validation.

### TD-H04 — Heuristic scraper and content logic

- **Evidence:** HTML regex/JSON-LD parsing and large embedded translation/category tables across scripts.
- **Impact:** supplier markup or wording changes produce plausible but wrong titles, attributes, categories, or prices.
- **Remediation:** source adapter, parser fixtures, provenance per attribute, and “unknown” state rather than inference by default.

### TD-H05 — Photo pipeline policy divergence and dead code

- **Evidence:** disabled legacy generators retain unreachable implementation; Python compositors, overlays, prompt scripts, and multiple style helpers coexist; `fit: 'fill'` can distort images.
- **Impact:** operators select the wrong generator; assets violate current role/text/identity expectations.
- **Remediation:** one photo contract/manifest and role validator; quarantine legacy code only after a documented replacement and parity tests.

### TD-H06 — Whole-batch failure on incomplete source data

- **Evidence:** enrichment throws for any missing title/price/images/source error.
- **Impact:** one bad supplier page discards otherwise valid progress; reruns may select different remote data.
- **Remediation:** row-level status with retryable/permanent errors, immutable source snapshot, and explicit exclusion report.

### TD-H07 — No atomic staging/publish/rollback

- **Evidence:** separate scripts write workbooks/maps/images; no run transaction or publication marker.
- **Impact:** interrupted jobs leave plausible partial artifacts; later scripts can consume them.
- **Remediation:** stage under run ID, validate complete manifest, publish by atomic rename/copy, retain prior artifact for rollback.

## Medium

### TD-M01 — Dated filenames encode workflow state

Different dates and names imply precedence but are not machine-readable. Add `run.json` with input hashes, policy versions, entry point, and status.

### TD-M02 — Ignored generated outputs are not reproducible

`.gitignore` correctly excludes outputs and product photos, but a Git checkout lacks the exact local artifacts needed to understand a delivered workbook. Store small manifests/checksums and QA reports where policy permits; keep large assets external with immutable IDs.

### TD-M03 — Drive maps have no schema/version validation

Maps are JSON/JSONL-like data keyed by naming convention. Validate product key, role, Drive ID, source folder, MIME/dimensions, and public fetch status before export.

### TD-M04 — Uneven timeout/retry/cache policy

Some newer fetchers use `AbortSignal.timeout(45000)` and retries; other code calls `fetch` directly. Add a shared bounded client with exponential backoff, rate limiting, response-size limits, and cache keys.

### TD-M05 — QA reports are not a common issue model

Console strings, QA sheets, JSON reports, and thrown errors cannot be aggregated consistently. Introduce `{runId, productKey, field, rule, severity, observed, expected}`.

## Low

### TD-L01 — Standalone diagnostics duplicate workbook helpers

Inspection scripts are useful but each implements its own file/header/range handling. Extract read-only utilities only after behavior is characterized.

### TD-L02 — Naming and language conventions vary

Mixed Russian/Ukrainian field handling, dated filenames, and inconsistent terms increase operator error. Normalize documentation and module naming after the contracts are stable.

## Debt retirement order

1. Characterize IDs, prices, photo provenance/URL reachability, categories, and workbook schema.
2. Add run manifests and shared validators without changing outputs.
3. Add configuration/path abstraction and dependency documentation.
4. Consolidate one duplication cluster at a time with parity fixtures.
5. Only then retire or quarantine obsolete builders/repair scripts.
