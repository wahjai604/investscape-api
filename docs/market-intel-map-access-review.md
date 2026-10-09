# Market Intel manual membership — isolated API review

Date: 2026-10-08 America/Vancouver / 2026-10-09 UTC.
Base: `feat/native-full-api-adapter`, commit `2cec0ab519513a34aabbad909c4f24b1472d385c`.
Review branch: `review/market-intel-map-access-2026-10-08`.

The owner selected manual approval while an automated approval system remains undesigned. This candidate therefore requires both a verified session and a current server-controlled, manually approved `map_read` grant. Signing in, a matching email, or user-editable JWT metadata cannot approve membership. No real accounts, publisher appointments or staff capabilities are assigned.

## Implemented review slice

- Dedicated map verifier checks issuer, audience, signature, subject, expiry, authenticated role and explicitly non-anonymous status. Only ES256/RS256 are accepted; no shared-secret or development-token fallback. Expected issuer/audience are injected, with no environment reads. Public JWKS resolution is supported but tests inject local synthetic keys.
- Manual authority interface requires the verified issuer/subject tuple, approval reference/time/approver, active/unrevoked grant, expiry and `map_read`. The real authority store, provisioning procedure and append-only audit trail remain unimplemented.
- A router factory is **unmounted and disabled by default**. Its provisional `/v1/market-intel/map/views` test route checks authority before and after reading, rejects unsupported selections and only returns an explicit `unavailable / CATALOG_NOT_CONFIGURED` placeholder. Responses are uncached and omit account/grant identifiers.
- Grant replacement, observed mid-read revocation or expiry, dependency failures and malformed catalog results block delivery. These checks do not establish transactional revocation guarantees across a future database/HTTP response boundary.

Existing startup/router files, Quick/Full, shared Lighthouse authentication, engines, migrations, package dependencies and lockfile are unchanged. No deployment or live service testing accompanies this branch.

## Verification

On Node v24.19.0, typecheck and build passed. The offline repository suite completed with **544 tests: 542 passed, 2 skipped, 0 failed**. The two existing E85 Vancouver snapshot-dependent tests lack their external evidence files in this isolated checkout.

The new map slice contributes **36 passing tests**, including locally generated ES256/RS256 signatures, claim/algorithm/signature failures and real localhost HTTP requests with synthetic grants. Tests do not call deployed endpoints, Supabase JWKS/Auth, database tables or real users. The repository's database test command was not run.

## Remaining implementation

The deployed accepted Auth project/issuer is still unknown. Investscape-Dev (`hwhkgrwikczwztfnsjir`) is the intended independent Dev target, not a verified deployed acceptance fact. Explicit `is_anonymous: false` compatibility requires later authorized staged verification.

The full manifest/layer contracts, private catalog database adapter, scoped role/migration review, manual administration/audit storage, rights/publication enforcement in this API, geometry delivery, WeWeb wiring and performance acceptance remain pending. All pilot layers remain inactive. Preserve distinct catalog reader, ingestion, publication, migration and access-administration capabilities; manual member approval does not appoint the publisher or resolve these roles.

See InvestScape Docs 79–82 and the separate 30-test offline publication-policy reference for the broader contract and source-policy design. Those reference tests do not turn the placeholder router into a live map implementation.
