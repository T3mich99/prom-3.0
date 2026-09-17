# Architecture Audit

**Repository:** `product-automation`
**Audit branch:** `refactor/software-engineering-v1`
**Protected baseline:** `main` / tag `vibe-baseline`
**Audit date:** 2026-09-11
**Phase:** characterization only; no production behavior changed

## 1. Executive summary

The repository is a working, AI-assisted collection of Node.js, Python, and PowerShell batch scripts for supplier scraping, product selection, Prom.ua workbook generation, pricing, content/keyword enrichment, image preparation, Google Drive mapping, and import QA. It is not yet a single pipeline with a canonical data model or a single source of truth.

The current system can produce useful deliverables, but correctness depends on choosing the right dated/batch-specific script and running a fragile sequence of repair and QA scripts. Several later “final” builders coexist with earlier builders and repair scripts. They encode different interpretations of the same business concepts:

- multiple incompatible pricing formulas and delivery assumptions;
- multiple identifier policies (`U123U`, numeric code, numeric unique ID, and product ID variants);
- multiple photo-link policies, including fallback to old or supplier images and different Google URL forms;
- multiple category and manufacturer policies;
- different levels of enforcement for five-photo completeness, HTML limits, keywords, and remote URL validity.

The largest business risk is a file that looks complete locally but is rejected by Prom.ua or has incorrect profitability/identity. The largest engineering risk is that the repository has no canonical contract that prevents a batch-specific script from silently reintroducing old photos, stale data, or contradictory identifiers.

The safest target is an explicit, staged pipeline around a normalized product snapshot and a validated export artifact. Existing scripts should remain runnable during migration; new orchestration and validators should first characterize and compare behavior, then replace one responsibility at a time.

## Scope and guardrails

This audit inspected the tracked repository rather than relying on filenames alone. It did not:

- modify or move production scripts;
- change pricing, Prom.ua behavior, photo behavior, templates, content, or generated outputs;
- touch `main` or `vibe-baseline`;
- install dependencies, add a database, or perform a rewrite.

The working tree was clean before the audit. The branch was verified as `refactor/software-engineering-v1`.

## 2. Repository inventory

### 2.1 Inventory facts

| Fact | Observed value |
|---|---:|
| Tracked files | 127 |
| JavaScript modules | 98 `.mjs` |
| Python files | 8 |
| PowerShell files | 3 |
| JSON/config/map files | 12 |
| Excel templates | 2 (`.xls`, `.xlsx`) |
| PNG template/reference assets | 2 |
| Markdown before this audit | 1 (`PHOTO-MASTER-SPEC.md`) |
| Package manifests/lockfiles | none tracked |
| Tests/test framework | none tracked |
| CI configuration | none found |
| README/operational runbook | none found |
| Environment-based application configuration | none found |

The code imports `@oai/artifact-tool`, and selected image scripts import `sharp`, but no `package.json`, lockfile, `requirements.txt`, `pyproject.toml`, or equivalent dependency contract is tracked. The current desktop/runtime environment therefore supplies part of the execution contract implicitly.

### 2.2 Domain inventory

The following table is the complete tracked-file inventory at domain level. For grouped rows, the listed files share the responsibility and I/O pattern; the detailed exceptions in section 2.3 are authoritative for the high-risk files.

