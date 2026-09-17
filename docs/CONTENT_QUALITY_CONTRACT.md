# Content Quality Contract v1

This contract is a deterministic boundary between a future content generator and
the existing Prom/Excel workflows. It does not generate text, make pricing or
category decisions, validate photos, or write workbooks.

## Artifact

The v1 artifact has this shape:

```js
{
  productKey: 'ugopt:12345',
  version: 1,
  content: {
    title: { ru: '...', ua: '...' },
    description: { ru: '...', ua: '...' },
    keywords: { ru: 'phrase, phrase', ua: 'фраза, фраза' },
    characteristics: [{ name: 'Матеріал', value: 'Пластик' }],
  },
  sourceFacts: { power: '2200 Вт' },
  claims: [{ field: 'power', value: '2200 Вт', contentField: 'description' }],
}
```

RU and UA remain separate because the repository's Prom contract has separate
language-specific title, description and keyword fields. Keyword order and
text are never normalized or rewritten by this contract. `sourceFacts` is
optional, is never mutated, and is the only evidence used for explicit
structured claim checks. Claims are not inferred by parsing prose.

Only `title`, `description`, `keywords` and `characteristics` are supported
content fields. An unknown content field or replacement field is an error.

## Statuses and quality policy

Each field is `READY`, `REVIEW`, or `REWORK`. Product precedence is:

`REWORK` > `REVIEW` > `READY`.

`READY` means that the deterministic checks in this version passed. It does not
mean human-approved copy, perfect SEO, maximum conversion, or subjective
excellence. `REVIEW` is used for absent characteristics and unverified explicit
claims. `REWORK` is used for objective structural or threshold failures.

The default policy is configurable only through an explicit validated object:

- visible description minimum: 1000 characters;
- description guidance: approximately 1300–2000 characters, advisory only;
- each RU/UA keyword field: 800–1024 characters and at least 25 comma-separated
  phrases;
- exact duplicate keyword spam above a 50% ratio is `REWORK`;
- exact duplicate characteristic name/value rows are `REWORK`.

Descriptions are measured after removing HTML tags and decoding the small set
of common entities used by the current export. Repeated identical sentences,
control characters, missing values, empty keyword terms, and malformed
characteristic rows are deterministic failures. No language detector or
subjective sales-quality score is used.

## Rework

`applyContentFieldRework(originalArtifact, replacements)` is pure. It accepts
only the four supported fields, replaces only fields explicitly present in the
replacement object, preserves `productKey` and `sourceFacts`, and increments
`version` exactly once when at least one field is replaced. An empty replacement
object is a no-op and keeps the version unchanged. The input artifact and
source facts are not mutated.

The quality result contains a deterministic `reworkPlan` in canonical field
order. It includes only `REWORK` fields and their issue codes; `REVIEW` fields
are intentionally excluded.

Existing content generators, Excel exporters, category/pricing/identifier
logic, photo workflows, fixtures and golden oracles are not changed by v1.
