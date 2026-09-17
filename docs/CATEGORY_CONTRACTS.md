# Category Contracts

Status: category architecture foundation for `refactor/category-contract-v1`.

This document records the category and group concepts currently present in the
repository. It does NOT redefine category taxonomy, category assignment policy,
or product-selection policy. PR #9 is audit, contract documentation, and
low-risk extraction only; no existing category values or mappings are changed.

## 1. Category and group concepts

The repository contains several distinct concepts that must not be merged:

- **Supplier/source category:** a category represented by a supplier page,
  URL, breadcrumb, source label, or supplier category ID.
- **Supplier category URL/page:** the crawl boundary used to obtain candidate
  products. It is not automatically a Prom category or a product assignment.
- **Internal classification:** a local heuristic or curated product kind used
  by a content/photo/export workflow.
- **Prom category:** an external Prom subdivision/category ID and its catalog
  name, often loaded from a commission/category JSON artifact.
- **Prom group:** a workbook group row identified by a group number and group
  name, with separate external group/category IDs and optional parent fields.
- **Prom group ID:** the workbook's `Ідентифікатор_групи`; it is not
  interchangeable with `Ідентифікатор_підрозділу`.
- **Parent group:** the workbook parent number/ID relationship. It is not
  implied by a product's supplier category.
- **Requested runtime category:** a category selected by the user for one run.
  It is input data, not a production constant.
- **Category mapping:** a workflow-specific relation between one or more of
  the concepts above. Existing mappings are not a canonical global map.
- **Product category assignment:** the decision about the category/group
  written for an individual product.
- **Product selection category:** the source scope used to collect candidate
  products before assignment.
- **Fallback category:** a substitute used by some historical workflows or
  inferred from existing workbook values. It is policy, not resolution.
- **Workbook category/group row:** the serialized Prom group representation
  used by the Excel export.
- **QA category expectation:** a workflow-specific validation predicate, such
  as requiring a non-root group name and a nonblank subdivision ID.

## 2. Existing implementations reviewed

The audit reviewed source selection, supplier enrichment, content drafts,
Prom builders, category repairs, group-map verifiers, QA utilities, golden
canonicalization, and Prom workbook integration tests, including:

- `excel-work/select-next-100-home-misc.mjs`
- `excel-work/select-hair-styling-all.mjs`
- `excel-work/select-all-pets.mjs`
- `excel-work/enrich-next-100-home-misc.mjs`
- `scripts/prepare-ugopt-hair-100-premium.mjs`
- `excel-work/build-next-100-content-draft.mjs`
- `excel-work/build-hair-content-draft.mjs`
- `excel-work/build-pets-content-draft.mjs`
- `build-prom-ugopt-100-2026-08-24.mjs`
- `build-prom-10-ai-photos-2026-08-24.mjs`
- `excel-work/build-prom-v3-final.mjs`
- `excel-work/build-home-misc-next-100-prom-final.mjs`
- `excel-work/build-pets-prom-final.mjs`
- `excel-work/fix-prom-categories.mjs`
- `excel-work/fix-35214-category.mjs`
- `excel-work/rewrite-content-and-categories.mjs`
- `scripts/build-bigdrop-hair-prom-xlsx.mjs`
- `excel-work/verify-categories.mjs`
- `excel-work/verify-category-map.mjs`
- `excel-work/verify-category-map-dynamic.mjs`
- `tests/characterization/identifiers-categories-current.test.mjs`
- `tests/characterization/workflow-smoke.test.mjs`
- `tests/golden/canonical.mjs`
- `tests/integration/prom-excel-contract.test.mjs`

## 3. Supplier/source category behavior

Supplier selection is currently workflow-specific:

- the home-misc selector crawls one hardcoded UG-OPT category URL and writes a
  source label such as `1000 Мелочей для дома`;
- the hair selector crawls three hardcoded category URLs, labels each source
  category, deduplicates by SKU, and combines the resulting pool;
- the pets selector accepts a category URL argument but has a pets default and
  writes a pets source label;
- the hair preparation script crawls a category-page family and separately
  extracts a supplier `categoryId` from each product page;
- the BigDrop builder extracts a category token and breadcrumb/category URL
  from the source page.

These source IDs, URLs, breadcrumbs, and labels are evidence about the source
catalog. They are not a universal Prom category assignment.

## 4. Prom categories and groups

Prom-facing workflows use several forms of data:

- an external category catalog loaded from a local JSON artifact and indexed by
  `String(category.id)`;
- hardcoded SKU-to-category maps in dated batches;
- curated product/category maps in content drafts;
- fixed group objects for a workflow, including group number, RU/UA names,
  category ID, group ID, and category URL;
- group rows copied or extended from a reference workbook;
- BigDrop-specific child groups with a fixed parent label.

The Excel contract owns only the sheet names and exact header lookup. It does
not own category meaning, mappings, or category assignment policy.

## 5. Existing mappings and hardcoded values

Hardcoded category behavior exists in multiple independent forms:

- SKU-to-Prom-category and SKU-to-category-URL maps in the dated UG-OPT
  builders;
- SKU-to-group maps in the ten-product AI-photo builder;
- `GROUPS` and `categoryMeta` objects in content-draft workflows;
- `categoryRuOverrides` in the category/content rewrite workflow;
- fixed pets and hair group objects;
- fixed BigDrop group numbers, names, and parent names;
- keyword-overlap ranking against an external category catalog;
- regex classification of hair products from titles and attributes.