| Domain | Tracked files | Inputs / outputs / external services | Source mutation | Production relevance / duplication / risk |
|---|---|---|---|---|
| Root batch entry points | `build-prom-products.mjs`; `build-prom-10-ai-photos-2026-08-24.mjs`; `build-prom-ugopt-100-2026-08-24.mjs`; `download-batch-10-sources.mjs`; `finalize-batch-10-photos.mjs` | UG-OPT HTML and images; local JSON/PNG; Prom workbook templates; `@oai/artifact-tool`; Google/remote image URLs | Writes batch JSON, images, workbooks | Production-like but batch-specific; duplicates later `excel-work` builders; high risk |
| Root diagnostics/assets | `inspect-template.mjs`; `make-source-contact-sheet.mjs`; `PHOTO-MASTER-SPEC.md`; `template-Export_Groups_Sheet.png`; `template-Export_Products_Sheet.png` | Templates, source images, photo policy | Contact sheet writes only | Diagnostic/spec/reference; photo policy is authoritative prose but not enforced centrally |
| Core workbook builders | `excel-work/build-prom-final-2026-09-01.mjs`; `excel-work/build-final-xlsx.mjs`; `excel-work/build-final-with-current-drive-photos.mjs`; `excel-work/build-prom-photo-price-fixed.mjs`; `excel-work/build-prom-v3-final.mjs`; `excel-work/build-home-misc-next-100-prom-final.mjs`; `excel-work/build-pets-prom-final.mjs` | XLSX, source JSON, manifests, Drive maps, templates; `@oai/artifact-tool` | Writes new workbooks and QA JSON | Several competing “final” implementations; highest correctness risk |
| Hair/BigDrop workbook pipeline | `scripts/build-bigdrop-hair-prom-xlsx.mjs`; `excel-work/build-hair-content-draft.mjs`; `excel-work/build-hair-photo-prompt-v2.mjs`; `excel-work/filter-hair-requested-types.mjs` | BigDrop pages, source JSON, local photo folders, Drive maps, XLSX | Writes new workbooks/prompts | Large separate pipeline; duplicates content/category/pricing/export logic; high |
| Generic content/keywords | `excel-work/enrich-prom-sales-content.mjs`; `excel-work/rewrite-content-and-categories.mjs`; `excel-work/build-next-100-content-draft.mjs`; `excel-work/build-pets-content-draft.mjs`; `excel-work/review-content.mjs`; `excel-work/scan-sales-language.mjs`; `excel-work/qa-public-content.mjs` | XLSX/source JSON; translation heuristics; content rules | Mutates or creates workbooks | Business-critical but heuristic and hardcoded; high |
| Selection and supplier ingestion | `excel-work/select-next-100-home-misc.mjs`; `excel-work/select-hair-styling-all.mjs`; `excel-work/select-next-100-hair-pending.mjs`; `excel-work/select-all-pets.mjs`; `excel-work/enrich-next-100-home-misc.mjs`; `excel-work/download-home-misc-all-source-images.mjs`; `excel-work/download-home-misc-sources.mjs`; `excel-work/download-ugopt-hair-refs.mjs`; `scripts/download-ugopt-hair-refs.mjs`; `scripts/fetch-bigdrop-hair-50-sources.ps1`; `scripts/prepare-ugopt-hair-100-premium.mjs` | UG-OPT/BigDrop pages, previous manifests, source images; local JSON/images | Writes selections, snapshots, downloads | Scrapers are partly retrying/timeout-aware and partly not; high |
| Pricing | `excel-work/apply-price-rule.mjs`; `excel-work/fetch-current-ugopt-prices.mjs`; pricing portions of all workbook builders | XLSX/source prices, hardcoded commission/delivery/tiers | Mutates price columns and QA sheets | Four incompatible formula families; critical |
| Category mapping | `excel-work/fix-prom-categories.mjs`; `excel-work/fix-35214-category.mjs`; `excel-work/inspect-target-categories.mjs`; `excel-work/rank-categories-next-100.mjs`; `excel-work/verify-categories.mjs`; `excel-work/verify-category-map.mjs`; `excel-work/verify-category-map-dynamic.mjs`; `excel-work/dump-product-cats.mjs`; `excel-work/dump-groups.mjs` | XLSX, category JSON, product/group data | Mutates category/group columns in workbooks | Mapping is split between source tokens, hardcoded maps, and external JSON; high |
| Identifiers and mandatory fields | `excel-work/fix-prom-identifiers.mjs`; `excel-work/fix-prom-unique-id-numeric.mjs`; `excel-work/fix-product-code-u-format.mjs`; `excel-work/set-unknown-manufacturer-and.mjs`; `excel-work/finalize-prom-photos-and-required-chars.mjs` | XLSX rows and source codes | Mutates workbooks in place or writes repaired copies | Sequential repairs can undo one another; critical |
| Photo preparation and mapping | `excel-work/prepare-hair-photo-prompts.mjs`; `excel-work/prepare-next-100-photo-prompts.mjs`; `excel-work/prepare-pets-photo-prompts.mjs`; `excel-work/prepare-ugopt-hair-100-premium.mjs`; `excel-work/resize-images-1280.mjs`; `excel-work/normalize-pets-image.mjs`; `excel-work/save-generated-image.mjs`; `excel-work/compare-photo-only-workbook.mjs`; `excel-work/remove-old-photo-links.mjs`; `excel-work/remove-temporary-products.mjs`; `excel-work/trim-products-without-new-photos.mjs`; `excel-work/export-prom-drive-1ON-only.mjs`; `excel-work/export-prom-new-photos-final.mjs`; `excel-work/make-drive-main-contact-sheets.mjs` | Prompt JSON, local PNG/JPG, Drive maps, XLSX | Writes/copies/normalizes images and links; some mutate workbook | Photo source and URL policies diverge; high |
| Photo generation/legacy image utilities | `scripts/build-product-photo-series.mjs`; `scripts/build-product-photo-series.ps1`; `scripts/make-hair-reference-style-v3.mjs`; `scripts/make-premium-hair-style-v2.mjs`; `scripts/normalize-product-images.mjs`; `scripts/normalize-product-images.ps1`; `scripts/overlay-ukrainian-photo-text.mjs`; `scripts/apply_bigdrop_hair_ua_text.py`; `scripts/apply_ua_photo_text.py`; `scripts/compose-product-card.py` and `excel-work/compose-product-card.py`; `excel-work/compose-product-card-v2.py`; `excel-work/compose-product-card-v3.py`; `excel-work/compose-product-card-v4.py`; `excel-work/compose-hair-card.py`; `excel-work/compose-hair-11080-v2.py` | Local image files; Sharp/System.Drawing/Pillow-like Python tooling; Windows fonts | In-place normalization/overlay possible | Dead legacy generator plus multiple compositors; high |
| QA and validation | `excel-work/qa-final-prom-export.mjs`; `excel-work/qa-final-targeted.mjs`; `excel-work/qa-prom-ready-final.mjs`; `excel-work/qa-drive-1ON-only.mjs`; `excel-work/qa-pets-photos.mjs`; `excel-work/qa-photo-source-final.mjs`; `excel-work/qa-trimmed-final.mjs`; `excel-work/verify-photo-urls.mjs`; `excel-work/verify-categories.mjs`; `excel-work/verify-category-map.mjs`; `excel-work/verify-category-map-dynamic.mjs` | XLSX, URLs, manifests, category maps | Mostly reports; some throw, some only write QA | No shared validator contract; some important checks are report-only or incomplete |
| Inspection/diagnostics | `excel-work/inspect-cells.mjs`; `inspect-content-sample.mjs`; `inspect-current-headers.mjs`; `inspect-current-workbook.mjs`; `inspect-excel.mjs`; `inspect-groups.mjs`; `inspect-hair-groups.mjs`; `inspect-hair-template-products.mjs`; `inspect-header-map.mjs`; `inspect-keywords.mjs`; `inspect-pets-final.mjs`; `inspect-photo-urls.mjs`; `inspect-product-row.mjs`; `inspect-range.mjs`; `inspect-sheet-shapes.mjs`; `list-sales-products.mjs`; `search-workbook.mjs`; `dump-product-overview.mjs`; `dump-titles.mjs`; `extract-attached-prom-index.mjs`; `render-sales-char-preview.mjs` | XLSX/JSON inspection, console reports, previews | Read-only except generated previews | Useful diagnostics but not reusable library code; low/medium |
| Configuration and maps | `excel-work/config-35078.json`; `config-35082.json`; `config-35345.json`; `config-35365.json`; `config-35503-v2.json`; `config-35503-v3.json`; `config-35503-v4.json`; `config-51852-v3.json`; `config-51852-v4.json`; `current-drive-map.json`; `drive-map-1ON.json`; `drive-map-v2.json` | Product-specific JSON, Drive metadata | Data files are read; maps may be generated externally | No schema/version registry; stale maps are easy to select accidentally |
| Templates | `prom-import-full-template.xls`; `prom-import-short-template.xlsx` | Prom import structure | Used as copy/shape source | External contract; must be protected by golden-file tests |
| Repository policy | `.gitignore` | Ignore rules for secrets, outputs, caches, node modules, temporary Office files | No | Good baseline intent, but generated outputs are untracked and not reproducible from Git alone |

