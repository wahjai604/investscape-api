# Research catalog and browsing checkpoint — 2026-10-09

Source implementation, offline acceptance and a review-only storage proposal. No live Research database, API binding, article ingestion, member-role assignment, Railway deployment or WeWeb component/app publication was performed. Live maps remain deferred. The original HTML, existing Quick/Full host and Relationship OS are unchanged.

## Governing decisions

Freshly reread on 2026-10-09: `investscape-docs` canonical document 79, commit `7dc68ccb16b1b0494affe59def826c74d8165ce6`, decision ledger and recorded Q3/Q4 owner answers of 2026-10-08. Research is initially signed-in-member only; Eric Tse is the accountable editorial and rights owner. Quantitative Market Intel does not become an article store. Research search/detail and downstream AI must use the same member/rights boundary, with additional per-item AI permission. Assistant support does not approve source rights or replace the owner.

The exact older D-R-1–D-R-3 revision-2 document text was not recovered in this workspace; this implementation follows the later explicit owner decisions above and documents remaining runtime choices. No claim that all older contract gates are closed.

## What is built

- Strict metadata/rights model: ID/revision, title, publisher, canonical HTTPS URL, geography/topics, nullable publication/retrieval dates, attribution, permitted summary or link-only behavior, rights evidence/check/expiry, AI allowance and review cadence. No article-body field; unknown dates stay null.
- Separate private PostgreSQL store proposal: catalog version, latest item revision, staged revisions, active permitted publications and append-only audit. All five tables force RLS. Owner/reader/writer roles are NOLOGIN and unprivileged; reader cannot see drafts, rights evidence or audit. Neither the database nor this proposed schema has been selected for live Research.
- Manual stage → inspect → approve → publish lifecycle. Draft and approval remain private. A staged correction preserves the previous active publication until promotion. Withdrawal removes the whole item, including an older active revision. Revision/state checks reject stale commands. Audit, active pointer and catalog revision commit together; audit failure rolls back the change.
- Member list/detail API with bounded title/publisher search, geography/topic filters and pagination. Both use active publications only and exclude expired rights/overdue reviews. Unavailable identifiers give identical 404 envelopes. No backend catalog cache.
- Independent Research JWT verification and injected server-owned access authority. Permanent non-anonymous Supabase JWTs only, ES256/RS256, exact issuer/audience/expiry checks. No map-approval inheritance, user_metadata editorial grant, dev token, secret fallback or credential discovery.
- Unmounted, default-off Research router. Read/editor enabling requires explicit resources, access authority, Auth configuration and exact HTTPS origins. Editorial requests additionally require exact editor origin and live editor permission. Request budget, bounded body, no-store responses and opaque errors are included. No existing startup change.
- Read-only WeWeb component source with search/filter/page/detail/source-link UI. Default off; no editing-mode or automatic mount requests. Explicit session-host registration, cancellation/account-change checks, response limits, no localStorage/full text/HTML injection or direct database path. Visible snapshots clear after at most 30 seconds, earlier rights/review validity, host/session invalidation or hidden tab. A current selection reloads through the same server read boundary.

## Manual editorial workflow

1. Eric selects an item and checks source ownership and permissions. Record the evidence reference, permitted summary/link-only display, attribution, separate AI permission, rights expiry and next review date. Public availability does not count as clearance. Unknown/withheld rights may be staged but cannot be approved.
2. Prepare a strict `stage` command using `candidate-template.json`; fill all blank fields, keep unknown dates null and remove summary text for link-only records. For a new item use expectedRevision 0; for a correction use the current latest revision. Use a meaningful reason.
3. The future authorized editor sends `POST /v1/research/admin/changes`. Review the receipt; then use `GET /v1/research/admin/items/:id` to inspect the exact stored revision, rights evidence and latest 30 audit events. These are editor-only operations. They are not currently deployed.
4. After manually checking the stored record, send `approve` with the inspected ID/revision and a reason. Then independently send `publish` with that same revision. Publication rechecks rights and review validity. A 409 requires a fresh inspection; never silently retry or overwrite a newer revision.
5. Corrections are new staged revisions, not edits to a published body. For a rights change or withdrawal send `withdraw` against the latest revision with a reason. This removes active member reads and future authorized AI retrieval while retaining internal audit. Other already-open browsers are bounded snapshots, not instantaneous push clients: their content clears within 30 seconds or on the next refresh/invalidation. Live acceptance must verify this propagation bound.
6. Reassess rights/freshness before the recorded due dates. Expired rights or overdue reviews become unavailable until a newly reviewed revision is published. No automatic approval, scraping, downloading or AI summarization is included.

## Read routes and downstream boundaries

Proposed paths: `GET /v1/research/items`, `GET /v1/research/items/:id`, editor inspection and change paths above. Only `/items` and `/items/:id` are available through the browsing transport. Source URL clicks open the publisher website; InvestScape does not proxy/fetch it. Public Research, Market Intel composition, saved-item collections and an AI integration are not mounted. A future AI caller must first authorize the same member, then call the reader with consumer `ai`; items without aiAllowed are withheld. The reader itself is a private repository, not an authorization gateway.

## Offline verification

`npm run typecheck`; `npm run build`; `npm test`. Embedded PostgreSQL tests use only synthetic records and roles in disposable PGlite instances. No Supabase tables/users or real endpoints are queried. The component harness compiles the actual Vue SFC/styles and renders synthetic list/detail responses in Chromium. It checks default-off/editor behavior, escaped titles, nullable dates, summary rendering, eight light/dark viewport combinations (320/390/768/1100), withdrawal, sign-out and unmount. This is not installed-WeWeb or real-member acceptance.

Source verification references consulted 2026-10-09: Supabase changelog index, PostgreSQL 15.19/17.11 breaking-change notice, RLS and API security documentation. Proposal uses no affected ltree/pgcrypto/btree_gist/custom operators. No project-version or advisor scan was made. Private schema grants and forced RLS are defense in depth, not proof of live effective permissions.

## Remaining facts before live Dev wiring

1. Initial source records and per-item rights evidence; `approved-catalog.json` is intentionally empty. No live item has been approved or published.
2. Select the authoritative Research database/schema and review a scoped provisioning/recovery package. The SQL here is a disposable-database review proposal, not a Supabase migration or authorization to run it.
3. Bind the existing permanent app membership policy and Eric's verified editor identity server-side. No subject/email binding or role assignment has been inspected or installed; staff roles require separate explicit grants and audit.
4. Select an isolated API runtime; establish hosted app/API/editor origins, actual issuer/key compatibility, scoped reader/writer connections with TLS, effective privileges and installed session-host compatibility. No shared Quick/Full database URL is assumed and no map host is reused automatically.
5. Authorize/perform the eventual deployment and WeWeb registration/placement/publication separately; verify real member/editor denial, correction/withdrawal behavior and snapshot clearing. Only then enable Research. No billing entitlement or plan-access assumption is made.

## Current official references

- https://supabase.com/changelog.md
- https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api

