# Research Dev provisioning readiness — October 9, 2026 owner-local

Recorded after the support-submission phase. This review advances recovery and execution preparation; it does not apply SQL or activate Research.

## Current evidence

| Item | Status | Evidence |
|---|---|---|
| Supabase support inquiry | Submitted; reply pending | Verified acknowledgement at 2026-10-10T02:17:44.771Z; auth-schema-support-submission-2026-10-10.review.md |
| Backup listing | Freshly verified at 2026-10-10T02:45:07.364Z | Investscape-Dev Scheduled backups; newest physical point remains 2026-10-09T11:16:52Z; seven listed points |
| Recovery coverage | Still unresolved | Newest point predates map provisioning and later shared-project work; Storage objects excluded |
| PITR | Freshly verified disabled | Investscape-Dev Point in time page offers Enable add-on; no add-on action taken |
| Disabled-create package | Exact bytes preserved | SHA-256 15994ae4d3c3a34bd9a8620a609860305b25c5aefc756c978031f542c027fa76 |
| Empty teardown | Exact bytes preserved; separate review only | SHA-256 eda9e22b0c67d63d462ef615357541c91773850392a856ad1272da7384979d65 |
| Identity binding | Exact bytes preserved; blocked by narrow Auth USAGE authority | SHA-256 3cb76531a357612d9035a19e6717d9fe183cf94280f8a7cc715241068e6d4198 |

Backup pages inspected read-only:
- https://supabase.com/dashboard/project/hwhkgrwikczwztfnsjir/database/backups/scheduled
- https://supabase.com/dashboard/project/hwhkgrwikczwztfnsjir/database/backups/pitr

## Concrete recovery review

Recommended first route: use the next verified provider backup that covers the changes to be preserved, rather than enabling a paid add-on as part of this review. A later timestamp alone does not establish complete recovery coverage or authorize a shared-project restore. No new backup arrival or timing is guaranteed.

Before the disabled-create transaction, retain a non-secret recovery receipt with: project reference; actual backup/restore point; scope and excluded Storage objects; latest shared-project change that must be preserved; acceptable loss window; owner acceptance of that coverage; and the intended scoped failure response. If newer shared-project work falls outside the chosen point, stop and establish a current recovery basis. If a logical export is chosen instead, its contents, secure destination, credentials and export authorization require a separate concrete review; do not dump Auth or other application records to this workspace automatically.

Suggested operator statement after coverage is verified:
“I accept recovery reference [actual reference] for the isolated disabled Research create in Investscape-Dev. It preserves [verified shared-project state] with an accepted loss window of [explicit window] and excludes [verified exclusions]. This does not authorize a whole-project restore.”

No values or approvals have been prefilled. The empty-store teardown is a tested scoped cleanup option; it is not a backup, and does not demonstrate recoverability of unrelated shared-project state. Whole-project restoration, restore rehearsal, backup creation and paid add-ons remain separate actions.

## Ordered execution after the applicable gates

1. Confirm an accepted current recovery basis and explicit approval of the exact disabled-create hash; refresh project-scoped absence/privilege preflight immediately before any authorized application. Existing metadata remains historical until refreshed.
2. Apply only the unchanged disabled-create transaction, then run the existing permission-verification query and save the actual receipt. All eight roles remain NOLOGIN, identity remains stubbed, catalog empty and both runtime switches off. This step is not dependent on Supabase's Auth-schema reply, but its recovery/approval gates remain open.
3. Review Supabase's reply for the narrow schema USAGE path. Do not accept broad role membership or infer that support-submission acknowledgement resolves the grant. Bind identity separately only after effective grant authority and the concrete binding approval are established.
4. Verify Eric's real Investscape app subject/session and apply the separately approved initial appointment with its exact 365-day audited term. Nomination is not a live appointment.
5. Allocate the isolated Research host; confirm exact member/API/editor origins, scoped verified-TLS connections and installed WeWeb session compatibility. Credentials stay out of source and receipts. Perform real-session acceptance before any activation.
6. Stage only the four approved link-only records with actual revision conflict handling; review, approve and publish through the existing audit workflow. The 90-day source clearance cap remains unchanged. Activation and WeWeb publication require their own explicit authorization.

## Offline verification

Re-ran src/research/provisioning.test.ts and src/research/approval-package.test.ts: 13 passed, zero failures or skips. Disposable PostgreSQL fixtures verify the exact create and teardown, forced RLS and isolated roles, gateway/global-default resistance, rollback/refusal behavior, narrow identity authority, four approved links and the 365-day editor audit. These are offline checks, not managed-project execution or a live restore rehearsal. The complete application suite was not rerun.

Official backup documentation and current changelog were reviewed on October 10 UTC: https://supabase.com/docs/guides/platform/backups and https://supabase.com/changelog. The markdown changelog endpoint did not render in the retrieval tool; the HTML changelog was retrieved. No new Supabase feature or provider configuration was implemented.

No database mutation, backup/restore, paid add-on, credential inspection, service creation, deployment, WeWeb publication or map activation occurred. Source approvals and editor term do not require reconfirmation. Original v2 HTML, Quick/Full, maps and Relationship OS remain preserved. No background job remains running.
