# Business Rules Discovered

This document separates business intent from implementation detail. When rules conflict, the conflict is recorded rather than resolved by this audit. A future migration must choose a versioned policy with tests before replacing current behavior.

## 1. Rule register

| ID | Source file / function or location | Rule as implemented or specified | Dependencies | Risk if changed |
|---|---|---|---|---|
| ID-01 | `scripts/build-bigdrop-hair-prom-xlsx.mjs` around row construction; `excel-work/build-prom-v3-final.mjs` | Product code is commonly formatted as `U<supplier-code>U`; unique identifier is numeric; product identifier is U-wrapped in strict builders | Source code must be numeric/normalizable | Prom rejection, duplicate identity, broken updates |
| ID-02 | `excel-work/fix-prom-identifiers.mjs` | Repair path writes numeric `Код_товару`, numeric unique ID, and U-wrapped product ID | Fixed workbook columns and run order | Contradicts ID-01; changing order changes export semantics |
| ID-03 | `excel-work/fix-prom-unique-id-numeric.mjs` | Numeric unique IDs are written to fixed rows/columns and assumes 100 rows | Exact workbook shape and row count | Wrong products can be modified |
| ID-04 | `excel-work/fix-product-code-u-format.mjs` | Later repair restores U-wrapped code/product ID while preserving numeric unique ID | Prior repair output | Order-dependent identity |
| CAT-01 | `build-prom-ugopt-100-2026-08-24.mjs` around category map; strict final builders | Each product should have an explicit category/group mapping; strict builder fails if a controlled mapping is missing | Category map and Prom category catalog | Prom auto-classification or wrong placement |
| CAT-02 | `excel-work/fix-prom-categories.mjs` | Category/group fields can be repaired from external category JSON and hardcoded label overrides | External JSON path and workbook headers | Wrong category, stale mapping, missing link |
| CAT-03 | `excel-work/build-prom-final-2026-09-01.mjs`, `build-final-xlsx.mjs` | Some final paths write group/category labels while category-link fields may remain null | Template field semantics | Prom import/category auto-detection failure |
| MFG-01 | `excel-work/build-prom-v3-final.mjs`, `build-home-misc-next-100-prom-final.mjs`, `scripts/build-bigdrop-hair-prom-xlsx.mjs` | If manufacturer is unknown/blank, use `AND`; preserve a confirmed source manufacturer where available in some builders | Source attributes and existing workbook value | Required-field error or loss of correct manufacturer |
| MFG-02 | `excel-work/qa-prom-ready-final.mjs` | QA requires every manufacturer value to equal `AND` | QA-specific policy | Conflicts with MFG-01 and can reject valid known brands |
| RET-01 | Multiple strict final builders | Retail-only listing leaves `Оптова_ціна` and `Мінімальне_замовлення_опт` blank/null | Prom field semantics | Wholesale validation error if populated; missing retail intent if not marked |
| PRICE-01 | `build-prom-products.mjs` | Protect cost using purchase price × dropship markup 1.3 × safety margin 5%, then account for commission and extra rates/tiered profit | Commission fallback 12.5%, rate components, tiers | Profitability and competitiveness change |
| PRICE-02 | `build-prom-10-ai-photos-2026-08-24.mjs`, `excel-work/apply-price-rule.mjs` | Include expected delivery 105 and worst-case delivery 120 in price/profit logic; use tiered minimum/target profit | Delivery assumptions and tier table | Under/overpricing; delivery may be double-counted |
| PRICE-03 | `excel-work/build-prom-photo-price-fixed.mjs`, `excel-work/build-prom-v3-final.mjs`, `scripts/build-bigdrop-hair-prom-xlsx.mjs` | Orient final price around purchase × 1.90 / 0.80, corresponding to 20% commission and 90% profit relative to purchase before other costs | Current purchase price and 20% commission | Changes commercial policy; must be tested against market requirements |
| PRICE-04 | Several builders | Round final price using integer/psychological anchors or ceiling | Selected builder | Price changes and margin drift |
| PHOTO-01 | `PHOTO-MASTER-SPEC.md` | Exactly five final 1280×1280 PNGs per product, named `01_main` through `05_details` | Product-specific photo directory and output validator | Prom quality and card conversion |
| PHOTO-02 | `PHOTO-MASTER-SPEC.md` | Roles must differ by commercial task/composition; first four may use concise Ukrainian text, fifth is clean detail | Confirmed source facts and language | Repetitive/non-selling or misleading cards |
| PHOTO-03 | `PHOTO-MASTER-SPEC.md`, prompt scripts | Preserve exact product identity, shape, controls, count, accessories, and color; do not add unconfirmed properties | Source reference images/attributes | Misrepresentation and returns |
| PHOTO-04 | `excel-work/build-prom-final-2026-09-01.mjs`, `build-final-xlsx.mjs`, current-drive builder | Some workflows permit old/supplier fallback or pad a list to five links | Current/old Drive maps and supplier URLs | Old photos reappear; five links do not mean five valid new assets |
| PHOTO-05 | v3/home/pets/price-fixed builders | Strict variants require five current target-Drive photos and exclude incomplete products | Drive map and folder policy | Lower row count or inability to publish, but safer correctness |
| PHOTO-06 | Several builders | Prom-compatible public image URL form is treated as a business requirement; current strict variants prefer direct `lh3.googleusercontent.com` links | Drive sharing and remote fetch behavior | HTTP 400 if URL form/access is wrong |
| CONTENT-01 | `enrich-prom-sales-content.mjs` and strict final QA | RU and UA title/description/keyword fields are separate and language-specific | Translation/content rules | Language contamination or poor search relevance |
| CONTENT-02 | `excel-work/build-prom-final-2026-09-01.mjs`, strict builders | Search phrases should be at least 25 per language and no longer than 1024 characters in the stricter flows; banned internal tokens are removed | Category family, product facts | Prom field validation and SEO quality |
| CONTENT-03 | strict final builders | Short HTML description limits are 250 RU and 270 UA in later QA | Prom template/field limits | Import rejection |
| CONTENT-04 | user-provided/master specs represented by scripts | Descriptions should use product-specific, confirmed facts and sales structure; do not invent accessories/specifications | Supplier attributes/photos | Misleading listing and returns |
| CHAR-01 | `excel-work/finalize-prom-photos-and-required-chars.mjs`, builder row creation | Required characteristics must be present; unknown manufacturer may be `AND` | Category-specific Prom requirements | Import rejection |
| SELECT-01 | `select-next-100-home-misc.mjs`, `select-hair-styling-all.mjs`, pets selector | New selections exclude products found in prior manifests/artifacts | Historical paths, code/image keys | Duplicate listings or missed catalog items |
| SELECT-02 | selection scripts | Target counts/categories are batch-specific (10/50/100 or “all”) | Hardcoded URL sets and prior output paths | Inconsistent product scope |
| QA-01 | strict final builders | A final export should contain explicit categories, valid identifiers, retail-only fields, content, keywords, and photo links | Builder-specific QA | False readiness when checks are incomplete |
| QA-02 | `excel-work/verify-photo-urls.mjs` | A photo URL should return a successful response with image MIME for a byte range | Network and public Drive access | Remote failure after local export |

