# Excel Contracts

Status: phase 2 of the shared Excel/Prom contract migration on
`refactor/excel-contracts-v2`.

## Technical contract

The shared module `src/contracts/prom-excel.mjs` contains only stable workbook
structure. Phase #2 did not broaden the schema or add validation fallbacks.

- `PROM_SHEETS.PRODUCTS` is `Export Products Sheet`.
- `PROM_SHEETS.GROUPS` is `Export Groups Sheet`.
- `headerIndex(headers, header)` performs an exact first-match lookup with the
  same semantics as `Array#indexOf` and returns `-1` when the header is absent.

The module is pure and deterministic. It does not read files, use network or
environment state, import workbook tooling, or encode business policy.

## Evidence and independent verification

The sheet-name contract is supported by the tracked Prom short template and
the golden snapshots. The independent sources are checked by
`tests/integration/prom-excel-contract.test.mjs` and
`tests/fixtures/golden/strict-ready/snapshot.json`; the contract tests compare
the shared constants against that metadata rather than using the constants as
their only oracle. Header lookup behavior is checked against the independent
`tests/fixtures/prom-contract.fixture.json`, including missing and duplicate
headers.

## Phase #2 evidence and boundary

The phase #2 audit found repeated direct product-sheet access and exact
`headers.indexOf(name)` calls in read-only inspectors. These uses have the same
observable semantics as the shared contract. No stable common required-header
subset or presence helper was selected: required lists, aliases, and failure
handling differ by workflow.

## Migrated low-risk consumers

Only read-only inspectors use the shared contract:

Phase #1:

- `excel-work/inspect-current-headers.mjs`
- `excel-work/inspect-sheet-shapes.mjs`
- `excel-work/inspect-current-workbook.mjs`

Phase #2:

- `excel-work/inspect-product-row.mjs`
- `excel-work/inspect-photo-urls.mjs`
- `excel-work/verify-photo-urls.mjs`

Their workbook inputs, ranges, output, optional QA sheet names, and inspection
behavior remain unchanged.

## Intentionally deferred contracts

The following are not canonicalized because the repository contains real,
workflow-specific differences:

- Full product and group header sets: compact/standard workbooks use Russian
  headers while strict/modern workbooks use Ukrainian headers and additional
  fields.
- Header aliases and language mapping: some consumers accept aliases, while
  others require exact names.
- Required-header lists: content, final-export, category, and other workflows
  require different fields.
- Header-map implementation: consumers use exact `indexOf`, object maps, or
  alias-aware lookup with different duplicate-header semantics.
- Structural validation: consumers use fixed ranges, used ranges, and
  workflow-specific checks.
- Sheet order and auxiliary QA sheets: these are not proven universal across
  all workbook workflows.
- Generic presence or missing-header helpers: no single existing production
  failure/return convention is shared across the workflows audited in phase
  #2.

Builders, pricing, category, identifier, supplier, content, photo, and
publishing workflows remain outside this phase. No product values, prices,
commissions, margins, categories, identifiers, supplier data, keywords,
descriptions, image selection, or fallback policy belong in this technical
contract module.

## Golden regression and fixture relationship

Golden fixtures are regression oracles and are not modified by this phase.
The Prom contract fixture is an independent structural example used to prove
that exact header lookup remains compatible with the existing workbook
contract. Phase #2 did not change workbook-producing scripts or fixture data.
Future shared adapters may be considered only after a specific schema conflict
is resolved and covered by independent fixtures and golden regression checks.
