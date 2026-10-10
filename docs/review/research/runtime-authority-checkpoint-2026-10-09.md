# Research runtime, authority and scoped Dev package

Owner decision date: **Oct 9, 2026, America/Dawson_Creek**. Work and verification span Oct 9–10 UTC. Source and review package only; no live provisioning, grant, credential, editor appointment, article publication, deployment or WeWeb publication was performed. Live maps remain deferred.

## Settled decisions

The owner selected existing **Investscape-Dev**, `hwhkgrwikczwztfnsjir`, and **automatic access for eligible permanent members**. Free, paid and downgraded-to-free browsing access is identical; no enrollment or subscription gate. Research-specific suspension and explicit audited editor grants are separate. Source rights still require manual per-item editorial review.

## Built and verified

1. Dedicated `src/research/main.ts` entrypoint, `npm run start:research`, compiled to `dist/research/main.js`. It imports no existing calculation, Lighthouse, map or legacy startup. Default-off `/v1/research` routes are terminal unavailable; unrelated product routes return 404. `/healthz` reports posture/liveness, not continuing DB health. Disabled startup reads no credentials or generic database bindings.
2. Explicit Research-only runtime settings and reader/writer/authority pools. Enabled mode requires exact Dev issuer/audience, approved HTTPS origins, exact host/project/login roles, verified TLS with supplied CA and direct/session-pooler port 5432. No SSL URL override, generic `DATABASE_URL`, map-resource fallback or local credential discovery. Pools are bounded to two connections each; read-only mode creates no writer pool. Startup refuses privileged/extra-role/foreign data paths, wrong package/project or unbound identity. Failed construction cleans up once; shutdown errors use static labels and mark the process unsuccessful.
3. Fresh `PostgresResearchAuthority` adapter, independent of billing, editable metadata, occupation or map permissions. Signed JWTs require permanent authenticated status, exact issuer/audience, UUID subject/session_id and expiry. The private lookup returns only readiness/member/editor booleans. Separate identity projection checks current account existence, anonymity, deletion, ban and exact live subject/session pairing, plus explicit session not_after. Research restriction and editor-grant state are resolved on each request, not cached in JWTs. The live projection remains unbound.
4. Private restriction/editor ledgers with atomic append-only audit. Editorial grants do not confer read eligibility on suspended/ineligible accounts. Revocation applies on the next request; already rendered client snapshots retain the existing at-most-30-second clearing bound. This does not claim cancellation of an already authorized in-flight request or enforcement of every global Auth inactivity setting before refresh.
5. Pinned disabled-create package: ten private forced-RLS tables, eight NOLOGIN roles, isolated reader/writer/authority login-role memberships and private provisioning ledger. Its identity stub reads no Auth data. No articles, editor identities, passwords or Auth grants are seeded. Separate Auth binding includes an atomic hash/review/recovery receipt; it is excluded from disabled create.
6. Read-only preflight/permission reports and separately chosen empty-store teardown. Teardown uses explicit named objects without CASCADE and refuses enabled roles, identity binding, content or access decisions; outside dependencies stop and roll back the transaction. Existing products and shared/global ACLs are preserved.

## Concrete live facts and blockers

| Fact | Evidence class/date | Result |
|---|---|---|
| Dev Research schema and roles | Fresh catalog metadata, Oct 9–10 UTC | Still absent; connected operator is postgres with CREATEROLE; PostgreSQL 17.6 |
| Auth projection columns | Fresh catalog metadata, Oct 9 UTC | Seven expected UUID/boolean/timestamptz columns verified; no user/session rows read |
| Column SELECT grantability | Fresh privilege metadata, Oct 10 UTC | Connected operator has grant option on all seven required columns |
| Auth schema USAGE grantability | Fresh privilege metadata, Oct 10 UTC | Operator has USAGE, lacks grant option; cannot SET the supabase_admin schema-owner role; PUBLIC has no USAGE |
| Current backup listing | Fresh browser observation during this turn | Dashboard redirects to sign-in; current recovery reference unavailable |
| Historical backup | Owner screenshots, Oct 9 | 11:16:52Z physical point, before map provisioning; no current listing/rehearsal established |
| Hosted app/API/editor-app origins | Unknown/unallocated for proposed runtime | New Railway Research host not created; historical workspace editor origin is not a hosted app origin |
| Real-session/plugin compatibility | Historical public session diagnostic plus source intention | Research's UUID session_id/JWT/full adapter acceptance not verified against installed WeWeb |

The Auth binding is explicitly blocked until an authorized schema-owner operator supplies **only USAGE on auth to research_identity_owner**, with a non-secret verification receipt, or a different verified eligibility source is selected. No authenticated/service_role/admin membership is substituted. Both private SECURITY DEFINER lookup functions are narrowly scoped to current eligibility and permission booleans, with fixed search paths and denied gateway execution. They do not alter Auth tables, bypass another product's RLS, export user identities or run administrative Auth operations.

Recovery and Auth-schema authority are distinct gaps. Completing a dashboard login can refresh the backup listing; it does not fix the operator's schema privileges. Exact origins/connections are deployment-stage bindings, not choices the owner needs to invent now. Secrets must never be supplied in chat.

## Source review still pending

The eight original source candidates remain unapproved. Recommend the four Statistics Canada/Bank of Canada text links first, with attribution and Bank of Canada free-source/author-view notice now included in their drafts. No summaries, bodies, publisher assets or AI reuse is proposed. Other publishers remain held on their item-specific evidence gaps. The owner's future approval must cover the exact records and operational review/clearance caps before stage → inspect → approve → publish. No public-source permission is inferred from a free member tier.

## Acceptance

Typecheck/build passed. Full suite: **663 tests, 661 passed, zero failures, two existing E85 skips**. Research: **39 tests passed** (18 existing + 21 runtime/authority/package). Actual Vue browser: 21 synthetic checks passed. Compiled dedicated host: four default-off HTTP checks and SIGTERM shutdown passed, with zero external requests. Both metadata-report SQL files were checked in disposable PostgreSQL. Managed-role fixtures test exact create, missing schema authority refusal and successful binding only after an explicitly simulated authorized grant. All Auth records used in tests are synthetic.

## Next concrete sequence

Refresh current recovery evidence; review/approve the pinned disabled-create package; provision and verify its effective permissions. Separately settle the schema-owner grant/provider path and approve identity binding. Then bind the verified editor subject and exact scoped TLS/origin/session configuration for a separately approved isolated deployment. Manually approve a small source catalog and complete real-session acceptance before Research activation/WeWeb publication. No background job or live activation is left running by this checkpoint.
