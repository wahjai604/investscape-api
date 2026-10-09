# Market Intel — Dev provisioning and WeWeb wiring review

**Date:** 2026-10-09 (America/Vancouver and UTC). **Status:** review complete; provisioning and wiring not performed. Source baseline: API `f153eb09fa9ce361320746964556dbcc762f4186`, docs `452d5e9e200679d62b74250851953d62d916b560`. This package proposes the next bounded Dev work; it does not approve live DDL, credentials, assignments, authentication changes, deployment or publication.

## Evidence and destination

| Component | Evidence label/date | Verified or reported reference | Remaining uncertainty |
|---|---|---|---|
| Supabase Dev destination | Freshly verified, Oct 9 | Project inventory: **Investscape-Dev**, `hwhkgrwikczwztfnsjir`, ca-central-1, ACTIVE_HEALTHY | Inventory proves project identity/status, not effective database owner, ACLs, signing algorithm or runtime connection |
| WeWeb application | Freshly verified, Oct 9 | **Investscape Dev**, project `4a0173ad-346d-4d29-a9b9-0201e5af6d78`; installed Supabase integration, connection `40c528bb-150f-4ecc-9aff-846cd113dbc9`, readyToUse=true | Connection metadata does not prove the active authentication provider or legacy-session adapter |
| Existing WeWeb shell | Freshly verified, Oct 9 | Complete Workspace page semantic, `0638fef4-2a31-489a-b7a8-bde95c384ce6`; existing shared header `7dc18c1a-77ca-41b9-804a-5cc82f26b011`. Complete seven-page inventory has no named Maps/Market Intel page; Workspace semantic has no Maps/Market Intel element | Other pages' full semantics were not inspected; no claim that no map-related element exists anywhere |
| WeWeb/Auth project target | Historical reported evidence, Oct 8 local / Oct 9 UTC | Earlier signed-in review: WeWeb Supabase and legacy Auth plugins point to `hwhkgrwikczwztfnsjir` | Not freshly reverified by returning connection values; deployed JWT acceptance remains unknown |
| Existing Data API posture | Historical reported evidence, Oct 8 local / Oct 9 UTC | Doc 82 §1: exposed graphql_public/investscape/public; automatic new-table exposure off | Not a fresh effective privilege, function or GraphQL audit |
| Railway existing staging | Freshly verified, Oct 9 | Project **InvestScape Native Full Staging** `227cdcb9-8e2c-4cf2-8e96-805454eccf56`; service **native-full-staging-api** `0a9b03d7-9de1-4cf0-b793-f83454465a40`; environment `d1a3a868-f1a1-4662-80a4-22a8a5aa20d2` named **production**, used as isolated staging | Environment name does not establish a production release. Runtime database and accepted Auth project unverified |
| Existing Railway deployment | Freshly verified, Oct 9 | Latest deployment `c0f1658f-481b-4579-a297-4ba02963436e`, SUCCESS, created Oct 4 09:32:26Z; branch `feat/native-full-api-adapter`, commit `2cec0ab519513a34aabbad909c4f24b1472d385c` | Map review branch is not deployed; no endpoint was contacted |
| Railway pending work | Freshly verified, Oct 9 | get-status reports staged EnvironmentPatch `2473a18c-53e2-47c1-9857-d8de0b334e14`, started Oct 3; changes=[]; environment.stagedChanges=null | Contradictory/incomplete metadata. It is staged, not evidence of a running map job. Do not accept, discard or attach this work to it |
| Map membership/catalog writer | Source intention, Oct 9 | Separate private `mi_map_private` schema in Investscape-Dev; backend-only reads and audited manual membership writes | Schema is not provisioned; no canonical live map authority or publisher exists from this evidence |
| Relationship OS transaction domain | Unknown, Oct 9 | No shared transaction domain verified | Separate from this map task; no cross-product database assumption |

The original v2-remastered HTML remains a design/behavior reference. The destination is the WeWeb SaaS application plus the API and private catalog. No HTML prototype changes are proposed.

## Database provisioning proposal

Use a separately owned private schema and independently scoped server pools. Review [draft schema](map-store-schema.sql) statement by statement against the real baseline before producing a live migration. The draft currently assigns ownership implicitly to its executor; explicit ownership and creation-role defaults must be resolved first. Do not run this through the Lighthouse migration runner or share its ledger.

