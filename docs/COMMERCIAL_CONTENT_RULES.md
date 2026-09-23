# Commercial Content Rules v2

This document defines the commercial Prom.ua content profile layered on top of
the existing Content Artifact v1 and Content Quality contracts. It improves
sales usefulness and adds a mandatory editorial gate. Deterministic code still
cannot prove a guaranteed conversion, but content cannot be marked ready merely
because it has enough characters and headings.

## Artifact and authority

The artifact shape is unchanged:

```js
{
  productKey,
  version,
  content: {
    title: { ru, ua },
    description: { ru, ua },
    keywords: { ru, ua },
    characteristics: [{ name, value }],
  },
  sourceFacts,
  claims?,
}
```

`sourceFacts` remains the only factual authority. `sourceText` is contextual
wording only and cannot establish a brand, model, number, material, function,
or other product fact. Economic metadata is rejected before it can reach the
provider-neutral content generator.

## Title standard

Titles follow this commercial order where the facts are verified:

```text
product type + main feature + brand + useful characteristics + color
```

The title starts with the product type. A verified brand is required when present
in `sourceFacts`; unknown elements are omitted. Model names and model numbers
are forbidden in titles and descriptions, even when verified. This includes
headings and specification sections inside descriptions. Keep source model facts
for internal product identity; do not remove the genuine brand. Known model
values (including localized values and separator variants) trigger REWORK.
Numeric characteristics must remain traceable to `sourceFacts`. Price, promotion, supplier metadata, unsupported
claims, and obvious repeated-token stuffing are rejected.

Supplier exports sometimes place a full warehouse title in `sourceFacts.type`,
including a code, a unit marker, or Ukrainian wording in the RU slot. That
value remains factual authority for identity and claims, but the editorial
structure check uses only a short readable type cue when the value is suitable
for public wording. Internal feed noise is never copied into a title or
description merely to satisfy the checker.

The validator does not claim to replace a literary editor or guarantee a sale.
The repository now treats literary and creative quality as a required production
gate: it enforces objective signals of a human marketplace text, and any
rejected condition requires content rework before the product can continue to
photos or Excel. A text that merely has enough characters, headings, or
keywords is not ready.

## Description standard

The description begins with a concrete buyer outcome, use scenario, solved
problem, or practical benefit. It then uses category-appropriate sections:

1. opening commercial paragraph;
2. `Переваги` / `Преимущества`;
3. `Особливості` / `Особенности`;
4. `Підходить для` / `Подходит для`;
5. `Характеристики`.

The existing hard minimum remains 1000 visible characters after the current
HTML visibility calculation. The preferred 1300–2000 range is advisory only;
being outside it does not create `REWORK` by itself. The commercial validator
rejects an obvious completeness section with headings such as `Комплектація`,
`Комплектация`, `Комплект поставки`, `Что входит в комплект`, or `Що входить
у комплект`. An ordinary word such as `комплект` inside legitimate prose is
not rejected automatically.

No `Комплектація`/`Комплектация` block is requested by the generation prompt,
even when package facts exist. Characteristics retain exact verified values;
units are not converted.

## Editorial quality gate

Every Russian and Ukrainian title and description is checked by
`commercial-editorial-v1` after generation and after every rework. The gate
requires:

- independent language versions with correct grammar and natural word choice;
- no recognizable words from the other language, literal translation, awkward
  calques, warehouse noise such as `шт`, or incomplete purpose phrases;
- a readable title that identifies the product without an empty slogan;
- an opening description sentence that identifies the verified product type and
  gives a concrete buyer benefit or use situation;
- several complete sentences with product-specific wording;
- no reusable boilerplate such as `практичный товар для`, `практичний товар
  для`, `товар помогает организовать уход или тренировку`, `название сразу
  показывает основное назначение`, or `опис товара помогает покупателю`;
- no title that names only a generic class such as `массажер`, `масажна
  подушка`, `кисть`, or `засіб` without a verified use, zone, feature, or
  other buyer-relevant cue;
- commercial paragraphs before `Характеристики` must contain verified product
  facts. Ukrainian copy exposes two characteristic cues when the source has
  them; Russian copy exposes at least one localized product cue because the
  shared characteristic array may retain Ukrainian values;
- each batch must use different opening arguments. Exact opening reuse is a
  rework error, and semantic repetition is reviewed by the operator before
  export;
