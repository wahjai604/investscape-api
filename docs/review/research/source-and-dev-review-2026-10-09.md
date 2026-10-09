# Research sources and Dev wiring review — 2026-10-09

Review package only. No live source staging, rights approval, database provisioning, deployment or WeWeb publication. The approved catalog remains empty. Maps remain deferred.

## Initial selection

Eight candidates across six publishers are recorded as strict stage-command drafts in `initial-catalog.review.json`. All still have unknown rights, null owner decisions and no publication validity. A verified publisher licence is evidence for the owner's decision, not an automatic editorial approval.

| Publisher | Candidate subjects | Evidence result | Proposed first use |
|---|---|---|---|
| Statistics Canada | Affordability; rental market | Open licence and explicit text-link guidance verified | Two attributed source links for owner review |
| Bank of Canada | Mortgage renewals; mortgage loan data | Current reuse terms verified | Two source links; disclose source content is freely available |
| CMHC | Evictions and vulnerability | General terms plus selected PDF copyright page 8 inspected | Link candidate pending item-specific decision |
| Metro Vancouver | Housing and transportation costs | Copyright notice inspected; composite study | Link candidate pending item-specific decision |
| BC government | Local housing planning | Planning page/general copyright fetch failed; OGL-BC does not establish this guide's licence | Hold pending current page and permissions evidence |
| US Census Bureau | Housing cycles | Article verified; copyright policy retrieval failed | Link candidate pending permissions evidence |

`source-permissions.review.json` records exact official evidence URLs, findings and unresolved conditions. No article bodies, publisher summaries, images, logos or automated ingestion are proposed. AI permission stays off. Later summaries require a separate per-item decision. Free member access does not itself establish a noncommercial copyright exception.

Known publication days remain YYYY-MM-DD. Sources giving only a month keep `publishedAt` null and retain the original month label privately; no first day or publication timezone is invented. Geography tags are qualitative relevance labels, not numerical map joins or verified statistical boundaries.

The proposed internal review interval is 90 days after owner approval, subject to operator choice and earlier publisher conditions. The current model's mandatory `rights.validUntil` is a runtime clearance cap; an internal cap is not a claim that the publisher licence expires then. Record that distinction in the evidence and renew the item before either operational review or clearance lapses.

## Access

The owner's clarification is recorded in `access-policy.review.json`: active permanent signed-in free, paid and downgraded-to-free members receive the same Research browsing access. No billing entitlement is required. Anonymous, inactive and suspended accounts are denied. Editorial access requires a separate server-owned audited grant. Community moderation is separate.

The inspected source's occupational `user_profiles.role` is not an editorial authority. The authoritative active/inactive membership source and editor grant source remain unbound. The existing injected authority interface is not a live membership implementation.

## Dev review

| Component | Evidence class | Finding | Required next fact |
|---|---|---|---|
| Investscape-Dev `hwhkgrwikczwztfnsjir` | Fresh metadata, Oct 9 | ACTIVE_HEALTHY; PostgreSQL 17.6; proposed Research schema and three roles absent | Owner database selection, scoped recovery/provisioning review |
| Database permission catalogs | Fresh scoped metadata, Oct 9 | No matching inspected default ACL entries | Full effective privileges and role paths; absence alone is insufficient |
| WeWeb Investscape Dev | Fresh project/page search, Oct 9 | Project accessible; no Research page found | Installed component/session contract and exact hosted origin |
| Native Full Staging on Railway | Fresh environment metadata, Oct 9 | Existing staging service remains on `feat/native-full-api-adapter`; successful Oct 4 deployment | Preserve this service; select isolated Research runtime |
| Auth/session/editor origin | Historical reported evidence, Oct 9 | Same Dev Auth ref, getSession/auth events, ECC P-256 summary and editor origin reported earlier | Fresh installed compatibility, hosted origin, actual API JWT acceptance |
| Recovery | Historical owner screenshot report | Scheduled physical backup at 11:16:52Z, before subsequent map provisioning | Appropriate current recovery reference; no restore rehearsal established |
| Research runtime/source | Source intention | Unmounted router; default-off component; no dedicated Research host entrypoint | Dedicated host implementation plus explicit Dev bindings |

Concrete proposal: use a separate `research_private` schema in the existing Dev project, with scoped server reader/writer connections, and a new Railway **InvestScape Research Dev / development / research-api-dev** host. These are proposals, not selected or created resources. Exact IDs, origins, connection bindings and a deployed commit are not established for that proposed host. No browser Supabase Data API path is proposed.

The current generic `src/index.ts` also serves calculation/Lighthouse routes. Deploying it as-is would not provide a Research-only host. Build a dedicated default-off entrypoint before any runtime deployment. Do not copy connection values or repurpose the Quick/Full staging service.

`dev-storage-wiring.review.json` records the non-secret IDs, scopes and evidence limitations. No user/application tables or raw environment values were inspected. This review does not establish any shared transaction domain with Relationship OS.

## Next build scope

1. Obtain the owner's decisions on the four Statistics Canada/Bank of Canada link candidates and on the proposed Dev database target. Resolve the held publishers individually; they need not block a smaller initial catalog.
2. Implement the dedicated default-off Research host and explicit member/editor authority contract in source. Continue synthetic checks without live identity bindings.
3. Prepare the scoped recovery/DDL/permissions package and exact runtime bindings for review. Provisioning, deployment, source publication and WeWeb activation require their concrete readiness checks.