| Principal (proposed where absent) | Scope | Runtime destination |
|---|---|---|
| `mi_map_owner` NOLOGIN | Own only map schema/objects; controlled migration/bootstrap access; no runtime membership | Provisioning operator only; confirm managed-Postgres support and exact owner before final DDL |
| `mi_map_reader` NOLOGIN | Existing draft read capability, including current published/cleared UI values and internal membership lookups | Reader pool via a dedicated LOGIN principal, proposed `mi_map_reader_login` |
| `mi_map_access_writer` NOLOGIN | Existing draft membership/audit/admin-lock capability; cannot appoint admins or read catalog | Separate writer pool via dedicated LOGIN principal, proposed `mi_map_access_login` |
| `mi_map_ingester` NOLOGIN | Existing draft candidate insertion; no publishing or aggregate-value reads | No login/pool in initial provisioning slice |
| Publisher | No grants supplied by current draft | Leave unprovisioned until owner appointment and audited promotion/withdrawal design |
| Browser/Data API roles | No map schema/table/function grants, direct or inherited | WeWeb uses map HTTP API; no private catalog table/view connection |

LOGIN principals need only CONNECT and their one capability role, with inheritance reviewed for the deployed PostgreSQL version. They must not own objects, possess BYPASSRLS/CREATEROLE/CREATEDB, inherit broad roles, or receive grant/admin options. Credential delivery stays in the hosting secret configuration; never commit or echo values. Pools must use the same explicitly confirmed Dev project, with TLS certificate verification and bounded pool size/timeouts; initial proposal is max 2 connections per pool, one process/replica. Confirm limits with the operator rather than inferring availability from inventory. Prefer a compatible direct or session-pooler connection for this long-running Node service; custom LOGIN role support and network reachability remain unverified. All transaction context and locking must remain on one checked-out connection until commit/rollback.

**Trust boundary:** the reader role can query cleared published values without per-member RLS; membership is checked in the API/reader application. The access-writer role can set the transaction-local actor fields. The trigger validates current admin assignment and audit atomicity, not the JWT signature itself. These are trusted backend capabilities, never credentials for members or browser integrations. Backend compromise is outside the per-member SQL protection; do not claim SQL independently authenticates a member/admin.

[Read-only metadata preflight](map-dev-metadata-preflight.sql) is prepared and checked only in disposable embedded Postgres. It reads pg_catalog metadata and fixed role names, not app rows/auth users/settings/credentials. It has not run on Supabase. Missing/colliding names stop provisioning; no DROP, rename, existing-role reuse or automatic fix is authorized. The script is a bounded baseline aid, not a complete exposure proof. Effective login memberships, object/function dependencies, gateway settings and dynamic function paths need separate operator review.

Global creation-role defaults cannot be cancelled by a per-schema revoke. Keep explicit private-object revokes inside the same create transaction, apply them to each future object, and review the exact creation role. Do not change defaults/grants for unrelated public/Quick/Full objects. Current Supabase's public-schema opt-in changes do not replace private-schema review.

Record a provisioning receipt: schema DDL content hash, reviewed role/owner names, target project ref, independent ledger location, transaction result and permission-check outcome. No secrets or member subjects belong in this repository receipt. Before any live operation, establish the available recovery point and restore procedure for Investscape-Dev. Do not issue DROP SCHEMA CASCADE as rollback: disable map switches and drain the two pools first; preserve grants/audit and reconcile the migration. Existing `dev_studio_projects` saves remain on their established path.

## API composition and staging wiring proposal

New composition belongs in an isolated source candidate, with no enabled default and no live configuration in this review. Proposed non-secret configuration names below are **not implemented**:

| Setting | Proposed meaning/default |
|---|---|
| `MI_MAP_READ_ENABLED` / `MI_MAP_ADMIN_ENABLED` | Independent exact-true switches; both false by default |
| `MI_MAP_AUTH_ISSUER` | Operator-confirmed issuer; candidate expectation is `https://hwhkgrwikczwztfnsjir.supabase.co/auth/v1` |
| `MI_MAP_AUTH_AUDIENCE` | Candidate expectation `authenticated`; deployed acceptance unknown |
| `MI_MAP_ADMIN_ORIGIN` | One exact Dev rendered-app origin, no path/query; not the editor handoff URL |
| `CORS_ALLOWED_ORIGINS` | Existing server setting; require explicit reviewed browser origins for private endpoints |
| Reader/writer pool secret bindings | Two separate scoped credentials; names/delivery finalized later without exports or values |