- a distinct commercial argument grounded in `sourceFacts`, with no inflated
  promises or unsupported features.

The public copy follows this order for every product, adapted to its actual
category and facts:

1. a clear reason to buy and a concrete use situation;
2. one or more natural paragraphs explaining the product's verified features;
3. `Переваги`/`Преимущества` with buyer-facing benefits tied to those facts;
4. `Кому підійде`/`Кому подойдет` with realistic use scenarios;
5. `Характеристики` with the complete source values;
6. a short practical closing that helps the buyer make the final choice.

Descriptions must not begin with a dry definition such as “товар призначений
для”. A category-specific argument is required: support products explain
support and fit, fitness products explain the training scenario, beauty tools
explain the procedure, massage products explain the zone and format, and home
goods explain the household task. Model identifiers stay out of public copy;
verified brands may remain in the title.

The result exposes `editorialGate` with its profile, status, criteria, and issue
codes. Editorial issues are attached to the affected `title` or `description`
field, so `reworkPlan` sends only the defective field back to the generator.
`READY` means that the deterministic editorial checks passed; it does not claim
that software can mathematically guarantee that every reader will buy.

## Keywords standard

`keywords.ua` and `keywords.ru` are independent comma-separated search phrase
lists. The commercial defaults are:

- 25–35 phrases per language, inclusive;
- 800–1000 characters per language, inclusive;
- no exact duplicate phrases;
- no obvious UA/RU mixing;
- no price, supplier, internal, or unsupported model/number metadata.

The validator checks these boundaries and traceable numeric/model facts. It does
not claim semantic SEO intelligence or a perfect language classifier: language
mix detection uses conservative script/letter markers and may only establish
an objective warning when those markers are present.

The lower-level Content Quality contract remains backward-compatible at 25+
phrases and 800–1024 characters. Commercial readiness is stricter and is
provided by `validateCommercialContentArtifact`.

## Commercial validator

```js
validateCommercialContentArtifact(artifact, {
  policy: {
    keywords: {
      maximumPhrases: 35,
      maximumCharacters: 1000,
    },
  },
})
```

The validator first runs `validateContentArtifact`, then adds deterministic
commercial and editorial checks. It returns `READY`, `REVIEW`, or `REWORK`, keeps
the base quality result, reports `{ field, code, severity, details }` issues,
exposes the `editorialGate`, and emits a field-level `reworkPlan`. Status
precedence remains:

```text
REWORK > REVIEW > READY
```

Commercial checks never upgrade a base `REWORK` or `REVIEW` result. Hard,
defensible failures include weak traceable title structure, generic class-only
titles, unsupported traceable model/numeric facts, forbidden completeness
headings, keyword count or length boundaries, duplicate phrases,
language-marker mixing, economic metadata, mixed-language title/description
text, boilerplate, weak openings, missing verified facts in the commercial
argument, and warehouse unit noise. Subjective claims such as “persuasive” or
“professional” are not pretended to be measurable; the prompt and gate turn
that requirement into concrete buyer-benefit, language, clarity, fact-grounded
and distinct-argument checks. Unsupported claims remain governed by the base
claims authority.

## Generation and rework

`generateContentArtifact` evaluates the commercial profile and editorial gate by
default. The provider-neutral prompt now requires both language versions,
independent proofreading, the title order, a concrete buyer-benefit opening,
product-specific wording, no completeness block, and 25–35 natural phrases
targeted to 800–1000 characters. The compatibility profile
`base-v1` is available for callers that explicitly need the pre-commercial
quality behavior.

`reworkContentArtifact` uses the active quality result and sends only fields in
its field-level `reworkPlan`. A title-only, description-only, or keywords-only
failure therefore reworks only that field. Accepted fields remain unchanged,
the artifact version increments once after a successful non-empty replacement,
and stale or forged quality results are rejected before the generator runs.

## Compatibility and scope

Commercial content keeps the existing Content Artifact schema and passes exact
strings through the existing Content → Excel Row Adapter. Excel schema,
characteristic columns, and the Adaptive Writer are unchanged. `READY` content
remains compatible with the PR #20 photo plan, which continues to own photo
quality and structural fidelity.

Pricing, market research, ranking, categories, identifiers, UG-OPT scraping,
photos, Drive, Prom publishing, Excel schema/writer behavior, dependencies,
and golden fixtures are outside this PR.
