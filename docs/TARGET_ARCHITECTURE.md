# Target Architecture

This is a proposal only. The migration has not been implemented, and existing production behavior must remain available until characterization tests establish parity.

## 1. Design goals

The target system should be:

- explicit about policies and external boundaries;
- deterministic for a fixed source snapshot and policy version;
- restartable and idempotent by run/product key;
- safe for thousands of products without fixed row assumptions;
- testable without a live supplier, Drive, or Excel session;
- observable through run manifests, structured QA issues, and artifact checksums;
- compatible with the existing Prom workbook templates;
- conservative about unconfirmed product facts and photo identity.

It should not optimize for fewer files. Clear contracts are more important than a visually small tree.

## 2. Proposed repository shape

```text
src/
  config/
    run-config.mjs
    policy-registry.mjs
  domain/
    product.mjs
    identity.mjs
    category.mjs
    content.mjs
    pricing.mjs
    photo-asset.mjs
    export-row.mjs
  adapters/
    supplier/
      ugopt-adapter.mjs
      bigdrop-adapter.mjs
    drive/
      drive-map-adapter.mjs
      public-asset-probe.mjs
    prom/
      workbook-schema.mjs
      workbook-reader.mjs
      workbook-writer.mjs
  services/
    selection-service.mjs
    enrichment-service.mjs
    content-service.mjs
    pricing-service.mjs
    category-service.mjs
    identity-service.mjs
    photo-manifest-service.mjs
  validation/
    schema-validator.mjs
    business-validator.mjs
    asset-validator.mjs
    validation-report.mjs
  pipelines/
    select-run.mjs
    prepare-run.mjs
    export-run.mjs
  storage/
    artifact-store.mjs
    run-manifest-store.mjs
    snapshot-store.mjs
  observability/
    logger.mjs
    metrics.mjs
scripts/
  legacy/                 # compatibility entry points during migration
tests/
  fixtures/
  unit/
  integration/
  e2e/
docs/
```

The first implementation can remain JavaScript/ES modules to match the repository. A TypeScript conversion is optional and should not be bundled with behavior migration.

## 3. Domain contracts

### ProductSnapshot

Immutable source evidence:

```text
runId
sourceSystem: ugopt | bigdrop
sourceUrl
sourceCode
sourceTitle
purchasePrice
availability
rawAttributes[]: {name, value, source}
sourceImages[]: {url, ordinal, fetchedAt, checksum, mime, width, height}
sourceCategory: {id, name, url}
fetchedAt
rawSnapshotRef
```

Unknown values must remain unknown. A missing fact is not a license for content or photo generation to invent one.

### ProductDecision

The normalized business-facing record:

```text
productKey
sourceRef
categoryDecision: {id, name, provenance, policyVersion}
identityDecision: {supplierCode, promCode, uniqueId, productId, policyVersion}
manufacturerDecision: {value, provenance, fallbackUsed}
contentRef
pricingRef
photoManifestRef
eligibility: ready | blocked | excluded
```

### PricingDecision

```text
policyVersion
purchasePrice
commissionRate
deliveryCost / deliveryMode
targetProfit
unroundedPrice
roundedPrice
expectedNetProfit
worstCaseNetProfit
assumptions[]
```

Multiple historical policies may coexist during migration, but the selected version must be explicit per run/product.

### ContentBundle

```text
titleRu, titleUa
descriptionRu, descriptionUa
htmlRu, htmlUa
keywordsRu, keywordsUa
characteristics[]: {name, value, source, confirmed}
languageQA
```

The content service consumes confirmed source facts and a versioned content policy. It should not write directly to Excel.

### PhotoAsset and PhotoManifest

```text
productKey
role: main | benefits | features | use | details
localPath
sourceReference
driveId
publicUrl
provenance: generated | transformed | supplier
isCurrent
checksum
mime
width
height
validatedAt
validationStatus
```

Strict Prom mode requires exactly one validated asset for each role, five distinct checksums, the allowed URL policy, and a successful remote image probe. Fallback is a separate explicit mode.

## 4. Module boundaries

### Source adapters

Only supplier adapters know page structure, URLs, retries, and parsing. They return `ProductSnapshot` plus structured parse issues. They do not calculate Prom prices or write workbooks.

### Selection service

Consumes source candidates and a persistent run/exclusion index. It returns selected product keys and an exclusion report. It does not infer “new” from arbitrary local folders.

### Policy services

Pricing, identity, category, manufacturer, content, and photo policies are pure or mostly pure functions over a normalized product and explicit config. Each decision includes provenance and policy version.

### Prom adapter

Owns template reading, header-driven mapping, cell types, sheet names, and workbook publication. It converts a validated export model into the exact Prom shape. It does not decide prices, categories, or photo provenance.

### Validators

Validators run before publication and produce the same issue schema. Hard errors block export; warnings are recorded. Remote asset validation is a separate, bounded integration step.

## 5. Artifact and run model

Each run should have a unique run ID and a directory such as:

```text
artifacts/<runId>/
  run.json
  source-snapshot.jsonl
  selection.json
  decisions.jsonl
  photos/...
  photo-manifest.json
  export-staging.xlsx
  validation.json
  export-final.xlsx
```

`run.json` records entry point, source systems, category scope, policy versions, input checksums, runtime/dependency version, timestamps, and status. Large images can stay in Drive, but the manifest must retain immutable IDs, checksums where available, and the source folder/policy.

Publication should be staged, validated, and then atomically promoted. A failed run remains inspectable and does not become the next input by filename accident.

## 6. Determinism and external state

Deterministic boundaries:

- policy decisions;
- identifier formatting;
- category mapping from a versioned catalog;
- keyword/content validation;
- workbook row mapping;
- price rounding.

Nondeterministic boundaries that require snapshots/probes:

- supplier page content;
- source image URLs;
- AI image generation;
- Drive permissions and URL responses;
- external Prom template changes.

The system should snapshot or checksum inputs at the boundary, then make the remainder reproducible from local artifacts.

## 7. Configuration and policy registry

Replace embedded constants with a validated run configuration:

```text
source category URLs
target count
artifact root
template path
Drive folder/map reference
pricing policy version
commission and delivery policy
category catalog version
content/photo policy versions
strict/fallback photo mode
network timeout/retry limits
```

Configuration must be explicit, but no production defaults should change during the first migration stages. Existing dated scripts can translate their constants into the new config for comparison.

## 8. Reliability and observability

- bounded retries with exponential backoff for remote reads;
- response size/MIME/dimension checks for images;
- per-row retryable/permanent error state;
- no in-place mutation of the only workbook copy;
- idempotency key `(runId, productKey, policyVersion)`;
- structured logs without credential/path leakage;
- metrics for selected/enriched/excluded/ready/blocked rows, photo completeness, URL probe success, and price-policy outcomes;
- validation reports that link each issue to product, field, rule, and artifact.

## 9. Compatibility strategy

The Prom templates remain an external contract. The adapter should preserve the existing sheet names, headers, column order, and cell types until golden-file tests prove a compatible change. The architecture must also preserve both historical policy modes while they are being characterized.

## 10. Non-goals

- immediate rewrite of all 127 files;
- immediate database introduction;
- automatic selection of one conflicting price/photo/ID rule;
- changing photo style or product content as part of architecture work;
- removing legacy scripts before replacement behavior is proven.