### 2.3 High-risk file inventory

| File | Actual responsibility and key I/O | External/dependency assumptions | Mutation / status | Risk |
|---|---|---|---|---|
| `build-prom-products.mjs` | Scrapes one hardcoded UG-OPT search URL, parses products, applies pricing/content, writes a workbook | Fetch; `@oai/artifact-tool`; absolute workspace paths | New output; refrigerator-mat-specific content is hardcoded for every product | Critical |
| `build-prom-10-ai-photos-2026-08-24.mjs` | Builds a fixed ten-SKU AI-photo workbook from manual mappings | Local manifests/maps; `@oai/artifact-tool`; Drive view links | New output; fixed codes/categories/content | High |
| `build-prom-ugopt-100-2026-08-24.mjs` | Selects 100 UG-OPT products and maps category/price/content/photos | Source data, category commission map, templates | New workbook; fixed batch assumptions | Critical |
| `excel-work/build-prom-final-2026-09-01.mjs` | Rebuilds final workbook and keywords from source/manifest/Drive maps | Current and old Drive maps; `uc?export=view` links | New workbook; explicitly falls back to old/supplier images and pads links | Critical |
| `excel-work/build-final-xlsx.mjs` | Creates a final workbook from staging data and a Drive map | `@oai/artifact-tool`; source image fallback | New workbook; QA contains a no-op conditional and does not reject supplier fallback links | Critical |
| `excel-work/build-final-with-current-drive-photos.mjs` | Adds current Drive photos where available and source fallback otherwise | Drive `download` links; source JSON | New workbook; `fiveAiPhotos` is reported, not required | High |
| `excel-work/build-prom-photo-price-fixed.mjs` | Strict five-photo/price rebuild using target Drive map and direct Google image endpoint | Current UG-OPT prices; target Drive IDs; `lh3.googleusercontent.com` | Excludes incomplete rows; fresh workbook | High, but closest to a strict gate |
| `excel-work/build-prom-v3-final.mjs` | Strict home-misc final with target-folder photos, categories, IDs, manufacturer fallback, keywords and HTML QA | Hardcoded enriched JSON and target folder ID | Fresh two-sheet workbook; throws on many checks | High; still batch-specific |
| `excel-work/build-home-misc-next-100-prom-final.mjs` | Similar strict home-misc exporter | Hardcoded batch and Drive folder | Fresh workbook; requires five mapped photos | High |
| `excel-work/build-pets-prom-final.mjs` | Strict pets exporter and QA | Target Drive IDs; `@oai/artifact-tool` | Fresh workbook | Critical defect: includes `Ідентифікатор_товару` in a numeric-ID check while that field is written in `U...U` format, so the QA contract conflicts with its own row construction |
| `excel-work/enrich-prom-sales-content.mjs` | Generalized title/description/HTML/keyword/characteristic enrichment | XLSX/source JSON; large embedded translation/rule tables | Rewrites workbooks; converts nonnumeric source identifiers to surrogates | High; heuristic content and ID policy are coupled |
| `excel-work/apply-price-rule.mjs` | Applies tiered pricing to an existing workbook and Pricing QA sheet | Hardcoded delivery 105/120 and tier rules | Mutates price/QA cells | Critical; conflicts with 20%/90%-of-cost engines |
| `excel-work/fix-prom-identifiers.mjs` | Repairs product code and identifiers | XLSX, fixed columns/ranges | Mutates/rewrites code fields | Critical; writes numeric `Код_товару`, conflicting with the later U-wrapped policy |
| `excel-work/fix-product-code-u-format.mjs` | Restores `U...U` code/product ID format | XLSX | Mutates/rewrites fields | Critical; demonstrates order-dependent repairs |
| `excel-work/fix-prom-unique-id-numeric.mjs` | Writes numeric unique IDs into a fixed 100-row range | XLSX coordinates `A2:A101`/fixed columns | In-place workbook mutation | High; assumes exact row count and can be run on wrong workbook |
| `excel-work/fix-prom-categories.mjs` | Applies category/group mapping from an external JSON map | Hardcoded path to category JSON; XLSX | Mutates group/category fields | High; category link semantics differ from final builders |
| `scripts/build-product-photo-series.mjs` | Disabled legacy generator; code after top-level throw remains | Hardcoded runtime/Sharp in unreachable implementation | No current execution; dead code retained | Medium/high maintenance hazard |
| `scripts/build-product-photo-series.ps1` | Disabled legacy PowerShell generator with dead implementation below throw | Windows runtime paths | No current execution | Medium/high |
| `scripts/normalize-product-images.mjs` | Forces all images to 1280×1280 | Hardcoded `sharp` runtime path | In-place replacement through temp PNG + rename | High; `fit: 'fill'` can distort product geometry |
| `scripts/overlay-ukrainian-photo-text.mjs` | Adds text onto an existing image | Image library/runtime | Writes derived image | Medium; implementation conflicts with later “text integrated into scene” reference policy |
| `scripts/build-bigdrop-hair-prom-xlsx.mjs` | Scrapes/enriches BigDrop hair products and builds a 50-row Prom workbook | BigDrop pages; local photo folders; Drive map; `@oai/artifact-tool` | Fresh workbook | Critical; QA reports missing photos but does not fail on incomplete five-photo coverage |
| `excel-work/verify-photo-urls.mjs` | Performs Range fetch and status/MIME checks for URLs | Network | Read-only | Useful but not automatically attached to every export gate; does not prove Drive permissions or file identity |

