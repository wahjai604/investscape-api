# investscape-api

## 🔒 Licensing & Intellectual Property

**InvestScape™ Calculation Engine & InvestScape™ Economics Engine** are proprietary software © 2026 Lighthouse Research Ltd.  
**InvestScape™** is a registered trademark of Lighthouse Research Ltd.

### License Summary

| Use Case | Status | License | Fee |
|----------|--------|---------|-----|
| **Personal real estate analysis** | ✅ Allowed | Proprietary License | None |
| **Educational/learning** | ✅ Allowed | Proprietary License | None |
| **Internal business analysis** | ✅ Allowed | Proprietary License | None |
| **Commercial product embedding** | ❌ Prohibited | Requires Commercial License | Case-by-case negotiation |
| **SaaS/service offering** | ❌ Prohibited | Requires Commercial License | Case-by-case negotiation |
| **Redistribution/resale** | ❌ Prohibited | Not permitted | N/A |

**For full license terms, see `LICENSE` and `CONTRIBUTING.md`.**

### Commercial Licensing

If your organization wishes to use InvestScape™ Calculation Engines in a commercial product or service:

1. **Contact:** eric@lighthouseresearch.ca
2. **Subject line:** `[COMMERCIAL LICENSE INQUIRY] — [Your Organization Name]`
3. **Include:**
   - Organization name and industry
   - Intended commercial use
   - Target customer base
   - Estimated revenue/impact
   - Timeline for implementation

**Note:** Commercial licensing is evaluated **case-by-case.** No standard pricing. Substantial business justification required.

### Trademark Use

The name **InvestScape™** and associated trademark symbols (™, ®) are protected intellectual property. You may:
- ✅ Refer to "InvestScape™" when describing the software in non-commercial contexts
- ✅ Use the trademark when attributing calculation results (e.g., "Powered by InvestScape™")

You may NOT:
- ❌ Use the InvestScape™ name or logo to suggest endorsement or partnership
- ❌ Register similar domains or social media accounts using "InvestScape"
- ❌ Use the trademark in a commercial product without permission

---

Express + TypeScript API exposing investscape-calc-engine's calculation functions over HTTP.

## Setup

```bash
npm install
npm link investscape-calc-engine
```

## Scripts

- `npm run dev` — run the server with hot reload (tsx watch)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the compiled server from `dist/`

## Endpoints

### `GET /health`

Returns `{ "status": "ok" }`.

### `POST /calculate/mortgage`

Request body:

```json
{
  "purchasePrice": 500000,
  "downPaymentPercent": 0.2,
  "contractRate": 0.045,
  "amortizationYears": 25
}
```

Response:

```json
{
  "monthlyPayment": 2216.94,
  "qualifyingRate": 0.065
}
```
