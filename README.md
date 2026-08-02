# investscape-api

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
