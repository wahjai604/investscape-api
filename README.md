# InvestScape API

**Repository:** https://github.com/wahjai604/investscape-api
**License:** Proprietary (Closed-Source) — see [LICENSE](LICENSE)
**Copyright:** © 2026 Lighthouse Research Ltd.

## Purpose

An Express + TypeScript HTTP API that exposes `investscape-calc-engine` and `investscape-economic-engine`'s calculation functions over HTTP.

## Scope

45 endpoints: `GET /health` plus 44 `POST /calculate/*` routes.

- **28 financial routes** (from `@investscape/calc-engine`, E1–E28): `/calculate/mortgage`, `/calculate/exit`, `/calculate/qualify`, `/calculate/dscr`, `/calculate/cashflow`, `/calculate/returns`, `/calculate/capitalstack`, `/calculate/portfolio`, `/calculate/amortization`, `/calculate/cmhc`, `/calculate/ptt`, `/calculate/break-even`, `/calculate/appreciation`, `/calculate/refinance`, `/calculate/scenario`, `/calculate/brrrr`, `/calculate/holding-period-sensitivity`, `/calculate/tax-optimization`, `/calculate/data-provenance`, `/calculate/fx-conversion`, `/calculate/rental-waterfall`, `/calculate/property-tax`, `/calculate/opex-benchmark`, `/calculate/insurance-estimation`, `/calculate/lender-scorecard`, `/calculate/amortization-display`, `/calculate/chart-data`, `/calculate/sales-appreciation`
- **16 of 17 economic routes** (from `@investscape/economic-engine`, E29–E45): `/calculate/regional-macro`, `/calculate/city-market`, `/calculate/neighborhood-demographics`, `/calculate/comparable-sales`, `/calculate/rental-comps`, `/calculate/school-ratings`, `/calculate/walkability-transit`, `/calculate/market-velocity`, `/calculate/macro-micro-sensitivity`, `/calculate/mortgage-rate-forecast`, `/calculate/appreciation-probability`, `/calculate/market-cycle`, `/calculate/neighborhood-investment-score`, `/calculate/portfolio-geo-diversification`, `/calculate/currency-risk`, `/calculate/scenario-batch`. **E36 (crime & safety) is implemented in the economic engine but is not exposed here**, pending legal review.

## Testing

**No automated test suite currently exists in this repo** (`npm test` has no script). Test coverage for the underlying calculation logic lives in `investscape-calc-engine` and `investscape-economic-engine`, which this API wraps and re-exposes without independent test coverage of the HTTP layer itself.

## Authentication

**No authentication is currently implemented on any endpoint.** All routes are open. `cors()` and `express.json()` are the only middleware in place. Do not expose this API publicly without adding an auth layer.

## Installation

For authorized users only. Usage requires a valid InvestScape tier (S1–S3).

This repo depends on sibling repos via local `file:` dependencies — `investscape-calc-engine` and `investscape-economic-engine` must be checked out alongside it (as siblings in the same parent directory).

```bash
npm install
npm run dev    # hot-reload dev server (tsx watch)
npm run build  # compile to dist/
npm start      # run compiled server
```

## Architecture

`src/index.ts` boots Express, mounts `cors` and `express.json()`, exposes `GET /health`, and mounts the router from `src/routes/index.ts`. Each `/calculate/*` route lives in its own file under `src/routes/` (financial) or `src/routes/economic/` (economic), and calls into the corresponding engine package. Dependency direction is a clean DAG: `investscape-api` → `investscape-economic-engine` → `investscape-calc-engine`; no circular dependencies.

## Documentation

Reference documentation: https://github.com/wahjai604/investscape-docs

## License & Disclaimer

This software is closed-source proprietary code. Authorized users only.

For legal disclaimers, see [DISCLAIMER.md](DISCLAIMER.md).

---

© 2026 Lighthouse Research Ltd. All rights reserved.
