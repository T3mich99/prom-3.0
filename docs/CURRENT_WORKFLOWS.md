# Current Workflows

**Branch audited:** `refactor/software-engineering-v1`
**Purpose:** describe what the tracked scripts actually do today; this is not a recommended runbook.

## 1. Workflow map

The repository does not have one authoritative pipeline. It contains several batch-specific variants of this general shape:

```text
supplier category/page
      │
      ├─ select products and exclude prior manifests
      │       └─ selected JSON / product URLs / source codes
      ├─ enrich product pages and download source images
      │       └─ price, title, attributes, source images, category token
      ├─ prepare/generate/normalize photo artifacts
      │       └─ role PNGs, local folders, Drive ID maps
      ├─ build or enrich content
      │       └─ titles, descriptions, HTML, keywords, characteristics
      ├─ apply pricing/category/identifier/manufacturer repairs
      │       └─ workbook mutation or new staging workbook
      ├─ build final Prom workbook
      │       └─ Export Products Sheet (+ sometimes Groups/QA)
      └─ run one or more independent QA scripts
              └─ console output / QA JSON / QA sheet / throw
```

The real dependencies are encoded in hardcoded paths, dated filenames, map key conventions, workbook sheet names, and fixed row ranges. A script name containing `final` does not imply it is the only or current final exporter.

## 2. Supplier ingestion and selection

### UG-OPT selection

`excel-work/select-next-100-home-misc.mjs` crawls the hardcoded “1000 small things for home” category, recursively inspects historical manifests/source artifacts at hardcoded paths, derives already-used product/code/image keys, and selects the first 100 candidates not seen previously. `excel-work/select-hair-styling-all.mjs` does a similar job for three hair-styling category URLs. `excel-work/select-all-pets.mjs` selects all not-previously-used products for its pets category.

Important behavior:

- previous work is identified by local artifact presence, not by a persistent catalog;
- exclusion sources differ by selector;
- selection target/count rules differ by script;
- a product can be considered new or old depending on which historical path is scanned;
- the selection result is a JSON artifact and is not validated against a shared schema.

### Page enrichment

`excel-work/enrich-next-100-home-misc.mjs` fetches product URLs in chunks, parses JSON-LD and HTML attributes/images/category data, and writes enriched source JSON. It uses retries/timeouts in this newer path but throws the batch if any row has a source error, missing title/price, or missing images. The hair/BigDrop scripts perform similar fetch/parse work but with their own fields and heuristics.

Typical normalized-in-memory fields are:

```text
source URL, source code/SKU, source title, source price,
availability, attributes, image URLs, category ID/name, fetch error
```

There is no durable versioned source snapshot contract; JSON filenames and directories act as the snapshot identity.

## 3. Content and keyword enrichment

`excel-work/enrich-prom-sales-content.mjs` is the closest thing to a generalized content pipeline. It reads product/source data, applies embedded translation pairs and category-family heuristics, creates RU/UA titles, descriptions, HTML blocks, keywords and characteristics, normalizes identifiers, and writes a workbook. Other content builders (`build-hair-content-draft.mjs`, `build-next-100-content-draft.mjs`, `build-pets-content-draft.mjs`, `rewrite-content-and-categories.mjs`) use separate templates/rules.

The content paths commonly produce:

- Russian and Ukrainian title fields;
- separate Russian/Ukrainian search phrases;
- plain-text descriptions and short HTML descriptions;
- characteristics copied or synthesized from source attributes;
- group/category labels;
- manufacturer fallback values.

The content engines are not interchangeable. Some use group templates, some use manually curated product maps, and some derive semantic attributes from title words. The later stricter builders run keyword/HTML checks, but not all content draft paths do.

## 4. Pricing workflows

At least four pricing families exist:

1. `build-prom-products.mjs`: purchase cost is adjusted with a dropship markup and safety margin, then commission and additional rates are accounted for, followed by tiered minimum-profit logic.
2. `build-prom-10-ai-photos-2026-08-24.mjs` and `apply-price-rule.mjs`: expected delivery (105) and worst-case delivery (120) are treated as costs, with tiered profit assumptions and commission.
3. `build-prom-photo-price-fixed.mjs`, `build-prom-v3-final.mjs`, and `scripts/build-bigdrop-hair-prom-xlsx.mjs`: use the formula family `purchase × 1.90 / 0.80` or an equivalent 20% commission / 90%-of-cost target, with integer rounding in some paths.
4. Other dated builders embed their own commission/category/tier behavior.

Pricing is therefore a policy family rather than a single implementation. Some scripts write a note string containing purchase price, commission, markup/target, and unrounded price; others write a Pricing QA sheet. There is no shared pricing decision artifact that records the selected policy version and inputs.

## 5. Photo workflows

### Source image download

Root and `excel-work` downloaders fetch supplier images and reject obvious HTTP failures or very small/non-image responses in some paths. The photo output is stored in local product/batch folders, often outside Git and ignored by `.gitignore`.

### Prompt/generation/preparation

Prompt scripts produce role-specific instructions and manifests. The tracked `PHOTO-MASTER-SPEC.md` requires five 1280×1280 PNG roles:

```text
01_main.png       main selling image
02_benefits.png   benefits / commercial value
03_features.png   features / confirmed parameters
04_use.png        use/lifestyle scenario
05_details.png    clean detail/close-up
```

The spec also requires product identity preservation, Ukrainian text where used, no unconfirmed accessories, and distinct commercial compositions. Actual helper policies diverge: some ask the generator to include text; `scripts/build-ugopt-hair-photo-manifest.mjs` says text is added later; `overlay-ukrainian-photo-text.mjs` performs a literal overlay; other Python compositors build cards deterministically.

### Drive mapping and final links

Drive map JSON files map a local role filename or product key to a Drive ID. Builders convert IDs into several URL forms:

- `https://drive.google.com/uc?export=view&id=...`;
- `https://drive.google.com/uc?export=download&id=...`;
- `https://drive.google.com/file/d/.../view?usp=drive_link`;
- `https://lh3.googleusercontent.com/d/...=w1280`.

This is a major workflow boundary. Earlier builders accept old/supplier fallback images or repeat the last link to reach five entries. Later strict builders require five current target-folder links and exclude incomplete products. Some QA scripts only check URL syntax; `verify-photo-urls.mjs` performs a range request and MIME check but is not a universal publication gate.

## 6. Category, manufacturer, and identifier repairs

The common observed sequence is not guaranteed but often resembles:

```text
build/enrich workbook
  → category repair
  → manufacturer/required characteristic repair
  → numeric unique-ID repair
  → U-wrapped product-code repair
  → photo-link cleanup or final rebuild
  → QA
```

The sequence is unsafe because the repairs write overlapping columns with conflicting policies. For example, `fix-prom-identifiers.mjs` writes a numeric product code, while `fix-product-code-u-format.mjs` restores `U...U`. Some final builders leave unique ID null and expect a later repair; others write it directly. Category scripts may blank category links while final QA in another path requires a populated link.

## 7. Final workbook builders

### Legacy/root builders

The root dated builders create batch-specific workbooks from hardcoded source paths, selected codes, category maps, and content maps. They are useful historical implementations but not safe as an implicit current entry point.

### `excel-work` final variants

- `build-prom-final-2026-09-01.mjs` combines current, fallback, old, and supplier photos and builds keywords/content. It has a broad fallback policy by design.
- `build-final-xlsx.mjs` uses a current Drive map if present and otherwise the source image list; its QA does not prove all links are current AI photos or network-valid.
- `build-final-with-current-drive-photos.mjs` prefers current AI links but explicitly falls back to source links; QA reports fallback rows rather than making them impossible.
- `build-prom-photo-price-fixed.mjs` is a stricter fresh workbook with direct Google image URLs, current price fetch, five-photo requirement, numeric unique IDs, retail-only fields, and profitability QA.
- `build-prom-v3-final.mjs` is a later strict home-misc builder. It requires five target-folder photos, explicit categories, numeric unique IDs, U-wrapped codes/product IDs, manufacturer fallback, retail-only blanks, keyword limits, HTML limits, and two sheets.
- `build-home-misc-next-100-prom-final.mjs` and `build-pets-prom-final.mjs` are similar category-specific strict builders with their own hardcoded inputs and QA.
- `scripts/build-bigdrop-hair-prom-xlsx.mjs` builds a 50-row hair workbook from BigDrop pages and local photo folders. It writes a QA report but does not fail when all five image links are not present.

## 8. QA and publication

QA is currently a set of scripts, not a single gate. Checks include:

- workbook row counts and required headers;
- category/group presence;
- manufacturer values;
- numeric unique IDs and U-wrapped product IDs;
- retail-only blank wholesale fields;
- keyword counts and length;
- HTML description length;
- photo count and URL regex;
- sometimes remote HTTP status and MIME.

Important differences:

- some builders throw on failure, some only print/write a report;
- some validate URL shape but not remote response;
- some check five links, not five distinct/current/identity-matched assets;
- some QA uses positional columns or fixed row count;
- `build-final-xlsx.mjs` contains a no-op `Object.values(checks).some(...)` conditional before its actual partial checks;
- `build-bigdrop-hair-prom-xlsx.mjs` reports `allProductHasFiveImages` but does not include it in the hard failure condition;
- `build-pets-prom-final.mjs` has a self-conflicting numeric-ID check as described above.

## 9. Hidden manual steps and state

The workflow depends on operator choices that are not written into a run manifest:

- selecting which dated “final” script to execute;
- choosing the correct source/enriched JSON directory;
- choosing current versus old Drive map;
- placing or uploading AI photos and obtaining Drive IDs;
- opening public access so Prom can fetch them;
- running repair scripts in a particular order;
- manually interpreting QA reports that do not fail the build;
- deciding whether a fallback photo is acceptable.

Filenames, local folders, workbook sheet names, and notes strings act as implicit state. A fresh machine or a different operator cannot reliably reconstruct the same run from Git alone.

## 10. Current operational conclusion

The system is best understood as multiple batch pipelines sharing conventions, not shared code. The repository can be kept working during migration only if each run records its exact entry point, inputs, policy versions, output, QA reports, and photo manifest. Until then, “final” means “the result of whichever dated script was selected,” which is not an auditable production contract.
