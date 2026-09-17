# Golden Baseline

**Branch:** `refactor/software-engineering-v1`
**Phase:** golden regression fixtures
**Date:** 2026-09-11

This phase freezes a small, portable sample of real historical outputs before production refactoring begins. The fixtures are evidence of existing behavior; they are not a decision about which behavior is correct.

## 1. Historical artifacts inspected

The local ignored output archive was discovered rather than assumed. It contains dated product-factory exports, home-misc exports, pets exports, hair/BigDrop exports, pricing QA reports, Drive/photo QA reports, source snapshots, and earlier intermediate workbooks. The inspected workbook families were:

- `outputs/prom-product-factory-2026-08-23/`
- `outputs/prom-product-factory-2026-08-25/`
- `outputs/prom-product-factory-2026-08-31/`
- `outputs/prom-product-factory-2026-09-01-final/`
- `outputs/home-misc-next-100-2026-09-04/`
- `outputs/pets-all-2026-09-05/`
- `outputs/bigdrop-hair-50-new-2026-09-10/`

The inspection used read-only imports and existing inspection/QA scripts. No historical source workbook was modified.

## 2. Selected goldens

Each selected workbook was reduced to one real product row and its matching group row where available. The original workbook remains outside Git; the portable fixture records the source label and the sanitized logical values.

| Fixture | Historical artifact | Representative workflow | Product | Behavior covered |
|---|---|---|---|---|
| `standard-prom` | `outputs/prom-product-factory-2026-08-23/Prom-final-products.xlsx` | root standard Prom factory | `U2992754039U` | Russian-header workbook, root pricing output, supplier image URLs, populated wholesale price and missing group fields |
| `tiered-price-rule` | `outputs/prom-product-factory-2026-08-25/Prom-UGOPT-100-final-price-rule.xlsx` | tiered pricing repair/export | `U0149U` | tiered price result, `drive.google.com/uc?export=view` URLs, explicit group, retail-only blank wholesale fields |
| `legacy-photo-fallback` | `outputs/prom-product-factory-2026-08-31/Prom-UGOPT-100-final-2026-08-31.xlsx` | legacy final export | `U9230U` | mixed supplier and Drive-download URLs, five-link padding, repeated final URL |
| `strict-ready` | `outputs/prom-product-factory-2026-09-01-final/Prom-UGOPT-100-final-ready-2026-09-01.xlsx` | strict UG-OPT final-ready export | `U34722U` | numeric unique ID, U-wrapped product code/ID, explicit group, five ordered Drive-view links |
| `home-misc-current` | `outputs/home-misc-next-100-2026-09-04/Prom-home-misc-next-100-final-2026-09-04.xlsx` | strict home-misc current-photo export | `U10656U` | direct `lh3.googleusercontent.com` links, `AND` manufacturer fallback, pricing note, explicit category/group |
| `pets-current` | `outputs/pets-all-2026-09-05/Prom-pets-all-final-2026-09-05.xlsx` | strict pets export | `U22620U` | pets category/group, current direct Drive links, `AND` manufacturer, historically numeric product-ID value |
| `bigdrop-hair` | `outputs/bigdrop-hair-50-new-2026-09-10/Prom-bigdrop-hair-50-new-2026-09-10.xlsx` | BigDrop hair-styling export | `U9979U` | RU/UA hair content, MPN/model, five current direct Drive links, full characteristic-rich row |

The pricing cases are kept in a separate matrix because several real products have both a pricing QA trace and a workbook representation.

## 3. Sanitization

The derived fixtures contain no credentials, customer data, or personal data. Sanitization performed by `tests/golden/extract-real-goldens.mjs`:

- removed non-photo HTTP URLs such as supplier product links and category links;
- preserved product/business values, photo URLs, URL order, descriptions, keywords, identifiers, prices, categories, manufacturer, notes, HTML fields, and MPN where present;
- preserved the actual header spelling and sheet names for each selected workbook;
- retained only one selected product row and one matching group row;
- recorded only repository-relative artifact labels, never workstation paths.