## 3. Current architecture

### 3.1 Architectural shape

The current shape is a set of batch scripts connected by filenames, hardcoded paths, Excel tabs/cells, local directories, and manually selected maps. There is no long-running service or orchestrator. The real “state store” is distributed across:

- source HTML and downloaded image files;
- JSON/JSONL selection and enrichment artifacts;
- dated output directories;
- Drive map JSON files;
- staged and final Excel files;
- QA JSON/QA sheets;
- naming conventions such as batch/date/SKU/folder role.

The closest thing to an architecture boundary is the Prom workbook schema and the `PHOTO-MASTER-SPEC.md` document. Both are consumed procedurally by many scripts rather than enforced through a shared library.

### 3.2 External boundaries

| Boundary | Current adapter | Contract quality |
|---|---|---|
| UG-OPT | Direct `fetch` plus HTML/JSON-LD/regex parsers | Fragile; URLs and parsing rules embedded in scripts |
| BigDrop | Direct `fetch` plus page/breadcrumb/characteristic parsing | Batch-specific and heuristic |
| Google Drive | Drive IDs from JSON maps, rendered as several public URL forms | No centralized URL policy or permission probe |
| Prom.ua | Excel template and header names; no API integration | External file contract validated inconsistently |
| Image processing | `sharp`, System.Drawing, and Python utilities | Runtime-dependent; multiple composition policies |
| Workbook engine | `@oai/artifact-tool` | Implicit dependency; no tracked version contract |

