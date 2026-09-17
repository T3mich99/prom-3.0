# Category Resolver v1

Status: deterministic requested-category to UG-OPT source-category resolution
on `feature/category-resolver-v1`.

## Scope and separate concepts

The resolver handles only this boundary:

```text
Human requested category
        |
        v
UG-OPT source category
        |
        v
PR #11 category adapter input
```

These concepts remain separate:

- **Requested category:** the human input, such as `Фени`.
- **Source category:** the real UG-OPT name and URL selected from the supplied
  source catalog.
- **Prom category assignment:** the later category/group decision written to
  Excel. This resolver never performs that assignment.

## Catalog source and live discovery

The repository audit found hardcoded UG-OPT category URLs in historical
selectors, but no committed, tested, reusable UG-OPT navigation/index parser or
HTML fixture that proves a stable live catalog structure. To avoid inventing a
supplier selector, live catalog discovery is intentionally deferred.

v1 therefore accepts a validated category catalog as an injected argument:

```js
[
  {
    supplier: 'ug-opt',
    sourceCategoryName: 'Фени',
    sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g38298691-feny',
    parentNames: ['Усе для укладання Волосся'],
  },
]
```

The catalog may be empty and still valid. A malformed catalog is a
`CategoryCatalogError`, distinct from a valid catalog that simply has no match.
No network, filesystem, environment, or web search is used by the resolver.

## Runtime request and output

Input supports one or many categories and does not require source URLs:

```js
{
  categories: [
    { requestKey: 'hair-dryers', requestedName: 'Фени', limit: 20 },
    { requestKey: 'curlers', requestedName: 'Плойки', limit: 15 },
  ],
  totalLimit: 35,
}
```

The resolver preserves category order, every supplied `limit`, and
`totalLimit` without coercion or mutation. A result contains the same top-level
request fields plus resolved category results and:

```js
summary: {
  requestedCount,
  resolvedCount,
  notFoundCount,
  ambiguousCount,
}
```

Resolved output contains `requestKey`, `requestedName`, the unchanged `limit`
when supplied, `resolution: 'resolved'`, and:

```js
resolvedCategory: {
  supplier: 'ug-opt',
  sourceCategoryName,
  sourceCategoryUrl,
  parentNames,
}
```

Only `parentNames` supplied by the catalog is retained; hierarchy is never
fabricated. The output fields are directly usable to construct the PR #11
adapter request by adding the adapter's candidate collection stage.

## Matching policy

Matching is deterministic and uses no LLM, embeddings, fuzzy distance,
translation, transliteration, aliases, or business synonym table.

Normalization is used only for comparison: outer whitespace is trimmed,
repeated internal whitespace is collapsed, and comparison is case-insensitive
with Unicode-aware Ukrainian casing. The original requested name and supplier
name/URL are returned unchanged.

Resolution order:

1. A unique exact normalized name match resolves with `match.kind: 'exactName'`.
2. If there is no exact match, a unique conservative token-containment match
   resolves with `match.kind: 'uniqueTokenContainment'`. Every request token
   must occur as a complete token in the source name.
3. Multiple plausible matches return `resolution: 'ambiguous'` and
   catalog-order `alternatives`.
4. No match returns `resolution: 'notFound'`.

An exact match always wins over broader containment candidates. The resolver
never guesses when several supplier categories remain plausible.

## Duplicates and URL safety

Repeated navigation entries with the same exact source URL are retained only
at their first occurrence. Entries with the same visible name but different
URLs are not collapsed; they remain ambiguous when requested.

Every catalog URL must be an absolute HTTP(S) URL with the exact proven
hostname `ug-opt.in.ua`. External hosts, localhost, loopback addresses,
`javascript:`, and `mailto:` URLs are rejected as catalog failures. The exact
supplier URL string is preserved in output rather than rewritten.

## Failure and integration boundaries

`notFound` means the catalog loaded successfully but no source category
matched. `ambiguous` means more than one plausible source category remains.
Catalog validation failure is a separate thrown `CategoryCatalogError`; it is
never converted into many category-level `notFound` results.

This PR does not call the PR #11 adapter, Product Selector, or any final
orchestrator. It does not assign Prom categories/groups or touch pricing,
identifiers, Excel, content, photos, publishing, or golden fixtures. A later
PR may add a real UG-OPT catalog loader once a stable navigation contract is
captured and tested, then connect resolver output to the adapter and selector.
