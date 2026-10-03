# Native Full API integration plan

Prepared 2026-10-03 UTC. Design preparation only; no runtime integration or deployment.

## Baseline and verified evidence

Repository: wahjai604/investscape-api. Isolated branch: feat/native-full-api-adapter.
Remote master was rechecked against e2a5ddf216a029ec7fc1f4e0d36dc848375bd53f and identical before branch creation.

Railway production currently sources master, with RAILPACK and checkSuites:false. Do not merge or push integration to master as a staging mechanism: the connected branch can deploy independently of this plan.

The deployed commit installs vendor/investscape-calc-engine-1.0.0.tgz. Downloaded archive SHA-512 matches package-lock.json:
6VdHUw0fZf/LhyXE9CUxKNruwIb9bv7N6WL+3i6M/D8ZtFqc3EpQdZVZeUQCIuAs3wHi3bQNB/cl9PNHjDWV2w==

Its UMD and ESM exports include calculateCapitalStack, calculateFinancingTable, calculateBudgetRollup, calculateSourcesUses and calculateAcquisitionStructure. Both distributions independently produced exact complete results against all 249 existing bounded Full golden cases using the extracted Full functions. This is bounded compatibility evidence, not an engine correctness or source-lineage audit.

Package UMD LF-normalized SHA-256:
8617fcb05b31e15ab9da46cc85cc50da179b93319f1eedf01c7f4b65d66a5c47
The embedded reference script has a different fingerprint; do not assert byte identity.

Package E78/E80/E81/E82 contain actual implementations. The inspected existing HTTP route src/routes/E78-financing-table.ts still returns a stub. The new Full operation must directly inject package functions into the shared adapter, not call individual HTTP routes.

Startup observations: engine auth off, session verifier unconfigured, CORS allowlist one origin, rate 600/min per caller with forwarded IP ignored, E85 zoning disabled. These logs are not fresh endpoint verification. No secrets were retrieved.

## Dependencies and release boundary

The corrected shared adapter local checkpoint SHA is pending. No final tarball hash or GitHub availability is established.
Reported package: investscape-dev-calc 0.10.0-p2-6b, CommonJS main src/index.js, private:true, UNLICENSED, no files allowlist.

Before packaging:
1. Confirm corrected checkpoint and source hashes.
2. Review npm pack --dry-run output explicitly.
3. Add or use a reviewed runtime-only packaging allowlist. Include source, package metadata and necessary documentation/license; exclude goldens, parity/build tools, old Quick dist artifacts and tests unless intentionally needed.
4. Record archive SHA-256 and SHA-512 integrity, adapter version and source checkpoint; check install via npm ci in a clean isolated checkout.
5. Preserve current calc vendored archive. Never infer that package version alone verifies engine lineage.
6. Server manifest supplies declared adapter identity and separately verified artifact integrity. The adapter's own caller-declared engine identity remains unverified.

## Proposed isolated changes

- vendor/investscape-dev-calc-<reviewed-version>.tgz
- package.json and package-lock.json
- src/development/engineManifest.ts
- src/development/transport.ts
- src/routes/development/full.ts
- minimal mount in src/routes/index.ts
- focused tests for dependencies, transport, auth and route contract

Do not modify Lighthouse/Relationship OS behavior, existing engine routes, other sessions' changes, Railway production settings or E85 gates.

## Authenticated stateless endpoint

Proposed route: POST /v1/development/full/calculate.
Accept full-adapter-1 requests only. Request inputRevision is a nonnegative JSON-safe integer. No body-supplied user, project-owner or engine identifier grants authority.

New route gate defaults OFF and returns 503 before authentication or calculation.
With route enabled, unconfigured verifier returns 503. Missing/invalid Bearer session returns opaque 401. Reuse existing session verification capabilities without enabling the global engine-auth flag for every old route.

