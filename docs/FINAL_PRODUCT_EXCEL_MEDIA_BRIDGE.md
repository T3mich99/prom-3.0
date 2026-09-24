# Final Product / Excel / Media Bridge v1

## Purpose

`src/excel/final-product-excel-bridge.mjs` is the PR #26 composition boundary
between a PR #25 `READY_FOR_EXPORT` production artifact and an existing,
inspected Prom import workbook. It creates an Excel export artifact only. It
does not publish to Prom, host images, upload files, call a network service, or
create a production CLI.

The public APIs are:

```js
buildFinalProductExcelRecord({ productionArtifact, publishableMedia, mapping })
await exportFinalProductsToWorkbook({ inputPath, outputPath, products, mappingOptions })
```

Both APIs are deterministic and do not mutate caller-owned artifacts.

## Required production input

The bridge accepts the exact PR #25 production artifact shape, not a loose
product-like object. It requires:

- `workflowStatus: "READY_FOR_EXPORT"`;
- one canonical `productKey`, equal to `selectedProduct.selectionKey`, PR22
  `pricingDecision.productKey`, `contentArtifact.productKey`, and
  `approvedMedia.productKey`;
- PR25 provenance for PR22 pricing, Commercial Content Quality v2, and PR24
  real-photo production;
- a READY PR22 decision with its complete retained evidence/profitability
  records;
- commercial READY content; and
- exactly five Approved Media local records.

The bridge does not re-run pricing, regenerate content, regenerate media,
infer a category, regenerate identifiers, or assign metadata defaults.

## Selling price and money representation

The only selling-price authority is:

```text
pricingDecision.pricing.recommendedPrice
```

It must be a PR22 READY UAH value. PR22 provides both an integer
`amountMinor` (kopiykas) and a two-decimal `amount` string. The bridge checks
that they agree, then converts the minor amount to the numeric major-UAH value
expected by the current Excel contract. For example, `44900` becomes `449` and
`44901` becomes `449.01`. This is representation conversion only: it performs
no markup, rounding, pricing calculation, or market lookup.

Supplier purchase price, commission, market evidence, profitability, margin,
ROI, and internal diagnostics are never placed in the canonical row. A value
in `resolvedMetadata.price` is rejected rather than allowed to override PR22.

## Content and metadata

The bridge composes the existing
`buildContentExcelRow({ selectedProduct, contentArtifact, resolvedMetadata })`
adapter. It preserves title, description, and keyword strings exactly; there
is no trimming, translation, HTML rewrite, or SEO regeneration. Commercial
Content Quality v2 must be READY before this existing base-content adapter is
used.

`resolvedMetadata` remains pass-through-only canonical metadata. It cannot
override content fields, `price`, or `photoUrls`. Existing identifier values,
including leading-zero strings and U-wrapper values, are preserved unchanged.
No product code, identifier, manufacturer, unit, currency, availability, or
category is invented.

Category IDs and names are never inferred from supplier hierarchy, product
text, or title. When a supplied workbook maps category columns, both explicit
`categoryId` and `categoryName` are required. Unit, currency, availability,
manufacturer, and identifier cells are written only when already resolved and
mapped by the supplied template.

## Local Approved Media and Publishable Media

PR24 Approved Media contains validated **local** PNG asset references. A local
path, `file:` URL, repository path, or temporary output path is not a Prom
photo URL and is never written to `photoUrls`.

The bridge therefore accepts a separate provider-neutral Publishable Media
artifact:

```js
{
  productKey,
  version, // optional
  verification: {
    status: 'PUBLIC_IMAGE_SHA256_VERIFIED',
    verifier: 'category:media',
    urlPolicy: 'lh3-googleusercontent-v1',
  },
  items: [
    { index, role, fileId, approvedAssetRef, publicUrl, sha256 } // sha256 optional
  ]
}
```

It requires exactly five items, indexes 1–5, and canonical order/roles:
`hero`, `usage`, `benefits`, `feature`, `final`. Each item must retain the
matching `approvedAssetRef` from Approved Media. PR24's current Approved Media
contract exposes `index` and `assetRef`, but does not expose a local hash or
role; therefore PR #26 binds the stronger available local identity fields
(`index + assetRef`) and validates the supplied canonical role. A supplied
`sha256` must be structurally valid, but cannot be compared to a hash not
present in the existing Approved Media artifact.