## 2. Rules versus implementation details

### Business rules

These are customer/platform outcomes and should eventually be centralized as policy:

- retail-only versus wholesale mode;
- profitability/commission policy;
- product identity/identifier formats;
- explicit category assignment;
- required characteristics and manufacturer fallback;
- five-photo roles and source identity;
- language separation, keyword minimum/maximum, and HTML limits;
- no invented product properties/accessories;
- no stale/fallback photos when a strict AI-photo run is requested.

### Implementation details

These should not be mistaken for business policy:

- a particular date in a filename;
- a fixed local folder or Drive map filename;
- `A2:A101` or `A2:DD101` ranges;
- whether `@oai/artifact-tool` or another workbook library writes the file;
- regex versus JSON-LD parsing;
- whether a URL is built with a helper function or string template;
- the presence of a QA sheet versus a JSON report.

## 3. Conflicts requiring an explicit decision

### Pricing

The repository cannot safely claim one current price policy. It has a dropship/safety/extra-rate formula, a delivery-inclusive tiered formula, and a 20% commission / 90%-of-cost orientation. A migration must first name the policy version, define whether delivery is charged to the seller or buyer, define rounding, and write a decision trace per product.

### Identifier semantics

The user-facing history and strict later builders point toward `Код_товару=U123U`, numeric `Унікальний_ідентифікатор`, and U-wrapped `Ідентифікатор_товару`. `fix-prom-identifiers.mjs` contradicts this by writing numeric product code. No consolidation should happen until a fixture is imported/accepted and the exact Prom contract is confirmed.

### Manufacturer

“Use `AND` when unknown” and “all manufacturers must be `AND`” are not equivalent. The former preserves known source values; the latter discards them. The intended business rule must be selected and tested.

### Photos

The strict business requirement is five current target-folder images with five distinct role assets. Older builders treat five links, including fallback or duplicates, as sufficient. These must be separate modes, not implicit fallback behavior.

### Text rendering

The photo spec describes integrated selling compositions, while some helper prompts explicitly defer typography to an overlay step. The platform-facing output contract must say whether text is part of the generated asset, whether a post-render overlay is allowed, and how Ukrainian text is validated.

## 4. Protected behaviors before migration

Until characterization tests exist, do not change the rules listed in this file, even if an implementation looks duplicated or inelegant. First capture current fixtures and expected workbook/URL outputs, then introduce a versioned policy with an intentional change record.