These values are batch or business policy. They must not be combined into a
single global map without an authoritative catalog and explicit policy.

## 6. Conflicts and fallback behavior

The audit found the following conflicts:

- a supplier category, a Prom category, and a Prom group can have different
  IDs and names;
- some builders use a curated SKU mapping while others parse a source or
  workbook category field;
- some mappings preserve an existing group number, while others allocate a
  new group number;
- category repair uses external catalog data, reference groups, and RU label
  overrides, and intentionally clears `Посилання_підрозділу` in its current
  compatibility behavior;
- some final builders use the category/group already present in a workbook;
  others write a new fixed group or category;
- some category classifiers fall back to a generic internal label such as
  `Прилади для укладання волосся`, while other workflows throw on a missing
  exact category or label;
- QA scripts differ in whether they validate a group row, a subdivision ID,
  a category URL, a non-root label, or only a nonblank field.

No new fallback policy is introduced here. In particular, an unresolved
requested category must not silently become `Техніка`, `Краса`, `Інше`, or any
other substitute unless a future explicit business policy says so.

## 7. ID and value risks

Category and group IDs have different semantics and must remain separate from
product identifiers. The identifier contract `stripOuterU(...)` is not used
for category or group IDs.

Existing code uses `String`, `String(...).trim()`, `Number`, and direct value
comparisons in different places. Converting an ID to a number can lose leading
zeros and can change the type written to a workbook. Trimming changes exact
lookup behavior. Case and missing-value behavior also differs. No category ID
normalization was centralized because exact equivalence was not proven.

## 8. Category Resolver boundary

The future Category Resolver is a separate component. Its responsibility is:

```text
requested category
        |
        v
resolve against supplier/source taxonomy
        |
        v
resolved source category
```

Potential future inputs include an exact source category ID, exact source name,
an explicitly configured alias, or a source URL/slug. PR #9 does not invent
fuzzy matching, aliases, or substitute categories.

Resolution should return an explicit not-found result, for example:

```text
Requested category: Фени
Resolution: NOT FOUND
```

Resolution is not product assignment and is not product selection.

## 9. Product Selector boundary

The future Product Selector is also separate. Its input should eventually be:

```text
resolved source categories
+ candidate products
+ run limits/options
```

Its output is a selected product set plus observable selection results. It may
eventually support per-category limits, a total limit, deduplication, stable
source relationships, deterministic selection where appropriate, and a
report. PR #9 does not choose random, newest, cheapest, margin-based,
popularity-based, supplier-order, or AI-ranking behavior.

The selector must accept changing requested categories without source-code
changes. A request can contain one category, N categories, arbitrary category
combinations, per-category limits, an optional total limit, or no resolvable
category. These are run inputs, not constants in production code.

## 10. Future dynamic run boundary

The intended future boundary is:

```text
Run Request
    |
    v
Requested Categories
    |
    v
Category Resolver
    |
    v
Resolved Source Categories
    |
    v
Candidate Product Pool
    |
    v
Product Selector
    |
    v
Selected Products
    |
    v
Existing Product Processing Pipeline
```

The existing content, description, photo, pricing, Excel, and Prom stages
remain downstream. This document does not authorize rewriting those stages.

## 11. Future selection summary

Selection must eventually be observable per requested category. A future
summary should record:

- requested category;
- resolved source category or `NOT FOUND`;
- candidate count;
- requested per-category limit;
- selected count;
- rejected count and reason.

For example:

```text
Фени
Resolved: supplier_category_142
Candidates: 64
Requested: 20
Selected: 20
```

An unknown category should report zero selected products and an explicit
resolution failure, not a silently substituted category.

## 12. Behavior intentionally left local in PR #9

The following behavior remains local and unchanged:

- source category URLs, page crawling, pagination, and source labels;
- supplier category ID and breadcrumb parsing;
- regex or keyword-based internal classification;
- SKU/category/group/category-URL maps;
- external catalog loading and category lookup;
- parent/child group relationships;
- group-number allocation and reference-workbook reuse;
- category-name translation and RU override maps;
- product category assignment;
- product selection and historical exclusion rules;
- fallback categories and missing-category errors;
- workbook row writes and category QA predicates.

No production consumer was modified and no category behavior was extracted.
No `src/contracts/product-categories.mjs`, `source-categories.mjs`, or
`prom-categories.mjs` module was created because the audit did not prove a
shared, policy-free, behaviorally identical implementation.

## 13. Future migration candidates

After a versioned run request and authoritative category catalog exist, future
low-risk candidates may include:

1. a pure request-shape validator for runtime category input;
2. an explicit source-category reference representation;
3. a resolver result type with `resolved` and `notFound` states;
4. a selection summary/report schema;
5. independent tests for exact ID/string semantics and missing values;
6. a policy-aware category decision service only after parity fixtures and
   business approval.

Those candidates must preserve current category assignments, IDs, names,
fallbacks, parent links, and workbook values until an intentional policy
change is approved.

## Scope statement

This document establishes terminology and future boundaries only. It does NOT
redefine category taxonomy, category assignment policy, product-selection
policy, Prom group selection, supplier selection, pricing, identifiers,
content, photos, or workbook business values.
