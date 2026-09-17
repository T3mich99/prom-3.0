# UG-OPT Category Catalog v1

## Scope

This layer discovers the supplier-owned category navigation for the existing
category resolver. It produces resolver-compatible entries and does not select
products, assign Prom categories, or perform any pricing, content, Excel, or
photo work.

## Proven source and markup

The catalog source is `https://ug-opt.in.ua/ua/`. The live server-rendered
homepage exposes the full catalog under the heading `Групи товарів та послуг`:

- `ul.cs-product-groups-list` contains the top-level group items;
- `li.cs-product-groups-list__item` contains a parent link with
  `a.cs-product-groups-list__title`;
- nested `ul.cs-product-groups-list__sublist.cs-product-subgroups` contains
  child links in `li.cs-product-subgroups__item` with
  `a.cs-product-subgroups__title`.
- nested `cs-product-subgroups__hidden-list` elements remain inside that same
  subgroup container; their category items are also parsed.

This is distinct from `cs-menu__sub-nav`, which contains only the site's
top-level navigation and is not sufficient for a complete category catalog.
The parser reads only the proven product-groups container, never arbitrary
page links or product cards. It accepts only exact-host HTTP(S) category URLs
on `ug-opt.in.ua` whose Ukrainian path has the supplier's
`/ua/g<number>-slug` category shape. Product, account, cart, search,
informational, external, script, mail, telephone, and fragment links are
ignored.

The nested subgroup list structurally proves parent-child relationships, so
child entries include `parentNames` containing their direct parent name.

## Output and guarantees

Each entry has this shape:

```js
{
  supplier: 'ug-opt',
  sourceCategoryName: 'Фени',
  sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g38298691-feny',
  parentNames: ['Усе для укладання Волосся']
}
```

Parent groups are emitted before their children, and source order within each
supplier group is preserved. A repeated exact URL is retained only at its
first occurrence. Equal visible names with different URLs remain separate,
allowing the resolver to report ambiguity instead of guessing.

If the expected product-groups container exists but has no valid category
entries, parsing fails explicitly. A changed class or link structure must not
silently become an empty catalog.

`parseUgoptCategoryCatalogHtml` is pure and performs no network or filesystem
access. `loadUgoptCategoryCatalog` performs one injected or global `fetch`, with
no retries, and reports HTTP, network, response-read, and parse failures
explicitly. The loader accepts an explicit source override only when it remains
on the exact UG-OPT Ukrainian host/path family.