Confirmed source environment names:
- SUPABASE_JWT_ISSUER
- SUPABASE_JWKS_URL (prefer asymmetric verification)
- SUPABASE_JWT_AUDIENCE (source default authenticated)

Confirm the correct InvestScape Supabase project and issuer before configuring staging. Do not invent values or print keys. Do not use service-role credentials in WeWeb.

The server supplies deps.CALC and bounded engine identity. Full wraps only devstudioCompute; RLV, staged, tax, handoff and E85 remain separate.
No saving in this endpoint. Future persistence requires server-derived owner identity and explicit project authorization.

HTTP policy:
- malformed JSON/envelope: 400
- body limit: 413
- invalid or missing session: 401
- feature/verifier unavailable: 503
- rate denied: 429
- unexpected infrastructure exception: generic 500
- authenticated adapter outcomes: 200 with status invalid/incomplete/unavailable/error/ok/partial

Input adapter failures remain distinguishable from dependency/runtime errors. Never return stack traces or log complete financial inputs/tokens.

## Lossless transport boundary

Do not pass raw adapter output directly through JSON.stringify/res.json.
JSON drops undefined, turns NaN and infinities into null, changes -0 to 0, and rejects cycles. A partial result can contain unavailable branches.

Propose independent transport contract full-api-transport-1:
- transportVersion
- resultMetadata: approved JSON-safe status/revision/version/availability/disclosure metadata
- encodedResult: tagged complete adapter result
- deploymentIdentity: server manifest

Tag grammar must distinguish undefined, null, boolean, string, finite number, -0, NaN, +Infinity, -Infinity, array and object. Encode objects as ordered key/value entries, so user keys cannot collide with tag sentinels. Decode using safe own-property construction; never merge decoded keys into global prototypes.
Bound encoder/decoder depth, node count, string length and total response bytes. Reject cycles, getters/accessors, symbols/functions/BigInt and unsupported shapes rather than silently substituting values. An unencodable response returns a bounded transport error with no raw/display permission.

Requests themselves must use JSON-compatible source inputs. Missing, null and blank remain distinguishable where policy requires. JSON cannot transport numeric -0 faithfully through all serializers: define a deliberate request representation or normalize that distinction only in a separately versioned wire policy; do not claim unrestricted request-category parity.

The client decodes before calling fullResultMatchesRequest. Freshness requires exact kind, contract, mode, revision, inputIdentity and packageVersion plus the intended engine identity policy. Freshness alone NEVER grants display permission: status and section availability must be checked independently.

Keep production raw calculations and adapter results unchanged. Tagged transport is an outer protocol, not a replacement golden format. Supply a reviewed shared browser decoder before native Full wiring.

## Staging and acceptance gates

1. Corrected adapter checkpoint and runtime tarball reviewed; no unresolved local-only dependency.
2. Clean npm ci, TypeScript/build checks and existing maintained suite.
3. Both installed package formats retain 249-case bounded Full equality; maintain permanent delivery tests rather than one-off evidence.
4. Transport round trips preserve undefined, -0, nonfinite categories, property order and nested optional failures. Explicit rejection tests exercise cycles/limit exhaustion/unexpected shapes.
5. Adapter statuses, conditional inactive values, month limits, immutability and stale/version mismatches covered.
6. Route default-off, unconfigured verifier, absent/expired/wrong-signature/wrong-issuer/wrong-audience token and valid session covered without real secrets in fixtures.
7. Use isolated staging environment/service on the feature branch. Verify exact WeWeb preview origin in CORS preflight with Authorization and POST; Bearer auth does not require browser credential cookies.
8. Test native decoded results, partial sections, stale rejection, network errors, and no accidental saving/auth claims.
9. Report tested deployment commit, package/archive identities and actual browser evidence separately.
10. Only consider production rollout after these gates and a reviewed rollout/rollback. This document authorizes no production deployment.

E85 remains NOT_RELEASED and AS_OF DISABLED. No legal readiness or financial correctness is established.
