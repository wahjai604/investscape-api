# Map manifest/layer API and manual approval interface

Date: 2026-10-08 America/Vancouver / 2026-10-09 UTC.
Branch: `review/market-intel-map-access-2026-10-08`, following store checkpoint `e73834262ed24dc102a322b85b66b2dad2d534f7`.
Status: bounded pilot source/UI candidate, exercised only on loopback with synthetic principals, keys and records in disposable embedded Postgres. No live database provisioning, assignment, route mount, deployment or map/source activation.

The manifest now describes separately fetchable pilot layers. Each layer request is bound to a member-specific approved view and current release/rights control. The administrator interface reads current membership/audit before a change and reconciles the persisted state after it. This continues the owner's manual-approval decision; it does not introduce automatic approval or appoint a real administrator.

## HTTP contract implemented

These paths are provided by the **unmounted, default-disabled** `createMapPilotRouter` factory. Tests mount it under `/v1`; existing startup/router files are unchanged. This factory replaces the earlier placeholder factory in the test candidate only; do not mount both factories at the same paths. Map and administration have separate explicit enable switches.

| Request | Behavior and boundary |
|---|---|
| `GET /v1/market-intel/map/views?geographyId=...` | Dedicated JWT verification plus current manual membership; metadata-only manifest (`map-manifest-review-2`), region-appropriate configured layers, readable/unavailable availability and qualified release/boundary references; no observations, actor/grant IDs or private clearance evidence |
| `GET /v1/market-intel/map/layers/{layerId}?viewId=...&pageSize=...` | Independent pinned layer read (`map-layer-review-2`), one selected official feature, observations/evidence, coverage counts, notices and context-only comparison. No permanent geometry URL or geometry bytes |
| `GET /v1/market-intel/map/admin/member?subject=...` | Dedicated verification and current access-admin authority for the same issuer; current target revision/state/expiry and latest 20 audit summaries; no full before/after states or private actor grant IDs |
| `POST /v1/market-intel/map/admin/changes` | Verified actor/issuer derived on the server; current access-admin authority; strict JSON body, exact configured browser Origin, expected revision/request ID/reason/expiry; transactional audited approval or revocation; caller reloads membership/audit after acknowledgement |

All responses use `Cache-Control: no-store`. Missing/expired/malformed authentication, missing membership or admin authority, disabled/unconfigured dependencies and invalid requests remain distinct static errors with a request ID. Administrator authority is independent of map-read membership. Actor, issuer and capabilities are rejected as client-body additions. The JSON parser runs after administrator authentication/authorization, accepts at most 8 KB and does not inflate compressed bodies.

### Views, coverage and supported request bounds

The geography cohort is Toronto/Vancouver CMA and Arizona/Texas state, with five configured Canadian layers or four U.S. layers per manifest. Configuration describes display choices; it does not approve or publish a source. Descriptor `unitHint` is planning/display metadata; exact units, source windows, currency/price basis, universe and quality come from the returned qualified observations. `availability` describes whether a layer may be fetched, independently of its eventual `available`, `partial` or `no_data` coverage.

Views use random 256-bit opaque IDs, reveal no actor fields and bind issuer/subject, current member grant, geography and each layer's release, publication generation, rights revision and boundary version/hash. They expire in at most five minutes or at earlier session/grant expiry. The default store holds at most 1,000 views and evicts old entries; restart/eviction/expiry requires a fresh manifest. Every layer read reauthorizes membership and current controls. A changed release/rights revision, replaced grant or withdrawal cannot silently substitute another snapshot.

This review uses a **single-process in-memory view store**. Multi-instance/shared view storage, persistent signed cursors and general paging are not implemented. Each bounded pilot response returns one geography feature and up to 250 observations without splitting its evidence. `pageSize` is a feature bound (default 100, accepted 1–250); this cohort always returns one feature and `nextCursor: null`. Unknown/duplicate query values, bbox, cursor, period/filter overrides and unsupported geographies are rejected, not ignored. Arbitrary viewport clipping, wider geography coverage, period filtering and antimeridian support remain separate work. No map renderer/tiles/basemap or geometry precision claim is included.

Recipient terms remain independent of member approval. Agreement-required layers are unavailable in the manifest; current agreement requirements block an older view as well. CMHC is not served until real recipient acceptance exists. The UI read does not authorize export/AI use.

## Approval-admin interface

