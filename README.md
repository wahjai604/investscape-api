# InvestScape API

**Repository:** https://github.com/wahjai604/investscape-api
**License:** Proprietary (Closed-Source) — see [LICENSE](LICENSE)
**Copyright:** © 2026 Lighthouse Research Ltd.

## Purpose

An Express + TypeScript HTTP API that exposes `investscape-calc-engine`, `investscape-economic-engine`, and `investscape-tax-engine`'s calculation functions over HTTP.

## Scope

53 endpoints: `GET /health` (bare root, outside version namespace) plus 52 `POST /v1/calculate/*` routes.

**All `/calculate/*` routes are mounted under `/v1`** (`src/index.ts`: `app.use("/v1", router)`), adopted per Doc 62 §2.6 while there was still no real external client depending on the unversioned shapes. `/health` intentionally stays at the bare root — liveness checks conventionally sit outside API version namespaces — and is not reachable at `/v1/health`.

- **28 financial routes** (from `@investscape/calc-engine`, E1–E28): `/v1/calculate/mortgage`, `/v1/calculate/exit`, `/v1/calculate/qualify`, `/v1/calculate/dscr`, `/v1/calculate/cashflow`, `/v1/calculate/returns`, `/v1/calculate/capitalstack`, `/v1/calculate/portfolio`, `/v1/calculate/amortization`, `/v1/calculate/cmhc`, `/v1/calculate/ptt`, `/v1/calculate/break-even`, `/v1/calculate/appreciation`, `/v1/calculate/refinance`, `/v1/calculate/scenario`, `/v1/calculate/brrrr`, `/v1/calculate/holding-period-sensitivity`, `/v1/calculate/tax-optimization`, `/v1/calculate/data-provenance`, `/v1/calculate/fx-conversion`, `/v1/calculate/rental-waterfall`, `/v1/calculate/property-tax`, `/v1/calculate/opex-benchmark`, `/v1/calculate/insurance-estimation`, `/v1/calculate/lender-scorecard`, `/v1/calculate/amortization-display`, `/v1/calculate/chart-data`, `/v1/calculate/sales-appreciation`
- **16 of 17 economic routes** (from `@investscape/economic-engine`, E29–E45): `/v1/calculate/regional-macro`, `/v1/calculate/city-market`, `/v1/calculate/neighborhood-demographics`, `/v1/calculate/comparable-sales`, `/v1/calculate/rental-comps`, `/v1/calculate/school-ratings`, `/v1/calculate/walkability-transit`, `/v1/calculate/market-velocity`, `/v1/calculate/macro-micro-sensitivity`, `/v1/calculate/mortgage-rate-forecast`, `/v1/calculate/appreciation-probability`, `/v1/calculate/market-cycle`, `/v1/calculate/neighborhood-investment-score`, `/v1/calculate/portfolio-geo-diversification`, `/v1/calculate/currency-risk`, `/v1/calculate/scenario-batch`. **E36 (crime & safety) is implemented in the economic engine but is not exposed here**, pending legal review.
- **8 tax routes** (from `@investscape/tax-engine`, E46–E53): `/v1/calculate/tax-aggregation`, `/v1/calculate/personal-income-tax`, `/v1/calculate/depreciation`, `/v1/calculate/mortgage-interest`, `/v1/calculate/operating-expense`, `/v1/calculate/developer-profit`, `/v1/calculate/gst-hst-dev-charges`, `/v1/calculate/passive-activity-loss`

**E54–E67 (Market Intelligence & Statistical Risk, `@investscape/market-intelligence-engine`) exist in a sibling package but are not registered behind this API yet** — no routes exposed, no dependency added here. Registration is Modular Prompt 02's job (proposed file/route list: `investscape-docs` Doc 62 Part 3), itself blocked on open product decisions for `MIOpportunityMetric<T>`'s `status`/`benchmark` field semantics. Full engine reference: `investscape-docs` Doc 63.

## Testing

**No automated test suite currently exists in this repo** (`npm test` has no script). Test coverage for the underlying calculation logic lives in `investscape-calc-engine`, `investscape-economic-engine`, and `investscape-tax-engine`, which this API wraps and re-exposes without independent test coverage of the HTTP layer itself.

## Authentication

**No authentication is currently implemented on any endpoint.** All routes are open. `cors()` and `express.json()` are the only middleware in place. Do not expose this API publicly without adding an auth layer.

## Installation

For authorized users only. Usage requires a valid InvestScape tier (S1–S3).

This repo depends on sibling repos via local `file:` dependencies — `investscape-calc-engine`, `investscape-economic-engine`, and `investscape-tax-engine` must be checked out alongside it (as siblings in the same parent directory).

```bash
npm install
npm run dev    # hot-reload dev server (tsx watch)
npm run build  # compile to dist/
npm start      # run compiled server
```

## Architecture

`src/index.ts` boots Express, mounts `cors` and `express.json()`, exposes `GET /health` at the bare root, and mounts the router from `src/routes/index.ts` under `/v1` (`app.use("/v1", router)`). Each `/calculate/*` route lives in its own file under the flat `src/routes/` directory (E1–E53) and defines its path relative to that mount point — no route file references `/v1` itself. Dependency direction is a clean DAG: `investscape-api` → `investscape-economic-engine` → `investscape-calc-engine`, and `investscape-api` → `investscape-tax-engine`; no circular dependencies.

## Documentation

Reference documentation: https://github.com/wahjai604/investscape-docs

## License & Disclaimer

This software is closed-source proprietary code. Authorized users only.

For legal disclaimers, see [DISCLAIMER.md](DISCLAIMER.md).

---

© 2026 Lighthouse Research Ltd. All rights reserved.