Photo URLs are asset identifiers rather than credentials and are retained because URL form, order, count, and fallback behavior are part of the historical contract.

## 4. Behavior captured

The golden tests protect exact logical values for:

- sheet names and the selected workbook header rows;
- titles, RU/UA descriptions, RU/UA keywords, HTML fields, and characteristic-related fields;
- prices, currencies, units, availability, wholesale fields, and pricing notes;
- product code, unique ID, product ID, category ID, group number/name, manufacturer, and country;
- photo URL values, order, count, URL family, and legacy fallback/padding evidence;
- MPN/model data for the selected hair-styling row.

`tests/golden/pricing-golden.test.mjs` additionally evaluates the current named pricing functions against real historical cases and compares their outputs to the golden matrix. It intentionally preserves the root engine, the delivery-inclusive tiered rule, and the strict photo-price implementation as separate policies.

## 5. Golden snapshot format

Each fixture directory contains:

```text
tests/fixtures/golden/<fixture-id>/
  snapshot.json
  workbook.xlsx
```

`snapshot.json` has this stable shape:

```json
{
  "fixtureId": "...",
  "sourceArtifact": "repository-relative label",
  "workflow": "...",
  "selectedSourceCode": "...",
  "sheetNames": ["Export Products Sheet", "Export Groups Sheet"],
  "products": {
    "headers": [],
    "row": [],
    "important": {
      "code": "...",
      "price": 0,
      "photoLinks": [],
      "photoCount": 0,
      "photoUrlPolicy": "..."
    }
  },
  "groups": { "headers": [], "rows": [] }
}
```

The small `workbook.xlsx` is a sanitized derived artifact, not a binary copy of a production workbook. The regression test imports it with `@oai/artifact-tool`, reconstructs the canonical snapshot, and compares it exactly to `snapshot.json`.

## 6. Intentional regeneration

Golden fixtures are not regenerated by tests. To intentionally replace one fixture, review the source workbook first, then run the extractor with a local source path and a repository-relative label:

```text
<bundled-node> tests/golden/extract-real-goldens.mjs \
  --input <local-historical-workbook.xlsx> \
  --output tests/fixtures/golden/<fixture-id> \
  --id <fixture-id> \
  --code <product-code> \
  --workflow <workflow-label> \
  --source-artifact <repo-relative-source-label>
```

After regeneration, inspect the JSON diff, run the full test suite, and obtain business review for every changed value. Do not put local absolute paths into tests or fixture metadata.

## 7. Governance

A failing golden test means **historical production behavior changed or the characterization is incomplete**. It does not mean “update the fixture.” Fixture changes require intentional review of the source artifact, the business meaning of the changed fields, and the portability/sanitization checks.

Production scripts remain unchanged in this phase. No commit, push, merge, or pull request is part of golden maintenance.

## 8. Conflicts intentionally preserved

- pricing formulas and delivery assumptions remain different across the root, tiered, and strict implementations;
- identifier fields retain their observed differences, including a historical numeric product-ID value in the pets export;
- legacy photo export accepts mixed fallback URLs and repeated padding, while strict exports require five current direct links;
- Google URL forms remain distinct (`uc?export=view`, `uc?export=download`, supplier URLs, and direct `lh3` URLs);
- category-link presence, manufacturer fallback, content language quality, and HTML formatting remain as observed;
- the compact tracked Prom template and expanded later workbook schemas are not normalized.

## 9. Areas still not protected

- live UG-OPT/BigDrop selection and page parsing;
- live Google Drive permissions and Prom’s remote HTTP/MIME acceptance;
- AI image identity, composition quality, Ukrainian typography, and absence of hallucinated accessories;
- complete parity for every dated builder and template variant;
- end-to-end publication, restart/recovery, performance, and rate-limit behavior;
- Python/PowerShell image-rendering parity;
- subjective marketing quality of titles, descriptions, or generated images.

## Validation

The golden suite is run together with the existing characterization and integration tests. All production files remain read-only during this phase.