The canonical `category:media` route treats these local references as temporary
provenance only. After the five direct Drive URLs and SHA-256 values are
verified, it removes the local photo bytes and adds a top-level cleanup proof:

```js
cleanup: {
  mode: 'DELETE_AFTER_VERIFIED_PUBLICATION',
  retainsPhotoBytes: false,
  cleanupAuthority: 'category:media',
  status: 'LOCAL_FILES_REMOVED',
  productKey,
  sourceCode,
  items: [{ index, role, sha256 }],
}
```

The Excel bridge accepts this proof and continues to use `approvedAssetRef` only
to bind the published item to the original approved record. It never reads local
photo bytes during Excel export.

The `verification` block is mandatory and can only be produced by the
`category:media` route after an unauthenticated image fetch, MIME check and
SHA-256 comparison. Every item must use the verified direct Drive URL form
`https://lh3.googleusercontent.com/d/<fileId>=w1280`. Legacy viewer and
`drive.google.com/uc?export=view` links are rejected before XLSX writing. The
Excel bridge repeats the structural policy check; it never treats an
authenticated Drive read or a syntactically valid URL as proof of Prom
reachability.

The historical Prom workbook fixtures establish the exact serialization:

```text
https://host/1.png, https://host/2.png, https://host/3.png, https://host/4.png, https://host/5.png
```

That is one comma-and-space-separated string in canonical `photoUrls`; it is
not JSON, newline-separated text, or an array.

Without Publishable Media, the bridge returns
`WAITING_FOR_MEDIA_PUBLICATION` with no row. It never converts local Approved
Media into a fake public URL.

## Template, characteristics, and XLSX output

`exportFinalProductsToWorkbook` reuses existing contracts in this order:

1. `inspectWorkbook(inputPath)`
2. `mapTemplateSchema(schema, mappingOptions)`
3. `buildFinalProductExcelRecord(...)`
4. `buildCharacteristicColumnPlan(...)`
5. `writeAdaptiveWorkbook(...)`

The bridge does not hardcode a sheet name, header row, letters, or dynamic
characteristic columns. A template must be `SAFE` and must map `titleRu`,
`price`, and `photoUrls` before final export. Mapped optional fields are
written when present; unmapped optional fields are not invented.

Characteristics use the existing dynamic Characteristic Column Plan. Values
such as `2200 Вт` remain intact and unit cells remain controlled by the
existing adapter/writer. A non-SAFE characteristic plan prevents that product
from being written.

The existing Adaptive Writer remains the sole XLSX writer. It preserves source
workbook safety, worksheet order, headers, formulas, merged-cell checks,
validation checks, and prohibits same input/output paths. The source workbook
is never overwritten. Ready products are isolated: the writer exports ready
rows while returning explicit statuses for missing-media or blocked products.

## Statuses

- `READY_FOR_EXCEL`: a logical final row has passed all production, price,
  commercial-content, and public-media gates; a SAFE template also yields a
  safe characteristic plan.
- `WAITING_FOR_MEDIA_PUBLICATION`: approved local media exists, but no public
  Publishable Media artifact was supplied.
- `EXPORT_REVIEW`: a production, identity, pricing, content, metadata,
  category, or public-media contract issue blocked the product.
- `NEEDS_TEMPLATE_MAPPING`: the template or characteristic mapping is unsafe
  or lacks required final export fields.
- `EXPORTED`: the Adaptive Writer created and revalidated a separate XLSX
  output for all currently ready rows.
- `FAILED`: a filesystem or Adaptive Writer failure occurred after safe
  composition; the writer's error code is returned.

`EXPORTED` never means `PUBLISHED`, `LIVE`, `READY_ON_PROM`, or
`READY_FOR_PROM`. Prom import and publication remain out of scope.

## Batch behavior and limitations

Batch composition processes each product independently in input order. Missing
public URLs for one product do not corrupt a ready product, and no blocked
product is silently omitted from the returned result. The module contains no
shared giant prompt or quadratic cross-product identity matching and is
appropriate for caller-managed batches up to the existing 6000-product
architecture target.

This PR does not provide public media hosting, Google Drive upload, Prom API,
Prom publishing, paid image providers, OpenAI API integration, a database,
scheduler, retries, a final CLI, live URL reachability checks, or a full
catalog runner. PR #27 may compose an operator-facing production runner and
PR #28 may add persistence/reliability work; neither is implemented here.