### 3.3 Current entry points

The effective entry points are not one command but families of scripts:

1. root dated batch builders for earlier batches;
2. `excel-work/build-*.mjs` final/draft exporters;
3. `scripts/build-bigdrop-hair-prom-xlsx.mjs` for the hair/BigDrop pipeline;
4. selection/enrichment scripts that create source snapshots;
5. repair scripts that are often run after a workbook is built;
6. QA/inspection scripts that may or may not be hard gates.

No manifest declares which entry point is current. “Final” is encoded in filenames and dates, not in a versioned workflow definition.

## 4. Current workflows and data flow

The actual workflows are described in detail in [`CURRENT_WORKFLOWS.md`](CURRENT_WORKFLOWS.md). At a high level, the repository contains these overlapping flows:

```text
UG-OPT / BigDrop pages
        │
        ├── selection scripts ──> selected JSON / prior-batch exclusion
        │
        ├── enrichment scripts ─> source snapshots with price, attrs, images, category
        │
        ├── prompt/photo scripts ─> local PNGs / AI manifests / Drive maps
        │
        ├── content/keyword scripts ─> draft or enriched workbook
        │
        ├── pricing scripts ─> rewritten price and QA columns
        │
        ├── category/ID/manufacturer repairs ─> in-place or new workbook
        │
        ├── final builders ─> Prom workbook + optional QA sheet/JSON
        │
        └── independent QA/URL checks ─> report or throw
```

The arrows are not a guaranteed order. Several final builders independently repeat earlier work, and some repair scripts can be run in different orders with different results.

## 5. Dependency map

### 5.1 Logical dependency map

| Consumer | Depends on | Hidden assumption |
|---|---|---|
| Final workbook builders | A particular source JSON shape, template headers, manifest key convention, Drive map naming convention | The chosen batch artifacts are from the same run and same product set |
| Photo link builders | Drive map keys such as `code_role.png` and a selected URL form | File is public and the URL returns an image to Prom |
| Price builders | `purchasePrice`, hardcoded commission/delivery/tiers | The formula matches current business policy |
| Content builders | Source title/attrs and heuristic category family | Missing attributes can be safely inferred or omitted |
| Category repair scripts | External category JSON and workbook fields | Category ID/name/link semantics are interchangeable |
| Identifier repair scripts | Fixed columns/ranges and prior code format | The workbook has exactly the expected row count and has not already been repaired |
| QA scripts | Positional columns or a particular sheet name | The workbook shape is the expected dated variant |

### 5.2 Runtime/dependency observations

- Node built-ins (`node:fs/promises`, `node:path`, `node:url`) are pervasive.
- `@oai/artifact-tool` is the dominant workbook dependency but is not declared in a tracked manifest.
- `sharp` is used by some image tools; two scripts dynamically import it from an absolute Codex runtime path.
- Python image/composition scripts depend on the host Python environment and Windows font paths.
- Network access is direct from scripts; there is no shared HTTP client, retry policy, cache, rate limiter, or response schema layer.

## 6. Duplication clusters

