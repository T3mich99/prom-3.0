# Market Pricing + Profitability Ranking v1

This document describes the additive market-aware pricing domain in
`src/pricing/market-pricing.mjs`. It does not replace or normalize the
historical pricing scripts. Those scripts and their golden fixtures remain
regression evidence for their original behavior.

## Boundary and candidate pool

`evaluateProductPricing(product, { researcher, commission, policy })` evaluates
one UG-OPT candidate. `evaluatePricingBatch(products, options)` evaluates an
arbitrary candidate pool independently, including 1, 100, 1000, or more
products. The market researcher is injected and provider-neutral; PR #22 does
not add a live marketplace scraper or a network dependency.

The supplier purchase price is authoritative only when it is supplied in the
product's `supplier.purchasePrice` object with provenance. The domain never
infers purchase price from a listing, RRP, title, or description. The expected
supplier currency is UAH. Unsupported supplier or market currencies are
reviewed; no FX conversion is performed.

## Policy

`resolvePricingPolicy()` validates an explicit policy. Profitability rules are
configuration data, not hidden production constants. Rules may specify a
purchase-price range and one or more of `minimumNetProfitMinor`,
`minimumRoiBps`, and `minimumNetMarginBps`. Overlapping ranges are rejected as
ambiguous configuration. The default policy deliberately has no profitability
rule, so automatic production approval requires an explicit business policy.
`minimumNetMarginBps` must be below `10000` (100%); ROI has no artificial 100%
cap. If the configured constraints cannot be satisfied within the safe integer
money domain, the result is explicitly unreachable rather than an unbounded
search.

The policy also declares evidence thresholds, accepted sources, the active
listing rule, target market position, price step, allowed market ceilings,
ranking order, and publication capacity. The hard publication maximum is
6000; a policy cannot raise it.

## Market evidence and exact comparability

The injected researcher returns:

```js
{
  productKey,
  comparables: [{
    source, listingId, url, seller, title, price, currency, available,
    brand, model, productIdentityEvidence, matchType, matchConfidence
  }]
}
```

Every accepted comparable has a source and either a listing identifier or a
canonical URL. Exact duplicate listing identities are rejected using
`source + listingId` or canonical URL. Invalid price, non-positive price,
unsupported currency, unavailable listing, disallowed source, and missing
identity evidence are retained in rejection diagnostics rather than silently
discarded.

When verified brand and model are present, only an explicit `matchType:
'exact'` comparable with the same normalized brand/model is accepted. A model
mismatch is never treated as a category-level match. Without a model, the
provider must supply explicit high-confidence identity evidence. The pricing
engine does not invent semantic similarity, translate model names, or use an
LLM.

## Statistics and confidence

The decision exposes accepted/rejected counts, exact count, minimum, maximum,
median, lower quartile, upper quartile, accepted evidence, rejection reasons,
source count, and confidence. Median and quartiles use deterministic sorted
integer minor units; quartiles are medians of the lower and upper halves. v1
uses the policy's `outlierPolicy: { method: 'none' }` and therefore does not
pretend to remove outliers. Statistics describe only the supplied accepted
sample, not the entire internet.

Confidence is `HIGH`, `MEDIUM`, `LOW`, or `INSUFFICIENT` from explicit policy
thresholds for accepted count, exact count, and source diversity. Uncertain or
insufficient evidence normally produces `PRICE_REVIEW`, not `SKIP`.

## Commission, money, and profitability

Commission is caller/configuration data:

```js
{
  rateBps,
  source,
  categoryId,
  provenance
}
```

There is no universal 15% fallback. Missing commission produces
`PRICE_REVIEW` with `COMMISSION_UNKNOWN`. Commission amount uses integer
minor-unit arithmetic and deterministic half-up rounding:

```text
commissionMinor = floor((sellingMinor × rateBps + 5000) / 10000)
```

The commission contract is explicit: `0 <= rateBps < 10000`. Zero is valid only
when supplied by the caller; `10000` bps is invalid because a 100% commission
leaves no economically meaningful selling-price domain for this engine.

Only explicitly supplied additional costs are included. No shipping,
advertising, tax, or other cost is invented.

```text
netProfit = sellingPrice - commissionAmount - purchasePrice - explicitCosts
roiPct = netProfit / purchasePrice × 100
netMarginPct = netProfit / sellingPrice × 100
```

The artifact exposes integer `roiBps` and `netMarginBps`, plus formatted
percent strings. The minimum selling price required for the configured profit
rule is calculated before the competitive ceiling check.

## Competitive price and statuses

The strategy is explicit in `pricing.strategy` and can target lower quartile,
median, or upper quartile, with a configured price step, undercut, and market
ceiling. The competitive ceiling is a hard invariant applied after strategy
selection and price-step rounding: a returned recommended price can never be
above it. If no stepped price satisfies both the ceiling and every configured
profitability constraint, the product is `SKIP` with an explicit reason such as
`REQUIRED_PRICE_ABOVE_MARKET` or `PRICE_ABOVE_COMPETITIVE_CEILING`; the engine
never raises a product arbitrarily above the market just to satisfy profit.

`READY` requires reliable evidence, known commission, supported UAH economics,
an applicable profitability rule, a competitive price, and satisfied policy
requirements. `PRICE_REVIEW` represents uncertainty or missing configuration,
including insufficient/ambiguous evidence, weak confidence, missing
commission, unsupported currency, and an unconfigured profit policy. `SKIP`
is reserved for sufficiently evidenced unattractive economics such as a
required price above the competitive ceiling, negative net profit, or a
failed explicit profitability rule.

## Ranking and TOP-6000 selection

`rankPricingDecisions(decisions, { policy })` applies a stable lexicographic
order. Status precedence is a domain invariant and must remain first:
`READY > PRICE_REVIEW > SKIP`. The policy may reorder only the economic factors
after status. The default then compares net profit, ROI, net margin, market
confidence, and finally `productKey`. Ranking components are exposed; there is
no opaque composite score. Duplicate product keys are a contract error.

`selectTopProfitableProducts(decisions, { policy, maxProducts })` ranks first,
selects READY products only by default, and returns `selected`,
`notSelectedReady`, `review`, and `skip` together with all counts and remaining
capacity. It never pads a short result with review or skipped products. A
stronger new candidate naturally displaces a weaker candidate after a full
re-rank. This domain does not delete or disable Prom products.

## Determinism, immutability, and limitations

The domain returns no timestamps or random identifiers, clones caller-owned
inputs before provider calls, and does not mutate products, evidence, policy,
commission configuration, or decisions. Provider failures are operational
`MARKET_RESEARCH_FAILURE` errors; malformed provider responses are explicit
contract errors and are never converted to `SKIP`.

PR #22 does not change Excel selling-price behavior, Content Row Adapter,
photos, categories, identifiers, Product Selector, historical formulas,
historical golden fixtures, or daily supplier-availability monitoring. Excel
integration and live market-research wiring belong to a later integration
step.