Construct `PgMapDatabase` twice using distinct pools. Reader DB supplies `PostgresManualMapStore` for authority lookup and `PostgresPrivateCatalogReader`; writer DB supplies the administrator store. Build the dedicated `createMapSessionVerifier`, then `createMapPilotRouter`, and a bounded `MapViewStore`. Closing the service must drain both pools without touching the Lighthouse pool. No fallback to Lighthouse `DATABASE_URL`, service_role, prototype auth, synthetic actors or general engine-auth settings.

**Mount-order finding:** `src/index.ts` globally parses 100 KB JSON before route registration and applies the engine guard with the general `/v1` router. Simply adding the pilot factory there could consume the admin body before its 8 KB/uncompressed parser and impose the unrelated verifier. Propose a map-scoped composition immediately after Helmet and reviewed CORS, before the global parser and engine guards. Install its own bounded request budget there. Terminate unmatched `/v1/market-intel/map` paths with a static no-store 404, so they cannot fall through into engines. Mount only the new pilot factory, not the old placeholder factory at overlapping paths. Preserve all existing non-map mount order and behavior.

A source implementation must test an oversized body when injected after the intended production composition, compressed JSON, disabled switches, wrong issuer/origin, and strict unknown-route behavior. Do not describe the previous standalone-router tests as proof of the real startup composition. One process/replica is required by the current opaque in-memory view store; restart/eviction demands manifest reload. More replicas require a separately reviewed shared view store.

Use the existing **isolated staging** service only after a specific deployment review and confirmation that the unrelated staged patch is understood. Keep the connected branch unchanged during preparation. Confirm a candidate commit explicitly before any deploy; do not merge the review branch simply to trigger it. The map flags stay off through provisioning and initial smoke acceptance. No claim about existing service runtime database settings is made.

## WeWeb wiring specification

Use the existing shared header for a new draft **Market Intel** page (proposed path `market-intel`), with Maps as its in-page tab. Add a separate draft access-administration page (proposed `market-intel-access`) for the sole explicitly appointed operator. These are proposed page names/routes, not existing page IDs or publication. No changes to Login, auth provider, Quick/Full, connection-test or unrelated pages.

Reuse the app's existing Supabase session lifecycle. An installed Supabase integration does not establish whether the modern integration auth actions work with the legacy plugin. During the source adapter phase, verify the exact documented session accessor for that plugin; do not call `setProjectAuthProvider`, install a second provider, migrate users or assume a modern auth action is compatible. The backend cryptographic verifier remains authoritative.

The host's `authenticatedFetch` must allow only the four map API path shapes below and a single configured HTTPS Dev API origin. It obtains the current access token just before each request from the existing Auth session, attaches Bearer, and uses credentials omit, no-store, redirect error and bounded request timeout. Do not persist tokens/view IDs/member/audit payloads in custom variables with browser storage, URLs, analytics or logs. Do not relay them to other origins or arbitrary user-supplied URLs. Never forward a service/secret key. Read retries after session refresh can be bounded; approval POSTs must **not** auto-retry after an uncertain result. Reconcile persisted membership/audit first.

The existing approval client's relative `/v1/...` paths require this origin-resolving host adapter: plain relative fetch in WeWeb would target WeWeb, not Railway. The component also uses direct DOM mounting; it is not yet a WeWeb coded component. Propose a lifecycle-managed coded wrapper for the tested component (mount on attach, destroy on detach), preserving the required host adapter; obtain current coded-component documentation before implementation. Do not embed the static review HTML or synthetic browser proxy.

| Event/action | Binding/request | Required result/state |
|---|---|---|
| Page load, geography change | GET `/v1/market-intel/map/views?geographyId=...` | Clear old feature values; increment selection generation; accept only current response; keep viewId in page memory |
| Layer enable/selection | GET `/v1/market-intel/map/layers/{layerId}?viewId=...` | Only manifest-readable layer; independent loading/error state; keep source/windows/units/quality/notices visible |
| Session/subject change, sign-out | Local invalidation; no data call while unauthenticated | Abort/ignore old requests, clear views/evidence/admin state; no cross-account retained payload |
| Administrator load | GET `/v1/market-intel/map/admin/member?subject=...` | Current protected revision/state/latest 20 audit; trusted member reference provided outside free-text account claims |
| Approve/renew/revoke | POST `/v1/market-intel/map/admin/changes` | UUID request ID + expected revision/reason + expiry for approve; issuer/actor/capabilities omitted; reload after every acknowledged/uncertain outcome |

Suggested page-memory state: selected geography/layers, selection generation, current manifest/viewId, per-layer response/status, current error. These are planning names, not deployed WeWeb variables. Administrative subject/audit data remains confined to that page. Four approved geography IDs and regional layer descriptors come from the API; no WeWeb copy of source rights or grant authority.

