# Manual approval/audit store and private catalog reader

Evidence date: 2026-10-08 America/Vancouver / 2026-10-09 UTC.
Review branch: `review/market-intel-map-access-2026-10-08`, continuing the unmounted gate at `3a07b0d0f04921e845af988f76f082c4d526c2c1`.
Status: implemented source candidate and disposable local SQL tests. No live schema, credentials, accounts, deployment, route mount or layer activation.

The owner chose manual member approval while automation remains undesigned. This store persists manually approved map-read grants and their audit in one transaction. The reader serves immutable, approved UI aggregate releases through current membership and rights checks. Neither an account nor catalog ingestion appoints a member, administrator or publisher.

## Source and storage boundary

| File | Responsibility |
|---|---|
| `src/market-intel/map/store/manualApproval.ts` | Internal approval/revocation method and authority lookup; verified actor, current same-issuer access-admin assignment, expected revision, expiry, reason and request ID required |
| `src/market-intel/map/store/catalogReader.ts` | UI-only bounded layer read, publication pins, current rights/member rechecks, source/period/unit/dimensions/quality/MOE preservation and public-field whitelist |
| `src/market-intel/map/store/sql.ts` | Injected database seam and existing `pg` pool adapter; transactions use one checked-out client at READ COMMITTED, with rollback and connection destruction on failed rollback |
| `docs/review/map-store-schema.sql` | Proposed private schema, NOLOGIN capability roles, grants/revokes, forced RLS, immutable records and audit/control triggers; review DDL, not a migration |
| `src/market-intel/map/store/store.test.ts` | Real embedded Postgres tests with synthetic administrator/member/source fixtures and SQL permissions |
| `src/market-intel/map/store/sql.test.ts` | Injected driver failure tests for commit/rollback/release behavior and static diagnostics |

`mi_map_private` is a proposed InvestScape-only schema, separate from `investscape.dev_studio_projects` and Lighthouse migration history. The DDL deliberately fails on existing names. It has no runner or startup import. Its only application here was to an empty in-memory database in the tests; it must not be run against Supabase without a separately reviewed baseline, owner/default privileges, role memberships, exact migration and authorization.

## Approval and audit behavior

Internal `change(actor, command)` takes the actor from server-owned JWT verification. It must never receive an actor from a client body or expose SQL audit context as client input. It checks a current access-admin grant for the same issuer, then locks the target, compares `expectedRevision`, and writes approval or revocation. First approval uses revision 0; every committed change increments revision. A renewed approval replaces the grant ID so a mid-read replacement cannot silently preserve earlier authority.

The SQL membership trigger independently validates the current administrator and session expiry, derives manual approval metadata, and appends before/after states, actor grant reference, reason, request ID and database timestamp. The audit is part of the membership transaction: any audit failure rolls back the grant change. Direct audit inserts by the runtime are denied; updates/deletes/truncation are denied by privileges/triggers. Protected actor/member identifiers stay internal.

Duplicate request IDs and stale revisions cannot apply a second change. This is conflict detection, not an exact receipt-replay service. If a response/connection is lost around commit, the administrator must reconcile the current revision and audit before retrying. No automatic retry, approval worker, email or account appointment is included.

The administrator bootstrap table has no runtime mutation path. Its initial real assignment and externally recorded bootstrap evidence remain a later operator decision. The tests create only synthetic assignments. Staff/admin assignment management and its own audited workflow remain unimplemented; this slice audits member approval/revocation only.

## Privilege proposal

| Capability role | Permitted | Denied / boundary |
|---|---|---|
| `mi_map_reader` | Internal member lookup; publication/rights/source metadata; values from currently qualified, published, cleared UI releases through RLS | Writes, administrator lookup/mutation, audit, candidate/unpublished values |
| `mi_map_access_writer` | Administrator lookup/row lock, membership change with validated transaction-local audit context, trigger-driven audit append and internal audit reconciliation | Appointing/updating administrators, catalog access, direct fabricated audit inserts, audit rewrites/deletion |
| `mi_map_ingester` | Insert candidate release metadata and observations; read release/head metadata and lock parent release to coordinate append/promotion | Read aggregate values, modify immutable releases/observations, publish/withdraw, member/admin/audit access |
| Publisher/migrator | No runtime grants or actual assignments provided | Exact audited publishing workflow and role provisioning are separate future work |
| `PUBLIC`, `anon`, `authenticated`, `service_role`, `authenticator` | No private schema/table/function access | Explicit object revokes cover existing simulated global defaults; no role membership or credential is created |

Use a read-role pool for map authority resolution and catalog reading, and an independent access-writer pool for the internal administrator operation. Constructing an authority-only store with a reader database cannot grant membership because its SQL role cannot write. No broad service-role credential is substituted. `pg` pool construction/TLS/credentials are not supplied or inferred here.

