# Pricing Golden Matrix

This matrix records real historical pricing outputs from the current repository. It is deliberately not a recommendation for a future canonical pricing policy.

## Historical implementations

| Implementation | Source artifact | Formula/assumptions captured | Delivery | Rounding |
|---|---|---|---:|---|
| `root-price-engine` | `outputs/prom-product-factory-2026-08-23/Prom-final-products.xlsx` plus its source snapshot | dropship markup `1.3`, safety margin `5%`, fallback commission `12.5%`, additional rates `0.07 + 0.05 + 0.03 + 0.02`, tiered multiplier/minimum-profit, commercial anchors and hard floor | not separately recorded | commercial anchor / ceiling floor |
| `apply-price-rule` | `outputs/prom-product-factory-2026-08-25/pricing-rule-report.json` and `Prom-UGOPT-100-final-price-rule.xlsx` | tiered markup or minimum-profit branch, commission from row, expected-profit formula `(purchase + minProfit + delivery) / (1 - commission)` | expected `105`; worst-case report `120` | `Math.ceil` |
| `strict-photo-price` | `outputs/home-misc-next-100-2026-09-01/prom-photo-price-fixed-qa-2026-09-02.json` | `purchase × 1.90 / 0.80`, fixed `20%` commission orientation, retail step `5` below `100` and `10` from `100` | none recorded in this QA trace | retail step rounding |

## Root price engine

The real source snapshot identifies product code `51149` with purchase price `85`; the corresponding historical standard export row uses export code `U2992754039U` and final price `349`.

| Source code | Export code | Purchase | Commission rate | Protected cost | Target price | Hard floor | Final price |
|---|---|---:|---:|---:|---:|---:|---:|
| `51149` | `U2992754039U` | 85 | 12.5% | 116.03 | 349 | 335 | 349 |

## Delivery-inclusive tiered rule

Values below are copied from the historical pricing QA report. Floating-point values are retained exactly as serialized by that report; they are not normalized.

| Code | Purchase | Commission | Markup | Min profit | Price by markup | Price by min profit | Final | Net expected | Net worst |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `0149` | 2200 | 14.48% | 50% | 700 | 3300 | 3513.797942001871 | 3514 | 700.1727999999998 | 685.1727999999998 |
| `34621` | 230 | 13.30% | 150% | 0 | 575 | 386.3898500576701 | 575 | 163.52499999999998 | 148.52499999999998 |
| `34668` | 25 | 14.91% | 200% | 0 | 75 | 152.779410036432 | 153 | 0.18770000000000664 | -14.812299999999993 |
| `34722` | 50 | 10.93% | 200% | 0 | 150 | 174.0204333670147 | 175 | 0.8725000000000023 | -14.127499999999998 |

The negative worst-case values are preserved evidence of the historical `120` delivery report, not an approval of that policy.

## Strict photo-price rule

These real cases come from the current-photo QA report. The report records five photo links for each case and target Drive folder `1ON7z6_MnJwGCiM1w9wvjYNUynWRbHO5g`.

| Code | Purchase | Commission | Raw price | Final price | Commission amount | Net profit | Net profit % | Photos |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `35214` | 35 | 20% | 83.13 | 85 | 17 | 33 | 94.29% | 5 |
| `36122` | 100 | 20% | 237.5 | 240 | 48 | 92 | 92% | 5 |
| `36106` | 60 | 20% | 142.5 | 150 | 30 | 60 | 100% | 5 |

No delivery charge is recorded in this strict QA trace. That absence is part of the captured evidence and must not be silently merged with the delivery-inclusive rule.

## Regression policy

The machine-readable source is `tests/fixtures/golden/pricing-cases.json`. `tests/golden/pricing-golden.test.mjs` evaluates the current production helper functions and compares their outputs to these cases. A failure means pricing behavior changed; it does not authorize changing the matrix. Any update must identify the historical source artifact, the policy being changed, and the business decision that approves the new expected values.