401 clears evidence and requests sign-in; 403 shows pending/denied approval or terms as appropriate; 409 clears stale view and offers a fresh manifest without silently substituting data; 503 is unavailable, never no_data. Within a successful response, retain zero/null/suppressed/missing and MOE markers. A failed layer does not blank an independent successful layer. Abort or generation checks prevent an older geography request winning. No general bbox/cursor/period query is supported by this pilot.

This API returns evidence for one pilot feature, **not geometry**. Initial wiring can show the evidence panel and unavailable-layer states, but a functioning live map requires separate geometry delivery, scale controls, rendering and source-qualified publication. No basemap/tiles/geocoder is selected by this review. CMHC remains withheld pending recipient terms acceptance even when the member is approved.

## Ordered implementation gates and missing owner statements

1. **Source-only composition and WeWeb adapter preparation:** implement isolated default-off composition, scoped adapter and coded wrapper; verify production-equivalent middleware order and synthetic browser lifecycle. This can proceed without live provisioning.
2. **Dev baseline and provisioning authorization:** exact owner/defaults/role membership metadata, absence/collision result, backup/recovery, independent map ledger and final transactional DDL. Then review the concrete scoped role/credential bindings; no secret values requested.
3. **Operator appointment:** explicit initial access-admin authorization, trusted identity matching procedure and separate auditable bootstrap receipt. A sole operator is not automatically an assigned admin. No real subject is copied to repo; member map-read remains separately approved.
4. **Staging deployment/wiring acceptance:** exact candidate commit, Dev API/rendered-app origins, effective issuer/audience/asymmetric signing compatibility, one process/replica, scoped roles and no outstanding staged patch uncertainty. Stage failure/denial/concurrency/no-bypass checks with synthetic principals under separate authorization.
5. **Catalog/map release:** explicit publisher appointment, audited publication/withdrawal, source/recipient terms, geometry/scale/performance and rendered WeWeb acceptance. Activation/publication remains separate.

Only these non-secret statements/evidence block the dependent live stages:

- “Use Investscape-Dev `hwhkgrwikczwztfnsjir` for the private map schema; the creation/owner role and independent map migration ledger are [names]; the recovery point/procedure is [reference].” Provide a reviewed metadata result, not an environment export.
- “The Dev map API must accept issuer [issuer], audience [audience], with ES256/RS256 signing and non-anonymous sessions.” Confirm the effective configured project and algorithm without a JWT or key. The candidate additionally requires `is_anonymous:false`; compatibility remains to be established in authorized staging.
- “I authorize the initial access-admin appointment to myself through a trusted private identity-match workflow, with a bootstrap audit receipt.” Publisher appointment is a distinct owner decision needed before source release.
- “Use [exact Dev rendered-app origin] and [exact Dev API origin] for this isolated staged test; resolve or exclude existing patch `2473a18c-53e2-47c1-9857-d8de0b334e14`; use [reviewed commit] only after deployment authorization.”

No owner answer is assumed. The completed review does not itself require a live action to be useful: the source-only adapter/composition slice is the next preparatory task. No production endpoint, table, account or login was tested in this review. No map work is left running in the background.

## Verification and primary references

Fresh connector reads: Supabase project inventory, Railway explicit project/environment status and latest deployment metadata, WeWeb project/integration/page inventory and Workspace semantic; GitHub isolated branch heads. Non-secret metadata only; no environment export, connection string, Auth user/table data, live endpoint/JWKS call or configuration mutation. The read-only metadata script was exercised against empty and draft-schema disposable PGlite databases; this proves syntax/bounded local output, not live privileges or independent-server concurrency. Runtime source/dependencies and prior 587-test/28-browser-assertion checkpoint are unchanged; tests were not needlessly repeated.

Primary docs checked Oct 9:

- [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api): grants and RLS are separate; functions require EXECUTE review.
- [Supabase public-table exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): existing grants remain; custom schemas retain their own defaults. Do not infer a private-schema boundary from the public toggle.
- [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts): confirm signing mode and issuer; public JWKS support does not establish this project's configuration.
- [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres): choose direct/session/transaction mode intentionally. No connection values were retrieved.
- [PostgreSQL default privileges](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html): global grants cannot be reversed through a per-schema revoke.
- Current WeWeb connector frontend and Supabase integration documentation: SPA pages/shared sections; integration auth actions require the appropriate provider. Those docs do not establish legacy-plugin compatibility.
