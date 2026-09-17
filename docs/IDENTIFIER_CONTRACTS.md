# Identifier Contracts

Status: first identifier-contract phase on `refactor/identifier-contract-v1`.

This document records existing identifier behavior. It does not introduce a new business policy or redesign product, supplier, Prom, pricing, category, or photo identifiers.

## Identifier concepts

- Supplier/source code or SKU: the identifier supplied by the source system.
- Prom `Код_товару`: the product code used by the Prom workbook.
- Prom `Ідентифікатор_товару`: the Prom-facing product identifier.
- Numeric `Унікальний_ідентифікатор`: a numeric workbook identifier with its own import contract.
- Supplier page ID: an identifier for a source page, not necessarily a product code.
- Category/group IDs: identifiers for taxonomy records.
- Photo keys: identifiers used to associate files with products.

## Audited behavior

| Area | Observed behavior | Decision |
| --- | --- | --- |
| `excel-work/inspect-product-row.mjs` | Exact `String(value ?? '').replace(/^U/iu, '').replace(/U$/iu, '')` normalization for read-only code matching | Centralized |
| `tests/golden/extract-real-goldens.mjs` | The same exact outer-`U` normalization for selecting a golden source row | Centralized |
| Strict final builders | Clean input, strip outer `U`, convert to `Number`, then write/wrap output | Keep local; business-sensitive |
| Legacy repairs | Trim, strip outer `U`, and convert to `Number` | Keep local; business-sensitive |
| Selectors | Trim and apply workflow-specific normalization | Keep local; semantics differ |
| Direct wrapping/numeric output | Construct or convert business-facing identifiers | Keep local; policy-sensitive |
| Photo utilities | Sanitize identifiers for file keys and paths | Keep local; file-key semantics differ |

## Shared contract

`src/contracts/product-identifiers.mjs` exposes `stripOuterU(value)`, preserving the two audited read-only call sites exactly:

- `null` and `undefined` become `''` through `String(value ?? '')`.
- One leading and one trailing `U` are removed, case-insensitively.
- Internal `U` characters are preserved.
- Whitespace is preserved; the helper does not trim.
- Numeric input is stringified and returns a string.

This is a normalization helper, not a rule for generating or publishing identifiers.

## Deliberately local behavior

The following behaviors were not merged because they have different semantics or business risk:

- wrapping values in `U...U`;
- `Number`, `parseInt`, or `String(Number(...))` conversion;
- trimming before or after normalization;
- `replace(/^U|U$/g)` variants;
- leading-zero handling;
- selecting or repairing malformed identifiers;
- category/group identity;
- supplier page identity;
- photo and filename keys;
- workbook row positions.

## Risks and future candidates

Numeric conversion can lose leading zeros. `U123U`, `123`, and a numeric value may look similar while representing different concepts. Existing `Код_товару` policies also differ between workflows, and clean-before-normalization is not equivalent to the exact helper above. Digits must not be treated as interchangeable merely because they match.

Further extraction should wait for explicit business and fixture evidence. Any future policy should be named by concept and validated independently; this phase adds no new generation, wrapping, leading-zero, or import policy.

No generated identifiers, product codes, workbook values, or golden fixtures are changed by this phase.
