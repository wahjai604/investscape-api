# Research live prerequisite review — Oct 9 owner-local / Oct 10 UTC

Code remains pinned to `3223f49de6adfd2b394f73d2309cd5646631bae9`. This follow-up changes evidence and review documents only; it does not apply the disabled-create or identity-binding package.

## Freshly verified

- Secure ChatGPT sign-in succeeded. Investscape-Dev Scheduled backups lists **2026-10-09T11:16:52Z** as its newest physical backup, plus six earlier daily points. The point-in-time page offers an add-on; PITR is not enabled. No restore, backup creation or add-on action occurred.
- The listing gap is closed. The recovery-basis gate stays open: that point predates map provisioning and later shared-project work. Storage objects are excluded by the displayed backup notice. No current post-change point or restore rehearsal was established.
- Project-scoped, read-only system catalogs still show operator `postgres`, CREATEROLE true, Auth schema owner `supabase_admin`, operator Auth USAGE true, grant option false and owner SET false. Research schema remains absent. No Auth/user/session rows were read.
- Railway project discovery shows no proposed **InvestScape Research Dev** project. Existing **InvestScape Native Full Staging** was not changed or used as a Research target.
- WeWeb discovery confirms Investscape Dev MCP access and an installed Supabase integration connection `40c528bb-150f-4ecc-9aff-846cd113dbc9`. Discovery also lists other installed Auth integrations. This does not identify the effective Auth provider, installed legacy version/accessor, hosted origins or a real Research session.

## Concrete next operations

1. Establish a recovery basis covering current shared-project work before applying the pinned disabled-create transaction. Its reviewed empty-store teardown is a separate scoped option; no whole-project restore is authorized.
2. Use `auth-schema-operator-request.review.md` to obtain a supported schema-owner path. It is a draft for Eric, not sent. The connected operator cannot perform the narrow grant, and dashboard sign-in does not change that.
3. Record the owner's exact article decisions, then verify/appoint the editor's actual app subject through the approved private ledger. Supabase dashboard or WeWeb workspace ownership is not evidence of that subject.
4. Allocate an isolated Research Dev host and establish exact app/API/editor origins, scoped TLS connections and installed-session acceptance before deployment/activation. No origins, credentials or deployed configuration are inferred from names.

## Consolidated owner decisions, pending

**A — Initial source clearance:** Approve the four exact link-only draft commands listed in `source-approval-worksheet.review.json`, with attributed metadata, original publisher links, no summaries/full text/assets/AI use, and a 90-day operational clearance/review cap after approval. The command hashes and publisher-condition evidence remain unchanged.

| Exact record | Publisher | Proposed title |
|---|---|---|
| statcan-affordability-2024 | Statistics Canada | Housing affordability in Canada, 2024 |
| statcan-rental-conundrum | Statistics Canada | The Canadian rental conundrum |
| boc-renewal-payments-2025 | Bank of Canada | How will mortgage payments change at renewal? An updated analysis |
| boc-mortgage-loan-data-2025 | Bank of Canada | Using new loan data to better understand mortgage holders |

This decision is editorial/rights clearance only; it does not stage or publish records or authorize other database operations. Other four candidates remain held.

**B — Editor nomination:** Nominate Eric Tse as the sole initial Research editor, for 90 days from actual audited appointment, with a renewal review. Subject UUID must be verified from his existing Investscape app account before appointment. Proposed capabilities: Research stage/review/approve/publish/archive through the existing audited editorial workflow; no application-wide, map, Auth-admin or other-product permissions. No identity or grant has been inserted. Nomination is not proof of identity or completion of a live permission grant.

Disabled provisioning and identity binding remain separate execution reviews after their applicable recovery/privilege gates. Production rollout and WeWeb publication require explicit authorization.

## Validation and preservation

Only evidence/review documents changed. Manifest-pinned SQL hashes checked unchanged. Prior code acceptance remains 661 passing tests, zero failures, two existing skips; code was not modified or retested in this evidence-only follow-up. No credentials, environment values, raw JWTs or user/session records inspected. No database mutation, service creation, deployment, article publication or map activation performed. Original v2 HTML, Quick/Full staging, maps and Relationship OS preserved. No background task remains running.