The reusable component is `ui/map-approval-admin.js` with its CSS and disabled review HTML. The host supplies `createMapApprovalClient(authenticatedFetch)` using its existing verified session plumbing. The component has no credential entry, JWT fields, token storage, default session or account lookup. Opening the static review HTML without an authenticated host client keeps its actions disabled. It has not been added to WeWeb.

The operator loads a member reference from a trusted identity workflow, reviews current status/revision/audit, enters a local expiry and reason, then explicitly approves/renews or revokes. The interface does not claim that a typed reference proves an Auth account exists; actual trusted identity selection and the real administrator bootstrap are pending staged wiring. It cannot assign staff/admin/publisher capabilities.

Changing the target clears the loaded revision and ignores older reads. Buttons are disabled during writes and until a current revision and required inputs exist. The write acknowledgement is provisional: the UI reloads persisted membership/audit and renders the current revision, including a newer revision than the acknowledgement. An uncertain result invalidates the snapshot and requires reload before retry. Audit reason text is rendered as text, so it cannot insert HTML. Expiry input is interpreted in the browser's local timezone and sent as an instant.

The UI supports phone/desktop layout and light/dark themes, with labelled controls, visible keyboard focus and live status text. Browser checks cover accessible labels and layout; this is not a full WCAG audit.

## Verification and reproduction

- Typecheck and build passed. Full offline Node suite: **587 tests, 585 passed, 2 skipped, 0 failed**. Two existing E85 checks lack their external snapshot evidence.
- **15 new Node tests**: 13 real localhost HTTP tests using generated ES256 signatures and embedded Postgres, plus 2 view-store tests. Cases include independent-layer failure, pins, withdrawal/terms, actor/grant binding, renewal/revocation and replacement between outer/inner authorization, separate disable switches, administrator isolation, audit/revision reconciliation, strict bodies/origins and sanitized failures.
- **28 browser assertions passed** in Chromium 149 through Playwright, at 320/390/768/1100 px in light/dark, timezone America/Vancouver. Approval and revocation ran through the actual new API factory, synthetic verifier and disposable database. Additional synthetic-client cases verify stale target results, uncertain writes, later persisted revisions and literal audit text.
- Local [phone light](map-admin-evidence/390-light.png), [phone dark](map-admin-evidence/390-dark.png), [desktop light](map-admin-evidence/1100-light.png) and [desktop dark](map-admin-evidence/1100-dark.png) screenshots contain only synthetic records.
- The test fixture's `/browser-test/v1` loopback proxy injects a generated **synthetic** administrator header for browser tests only. The real router still verifies each request. The proxy is confined to the documentation test helper, has no startup import and must never be mounted or copied into production.
- No dependency or lockfile change accompanies this checkpoint. The alternative Chromium package was temporary verification tooling outside the repository after the managed browser archive failed to download/extract. No failed test process or review server is left running.

Run standard checks with `npm run typecheck`, `npm run build`, `npm test`. For rendered verification, run `node docs/review/check-map-admin-ui.mjs <absolute-playwright-module-path> [absolute-browser-executable-or-provider-module]` with a locally installed browser; it creates/cleans its own loopback server and in-memory database. It does not use a connection string or query a deployed service. Primary route/parser reference: [Express 5 API](https://expressjs.com/en/5x/api/).

## Next boundary

Prepare the exact Dev-only provisioning/wiring review: database owner/default privileges and baseline, scoped read/access-writer roles, real administrator bootstrap evidence, effective non-secret Auth project/issuer/audience, session-backed host client and isolated staging configuration. The draft schema remains unapplied to Supabase. Actual database changes, role/account assignments, authentication configuration, Railway deployment and WeWeb publication require that specific reviewed scope.

Independent-server concurrency, live gateway/no-bypass acceptance, shared views/cursors, normalized ingestion and audited publication, recipient terms acceptance, geometry delivery/scale/performance and rendered WeWeb map acceptance remain pending. The final authorization recheck is an observation point, not a promise of instantaneous revocation after HTTP delivery begins. Relationship OS and unrelated checkouts remain outside this work; all real pilot layers stay inactive.

## Dev provisioning/wiring review — 2026-10-09

The [concrete Dev review](map-dev-provisioning-wiring-review.md) now records fresh non-secret project/deployment/WeWeb metadata, separate pool/owner proposals, a [read-only metadata preflight](map-dev-metadata-preflight.sql), production mount-order findings, session-backed host wiring, ordered acceptance gates and the exact unresolved owner statements. Runtime startup remains unchanged and the preflight has not run on Supabase. This supersedes preparation of that review as the next task; source-only composition/adapter preparation is next, with live provisioning, assignments, deployment and activation still pending.
