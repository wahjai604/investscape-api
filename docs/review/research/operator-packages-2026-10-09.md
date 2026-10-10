# Research operator packages — October 9 owner-local / October 10 UTC

Owner source approvals and the 365-day editor nomination from Doc 87 remain authoritative. This follow-up prepares concrete execution inputs and validates them offline; it does not provision, deploy, assign the editor or publish sources.

## Prepared and verified

- `cleared-source-stage-commands.review.json`: four stage commands derived from the exact approved original hashes. Source metadata and attribution are preserved. Only the listed rights/review fields and stage reason change to materialize link-only clearance. Source expiry and review cap remain **2027-01-08T01:49:04Z**, not 365 days. Commands contain no bodies, assets, summaries or AI clearance.
- `editor-appointment.review.sql` plus its JSON manifest: a separate initial appointment for the verified existing app subject/session. Target project and exact provisioning/identity-binding hashes are guarded. The function confirms current eligible membership before inserting a grant. Expiry is computed **365 days from the actual audited appointment**, not the nomination date. One explicit transaction inserts the grant and its existing atomic audit; an audit failure rolls back everything. Existing editor records stop the candidate rather than overwrite or renew them. No additional roles, memberships or Auth grants are created.
- The appointment requires a real app-identity verification receipt and appointment receipt. Receipt syntax does not prove that a UUID belongs to Eric; actual subject verification remains a distinct operator prerequisite. UUIDs are absent from the review package and are never emitted by its SQL.
- Stage commands use expected revision zero as an insertion guard, not as proof of current store state. Stop and inspect conflicts. Approval/publication remain separate editorial transitions through the existing audited workflow; no automatic four-command publication sequence is prepared.

## Validation

Five new offline acceptance checks passed, zero failures; typecheck passed. Tests validate four exact approved links and cap expiry, the 365-day grant/audit interval, rejection of an existing grant, unbound identity, wrong session, suspension, missing receipt, wrong target and audit rollback. PostgreSQL fixtures contain synthetic identities only. No production code changed. Existing runtime acceptance remains historical 661 passing tests plus two existing skips; the complete suite was not rerun for this review package.

The pinned disabled-create, empty-teardown and identity-binding SQL hashes are unchanged. Neither new package is in startup, automatic migrations or the disabled-create transaction. The approved reader catalog remains empty.

## Current blockers and next sequence

The scoped system-catalog refresh still finds `research_private` absent, Auth schema owner `supabase_admin`, and connected `postgres` unable to grant schema USAGE or SET its owner. No privilege attempt or mutation was made. Current browser inspection redirects to sign-in again; it does not contradict the prior successful login/listing, but no newer listing was retrieved in this turn. Last verified newest physical backup remains **Oct 9 11:16:52Z**, before map provisioning; PITR was verified disabled in the earlier inspection. Current recovery coverage remains unapproved.

1. Obtain a recovery basis preserving current shared-project work, then review/apply and verify only the disabled-create package.
2. Obtain a supported Auth schema-owner grant/provider path, then bind and verify identity separately. The prepared `auth-schema-operator-request.review.md` is an **unsent draft**; no contact with Supabase was authorized or made.
3. Verify Eric's actual Investscape app subject, then use the separately reviewed 365-day appointment candidate and confirm its private audit.
4. Allocate the isolated Research Dev host and bind exact HTTPS member/API/editor origins and scoped TLS reader/writer/authority connections; perform real-session acceptance.
5. Execute the cleared stage commands through the normal authorized editorial workflow, inspect actual revisions, approve and publish separately, and activate only after acceptance and authorization.

The sources and editor term do not need owner reconfirmation. This work does not authorize production rollout, WeWeb publication or live maps. No background job remains running.