| Cluster | Files involved | Differences observed | Consolidation risk | Future canonical module |
|---|---|---|---|---|
| Workbook reading/writing | All `build-*.mjs`, `enrich-prom-sales-content.mjs`, repair and QA scripts | Different header lookup, fixed ranges, sheet assumptions, template handling, and artifact-tool calls | High: changing column behavior can alter imports | `workbook-adapter` + schema-aware row model |
| Pricing | `build-prom-products.mjs`, `build-prom-10-ai-photos...`, `apply-price-rule.mjs`, `build-prom-photo-price-fixed.mjs`, BigDrop builder, other final builders | 1.3 dropship markup/safety; delivery 105/120; 20% commission/90% target; tiered margins; different rounding | Critical: silent profitability change | Versioned `pricing-policy` with explicit inputs and decision trace |
| Prom identifiers | `build-prom-10-ai-photos...`, `fix-prom-identifiers.mjs`, `fix-prom-unique-id-numeric.mjs`, `fix-product-code-u-format.mjs`, v3/pets/BigDrop builders | `Код_товару` numeric vs `U...U`; unique ID numeric; product ID U-wrapped; fixed-range repairs | Critical: Prom rejection or duplicate identity | `identity-policy` and typed identifier validator |
| Categories | Root builders, `fix-prom-categories.mjs`, home/pets/v3 builders, category QA | Source-derived, hardcoded, external map, null category link, different family heuristics | High: wrong category or auto-classification | `category-catalog` + explicit assignment provenance |
| Manufacturer fallback | v3/home/pets/BigDrop builders, `set-unknown-manufacturer-and.mjs`, `qa-prom-ready-final.mjs` | Preserve known value vs force `AND`; QA may require all values `AND` | High: loss of source fact or required-field failure | `attribute-policy` with “known/unknown/fallback” state |
| Photo links | `build-prom-final...`, `build-final-xlsx`, current-drive, v3/home/pets/price-fixed, Drive exporters | Old/supplier fallback and padding vs strict five new photos; `uc`/`file/view`/`lh3` URLs | Critical: stale images and HTTP 400 | `asset-manifest` + one Prom URL adapter + network gate |
| Photo composition | Legacy series generators, Python compositors, overlay tools, hair styles, prompt scripts | Text overlay vs prompt text, role definitions, people/hands, aspect fitting | High: product distortion or wrong visual policy | `photo-spec` validator and role-specific renderer/generator adapter |
| Content/keywords | `enrich-prom-sales-content.mjs`, group builders, hair/pets/home drafts, root builders | Translation tables, group templates, minimum 25/1024 rules, language handling | High: misleading copy or import rejection | `content-policy` and language-specific generators |
| Selection/exclusion | All `select-*` scripts and prior-manifest scans | Different categories, prior paths, counts, duplicate keys and exclusion sources | Medium/high: repeated or omitted products | `catalog-selection` with persistent run manifest |
| QA | `qa-*`, `verify-*`, builder-internal QA | Some throw; some report only; fixed coordinates; no shared issue schema | High: false confidence | `validation-core` with severity and hard/soft gates |
| Paths/maps/config | Most dated builders and maps | Absolute Windows paths, dated filenames, hardcoded IDs and folders | Medium/high: nonportable or stale execution | `run-config` + run-scoped artifact manifest |

## 7. Business rules

The authoritative rule inventory, with source file/function/location, is in [`BUSINESS_RULES.md`](BUSINESS_RULES.md). The most important discovered rules are:

- retail-only rows leave wholesale price/minimum fields blank in several later builders;
- supplier/product code and Prom identifiers have multiple competing formats, with later strict builders generally using `U<source-code>U` for product code/product ID and a numeric unique ID;
- unknown manufacturer is commonly filled as `AND`, but one QA script requires `AND` for every row, which conflicts with preserving known manufacturers;
- later strict builders require five target Drive photos, while earlier builders can fall back to old/supplier URLs or repeat the last link;
- keyword fields are expected to contain at least 25 phrases in RU and UA and stay within 1024 characters in the stricter content flows;
- HTML description limits of 250 RU and 270 UA are enforced by some final builders;
- the photo specification requires five 1280×1280 PNG roles, with four commercial/textual roles and one detail role, but implementation policies disagree on whether text is generated into the image or overlaid later;
- pricing is not one rule: the repository contains distinct historical/batch formula families.

## 8. Hardcoded dependencies

The repository contains approximately:

- `C:/Users` references in 23 tracked code/config files;
- `C:\Users` references in 9 tracked files;
- `ug-opt.in.ua` in 7 files and `big-drop.in.ua` in 1 file;
- Drive URL forms in at least 7 tracked code/config files and direct `lh3.googleusercontent.com` forms in at least 9 code files;
- hardcoded product/category/batch paths, Drive folder IDs, category IDs, commission percentages, delivery values, row counts, timeout/retry values, output filenames, Windows font paths, and runtime dependency paths.

Notable examples include a hardcoded refrigerator-mat search/category in `build-prom-products.mjs`, hardcoded selected SKU lists in dated builders, hardcoded target Drive folder IDs in home/pets/final scripts, `A2:A101`/`A2:DD101`-style fixed ranges, and an absolute `sharp` runtime import.

`.gitignore` intentionally excludes `.env`, credentials, key/certificate extensions, generated outputs, caches, and node modules. That is useful hygiene, but because generated outputs are ignored, a result cannot be reconstructed from Git without the local run artifacts and external Drive state.

## 9. Security findings

### Findings

1. **No obvious embedded secrets found in tracked files.** A search for common key/token/password/credential patterns did not return a secret value. Drive IDs and public image URLs are present; they are identifiers/asset locations, not treated here as credentials.
2. **Personal absolute paths and external asset identifiers are embedded.** Severity: Medium. This leaks local directory structure into code and makes the system nonportable; Drive IDs can also expose intended asset locations if the files are public. Remediation: move paths and asset references into run-scoped configuration and redact sensitive path/URL values from logs.
3. **No explicit secret-management boundary exists.** Severity: Medium. The absence of discovered secrets is not the same as a safe credential flow; there is no documented way to inject credentials, rotate them, or prevent accidental logging. Remediation: document environment/credential providers, add secret scanning, and keep credentials outside workbooks/manifests.
4. **Remote content is consumed without a centralized trust/size policy.** Severity: Medium. Supplier pages and Drive assets can change or return unexpected content. Remediation: validate status, MIME, size, image dimensions, and source identity before accepting an asset.