Global owner default privileges cannot be cancelled by a per-schema revoke. The proposal explicitly revokes browser/service object grants on every created table/function, and future objects must repeat those revokes. Existing Supabase owner/defaults/role memberships, PostgREST exposure and GraphQL/SQL/function paths still require live metadata review and later staged effective-access verification. The isolated SQL result is not a deployed no-bypass proof.

## Catalog reader behavior and limits

Each release pins product, source revision/hash/parser/definition, geography, boundary version/hash, explicit crosswalk and exact clearance scope. Foreign keys prevent a head from pointing at another geography/layer or a release from silently using another clearance's revision/boundary hash. Observation dimensions have a unique release/metric/source-geography/vintage/period/dimensions key. Release/observation records cannot be edited or deleted. Parent-row locks coordinate candidate appends with promotion; a published or withdrawn release cannot receive later appends, and incomplete/unqualified releases cannot become heads.

The reader authorizes a current manual member before reading and after reading. It only returns current approved UI values, bounded to 250 observations in this initial internal contract (`map-catalog-review-1`). It checks release/generation pins and current rights revision, validity, notices and boundary/crosswalk references. An observed withdrawal/revocation blocks delivery; a changed release, rights revision or membership grant returns a conflict. Zero, missing, suppression and raw MOE markers retain their distinct meanings. Source dates, definition, exact period label, dimensions, currency/price basis and universe remain explicit; comparisons are `context_only`.

Recipient agreement is deliberately **not** granted by manual approval. Any clearance requiring an agreement returns `TERMS_REQUIRED` until a separately implemented recipient acceptance system exists; CMHC remains withheld. Export/AI uses are not implemented or implicitly authorized by this UI reader. Geometry bytes, controlled delivery, scale enforcement and artifact verification remain later work.

This is a bounded physical foundation, not the complete normalized Doc 81 catalog. Independent SourceRevision/MetricDefinition/GeographyVersion tables, crosswalk qualification workflows, rights adjudication, refresh jobs, audited publication, cursor/paging, full Doc 79 HTTP contracts and WeWeb views are still pending. No original provider fixtures are imported into this database; all test data are synthetic.

READ COMMITTED lets later statements observe committed control changes on a real server. The final recheck is a defined authorization observation point; it cannot promise instantaneous revocation after that point or across a future HTTP response. The embedded database has a single connection. Interleavings in tests are owner-controlled SQL mutations between reader statements; independent writer/server concurrency and effective Supabase gateways have not been tested. Do not claim them from these tests.

## Verification

- Node v24.19.0; `@electric-sql/pglite` **0.5.8**, pinned as a dev-only dependency with lockfile integrity. Runtime dependencies are unchanged.
- **28 new tests passed:** 24 embedded-Postgres store/permission tests and 4 driver lifecycle tests. Browser/service roles begin with simulated permissive global owner defaults; the explicit private object revokes still deny their access, including the synthetic BYPASSRLS service role.
- Typecheck and build passed. Full offline repository suite: **572 tests, 570 passed, 2 skipped, 0 failed**. The two pre-existing E85 snapshot-dependent checks lack their external evidence files in this isolated checkout.
- No existing Lighthouse database suite, real login/JWT/JWKS, deployed endpoint or database record was queried. Startup, route registration, Quick/Full and existing shared authentication/migrations are unchanged; the existing map factory still returns its unavailable placeholder and is unmounted/default-disabled.

Primary documentation consulted: [node-postgres transactions](https://node-postgres.com/features/transactions), [Postgres privileges](https://www.postgresql.org/docs/current/ddl-priv.html), [RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [row locks](https://www.postgresql.org/docs/current/sql-select.html), [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles), [PGlite API](https://pglite.dev/docs/api). Supabase's changelog was checked, including its September 25 Postgres minor-update advisory; this proposal uses none of the listed ltree/pgcrypto/btree_gist/custom-operator paths and makes no claim about the deployed database's upgrade state.

## Superseding HTTP/UI checkpoint — Oct 8 local / Oct 9 UTC

The [manifest/layer API and administrator interface review](map-api-admin-review.md) now adds a separate unmounted router factory, member-bound release/rights views, independently fetched pilot evidence, administrator-only inspection/change routes and a reusable disabled-by-default host component. It supersedes the pending bounded HTTP/approval-interface step above. Its 15 new Node tests and 28 rendered browser assertions pass; typecheck/build pass and the full suite is 585 passed, 2 skipped, 0 failed. No runtime dependency/lockfile, live database, actual identity assignment, startup mount, deployment or WeWeb publication changes accompany it. See that review for single-process view storage, one-feature paging, synthetic browser proxy and remaining provisioning/geometry boundaries.
