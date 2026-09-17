# Prom catalog registry and media publication bridge

PR29 adds a persistent bootstrap, registry, and delta-only writer for the
current Prom export. The initial source workbook is supplied once; the default
sheet names are `Export Products Sheet` and `Export Groups Sheet`.

The bootstrap copies the approved source to
`runtime/prom/master-template.xlsx` without editing the source workbook. It
stores the source binary SHA-256 as `binarySha256`, the approved master binary
SHA-256 as `masterBinarySha256`, the legacy row-sensitive fingerprint as
`legacySchemaFingerprint`/`schemaFingerprintV1`, and the authoritative
row-independent fingerprint as
`structuralSchemaFingerprint`/`schemaFingerprintV2`. The complete
physical column policy, characteristic-slot mapping, group mapping, and the
existing product registry in the durable SQLite database at
`runtime/ugopt-top10-full-catalog.sqlite`. A later delta run may provide
`bootstrapDbPath` instead of `inputPath` and will use the persisted master and
registry automatically. A fresh export is reconciled read-only before any
approved master replacement. The schema fingerprint covers workbook structure
(sheet order, headers, characteristic capacity, and group-sheet headers), not
product-row counts, so added or missing products are reported separately.
Reconciliation compares V2 and returns `TEMPLATE_SCHEMA_CHANGED` with a
structural diff; the approved master is never silently replaced. V1 remains
available for backward-compatible audit and is not used as the reconciliation
comparator.

The registry audits the physical product schema, including all headers and the
available characteristic triplets, and records every non-empty product row.
`Код_товару` is the primary duplicate key. A repeated code is reported as an
`EXISTING_CODE_COLLISION`; neither occurrence is changed and the code cannot be
reused by a delta row. A code occurring once is `ALREADY_EXISTS`. The registry
also retains the row number, Prom identifiers when present, source URL,
localized titles, group/category data, and image URLs for traceability.

New rows are reserved transactionally with `RESERVED_FOR_IMPORT`, so a process
restart or concurrent worker cannot reserve the same code twice. A reservation
can be confirmed by explicit registry-id/code subset or by a batch id. The
durable lifecycle states are `EXISTING_IN_PROM`, `RESERVED_FOR_IMPORT`,
`CONFIRMED_IN_PROM`, `IMPORT_FAILED`, and `IMPORT_REVIEW`; collision rows stay
visible and are never suffixed or overwritten.

The delta writer copies the selected master workbook to a new output path and
writes only the header and new rows on `Export Products Sheet`; existing
product rows are excluded from the delta. It writes the complete physical
product width from the source template, preserves the complete group sheet,
and validates that the source/master workbook remains unchanged. The
physical-column policy classifies every source column as
required, source-derived, generated, category-derived, optionally verified,
Prom-assigned-after-import, or intentionally blank. Prom-assigned product IDs,
unique IDs, product URLs, and ProSale fields stay blank for new rows.

The Google Drive bridge is operator-assisted. It creates a task containing the
five canonical photo roles, deterministic filenames, local file hashes, and
the configured folder IDs. An operator imports a publication artifact after
uploading the exact files with public read access. The artifact must contain
five unique Drive file IDs, SHA-256 values, roles, filenames, and supplied
public HTTPS image URLs. No URL is synthesized for Excel and no local path is
accepted as a public URL. URL byte/content verification is performed through
an injected probe so automated tests remain offline.

Drive destinations are stored in local SQLite project/runtime state by
`saveGoogleDriveMediaConfig` and loaded by the publication bridge. An explicit
configuration passed to a task is an intentional override. No user folder ID
is hardcoded in the publication business logic.

The bridge does not provide a paid or live image-generation/upload provider.
If market evidence, category mapping, or public media publication is missing,
the production cycle remains in its explicit waiting state and no final Excel
file is created.