No secret values are printed in this report.

## 10. Reliability risks

| Risk | Evidence | Impact |
|---|---|---|
| Partial/incorrect photo set accepted | Several builders fall back to old/supplier images or pad five links; some QA only reports photo counts | Stale or rejected Prom listings |
| Remote URL form mismatch | `drive.google.com/uc?export=view`, `uc?export=download`, `file/.../view`, and `lh3.googleusercontent.com` are all used | HTTP 400 or inaccessible photos |
| No universal network gate | `verify-photo-urls.mjs` exists but is not a mandatory final step for every builder; many builders do not check MIME/permissions | Local workbook appears valid while Prom rejects URLs |
| Whole-batch failure on one bad supplier row | Enrichment throws when a source row lacks title/price/images | Lost progress and manual reruns |
| HTML/keyword/field QA is inconsistent | Some builders enforce limits; others report or use fixed/positional fields | Import failures or silent truncation |
| Order-dependent repair scripts | Identifier/category/manufacturer repairs rewrite the same workbook fields with conflicting policies | A later repair can undo a previous valid state |
| Fixed row/column assumptions | Fixed ranges such as 100-row imports and positional column access | Wrong rows modified, skipped products, or corrupted exports |
| Duplicate execution is not modeled | Batch/date/output names and local folders carry run state; no run ID/lock/checkpoint | Duplicate products/assets and accidental overwrites |
| Fragile scraping | Regex/HTML parsing and heuristic selectors are embedded in scripts | Supplier markup changes can produce bad data without a clear contract failure |
| Image distortion | `fit: 'fill'` in normalization | Product shape/identity can be altered |
| Dead legacy implementation remains | Photo generators throw at top level but retain unreachable logic | Operators may select wrong tool; maintenance ambiguity |
| Dependency drift | No package manifest or lockfile; absolute runtime imports | “Works on this workstation” behavior and non-reproducible builds |
| No atomic workbook publication contract | Builders write final artifacts through separate scripts; no staging/publish/rollback protocol | Interrupted runs can leave a plausible but incomplete file |

### Idempotence assessment

- **Mostly deterministic:** pure-ish title/keyword/price helper functions when given identical inputs; image normalization of an existing file is intended to be repeatable but may change metadata; fresh workbook generation for a fixed input set.
- **Conditionally idempotent:** selection with prior-manifest exclusion, category/identifier repair, and Drive-map-based export; behavior depends on which previous artifacts are present.
- **Not safely idempotent:** workflows that mix current/old/supplier fallback, overwrite workbooks in place, rely on generated file names, or read mutable remote pages/Drive permissions without snapshotting.

## 11. Data model

The implicit entities and current representations are documented in more detail in [`CURRENT_WORKFLOWS.md`](CURRENT_WORKFLOWS.md). Summary:

| Entity | Important fields | Current representations | Writers | Canonical today? |
|---|---|---|---|---|
| Supplier product | source URL, source code/SKU, title, price, availability, attributes, source images, source category | Scraped JSON, selected/enriched JSON, temporary in-memory objects | Selection/enrichment/scrapers | No |
| Selection/run | batch/category, selected product IDs, excluded prior IDs, source artifact paths | JSON manifests and filenames | `select-*`, dated builders | No |
| Category assignment | Prom category/group ID, name, link, provenance | Workbook columns, category JSON/maps, heuristics | Builders and category repair scripts | No |
| Price decision | purchase cost, commission, delivery assumption, target/min profit, rounding, final price | Workbook cells, Pricing QA, notes strings | Multiple builders and `apply-price-rule` | No |
| Content bundle | RU/UA titles, descriptions, HTML, keywords, characteristics | Workbook columns, content drafts, hardcoded maps | Enrichment/group builders | No |
| Photo asset | product key, role, local path, Drive ID, URL, dimensions, MIME, generation/source date | PNG folders, Drive maps, workbook links | Photo/export scripts | No |
| Prom product | all import headers, identifiers, category, price, content, photo links | `Export Products Sheet` in template-derived/fresh XLSX | Final builders/repairs | Workbook row is de facto record |
| Group/category row | group number/name/link/ID | `Export Groups Sheet` | Builders/category scripts | Excel-only |
| QA issue/report | code, field, rule, severity, value, artifact/run | QA sheet, JSON, console output | QA scripts/builders | No shared issue schema |

The absence of a canonical representation is the root cause of many cross-batch inconsistencies: each script reconstructs a “product” from whichever artifact it receives.

## 12. Testability

### Already testable with extraction or direct unit tests

- code normalization and identifier formatting;
- retail-only field policy;
- manufacturer fallback policy;
- category family classification and explicit mapping;
- keyword phrase count/length/language/banned-token checks;
- HTML length checks;
- each pricing formula as a named historical policy;
- five-role photo manifest completeness and filename contract;
- Drive URL construction and allowed URL policy;
- row-to-column schema mapping.

### Tightly coupled today

- network scraping and HTML parsing;
- workbook manipulation through `@oai/artifact-tool` and positional columns;
- image composition and Windows font/runtime paths;
- Drive map discovery and public URL validation;
- end-to-end selection because it scans many hardcoded historical paths;
- content generation because source facts, translation heuristics, and workbook writes are combined.

### Tests required first

1. Prom schema/golden import tests, including all required headers and template preservation.
2. Identifier tests covering `Код_товару`, `Унікальний_ідентифікатор`, `Ідентифікатор_товару`, uniqueness, and exact accepted formats.
3. Pricing characterization tests for every formula family before selecting a canonical policy.
4. Photo manifest tests that fail on fallback, duplicate links, wrong role, wrong dimensions, wrong MIME, or unvalidated Drive URL.
5. Category/manufacturer tests with known, unknown, and contradictory source attributes.
6. Keyword/HTML language and length tests.
7. Full fixture-based export test with a small supplier snapshot and a known workbook template.

## 13. Technical debt ranked

### Critical

- No canonical pipeline or data model; batch-specific scripts are competing sources of truth.
- Conflicting pricing formulas can materially change profitability.
- Conflicting identifier repair/build policies can produce Prom rejection or duplicate identity.
- Photo fallback/padding can export old or supplier images while QA says five links exist.
- Category and mandatory-field rules are inconsistent across builders and repair scripts.
- No reliable final import gate that combines workbook schema, remote image reachability, and semantic rules.
- `build-pets-prom-final.mjs` has a self-contradictory numeric-ID QA check.

### High

- Absolute workstation paths and hardcoded batch/Drive/category IDs.
- No dependency manifest/lockfile, tests, CI, or runbook.
- Fixed row ranges and positional assumptions.
- Multiple content/keyword engines with heuristic translations and group templates.
- Whole-batch failure on incomplete supplier data.
- Image normalization can use `fit: 'fill'`; legacy photo generators are disabled but retained.
- QA varies between throw/report/no-op and is not represented by a common issue model.

### Medium

- Dated filenames encode workflow state.
- Generated outputs are ignored and not linked to reproducible run metadata.
- Diagnostics are standalone scripts rather than reusable library functions.
- Scraper retries/timeouts are uneven.
- Drive IDs/maps are JSON files with no schema/version validation.

### Low

- Naming and language conventions vary among scripts.
- Documentation previously consisted mainly of the photo specification, with no architecture or operations overview.
- Several small inspection scripts could share utilities after behavior is characterized.

## 14. Proposed target architecture

The proposed target is described in [`TARGET_ARCHITECTURE.md`](TARGET_ARCHITECTURE.md). It keeps the current Node-centric approach, introduces explicit domain contracts, and treats external pages, Drive assets, and Prom workbooks as adapters—not as implicit state stores.

```text
run config + policy versions
              │
source adapters ──> immutable source snapshot ──> selection/run manifest
              │                                      │
              ├──────────────> normalized Product ───┼──> content decision
              │                                      ├──> pricing decision
              │                                      ├──> category/identity decision
              │                                      └──> photo asset manifest
              │
              └──> validators ──> validated export model ──> Prom XLSX publisher
                                      │
                                      └──> QA report + run manifest + rollback-safe artifact
```

The target must preserve the exact current behavior until characterization tests establish what should change. Architecture is not permission to silently choose one conflicting business rule.

## 15. Migration sequence

The incremental plan is in [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md). The first safe implementation stage after this audit is characterization: freeze representative inputs/outputs, add read-only inventory/run manifests, and write tests around the current contracts. No production builder should be replaced before parity is measured.

## 16. Things that MUST NOT be changed until tests exist

- pricing formula, commission, delivery assumptions, rounding, or profit floor;
- `Код_товару`, `Унікальний_ідентифікатор`, and `Ідентифікатор_товару` semantics;
- category IDs, category links, group numbers, or manufacturer fallback behavior;
- retail-only blank wholesale fields;
- Prom template headers, sheet names, column order, and cell types;
- photo role names, dimensions, source identity, Drive URL form, or fallback policy;
- RU/UA keyword rules and HTML limits;
- supplier scraping selectors and product-selection exclusion rules;
- workbook repair order and in-place mutation behavior.

## Evidence and verification

Evidence was gathered from `git ls-files`, source inspection, import/path searches, and the repository’s own QA/diagnostic scripts. Before documentation, `git status --short` and `git diff --stat` were empty. Final status is reported in the completion message after the documentation-only changes.
