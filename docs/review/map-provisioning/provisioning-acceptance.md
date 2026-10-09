# Disabled Dev provisioning and permission acceptance

**Freshly verified — 2026-10-09.** The exact approved package committed once in **Investscape-Dev**, project ref `hwhkgrwikczwztfnsjir`, on managed PostgreSQL 17.6 at **15:17:48 UTC / 08:17:48 America/Vancouver**. The owner's 08:12:09 instruction explicitly authorized disabled provisioning and permission verification. [Execution receipt](applied-receipt-2026-10-09.json), [non-secret permission evidence](permission-evidence-2026-10-09.json) and [read-only acceptance queries](permission-verification.sql) preserve the result.

| Check | Measured result |
| --- | --- |
| Exact approved candidate | SHA256 efbe815271d4cd703a0b4e71a18ff2e5a640ef9dd79ce94769bed5c8dc93305d; unchanged bytes |
| Execution | One successful apply_migration call; candidate's BEGIN/COMMIT encloses all create work and assertions |
| Independent map ledger | map-private-v1 with matching source hash and map-dev-disabled-create-20261009-owner-081209 reference |
| Tool migration history | market_intel_map_private_v1_disabled, version 20261009151748; independently read back |
| Private ownership | mi_map_private and its 9 tables / 15 indexes / 6 invoker functions owned by mi_map_owner |
| RLS / policies / triggers | All 9 tables enabled and forced; 19 policies; 10 enabled triggers, including receipt UPDATE/DELETE/TRUNCATE denial |
| Disabled roles | All 6 NOLOGIN; no SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS; future connection roles limited to 2 |
| Runtime capability inheritance | reader_login → reader and access_login → access_writer only; INHERIT=true, ADMIN=false, SET=false |
| Effective map permissions | All 45 capability/table combinations match intended SELECT/INSERT/UPDATE and column-lock grants; no DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN |
| Gateway isolation | anon, authenticated, service_role, authenticator denied schema, 36 table/column combinations and 24 function combinations, including inherited privileges |
| Escalation paths | 25 runtime-to-owner/broad-role combinations denied MEMBER, USAGE and SET |
| Initial stores | Zero access admins, members, approval audit, products, rights, releases, observations and publication heads |
| Security advisor | No findings relating to the new private map schema; unrelated notices were neither changed nor copied |

The submission envelope adds a non-secret receipt SET before the unchanged candidate and RESET after it, in the same migration request. The candidate hash and envelope hash are recorded separately. The source review SQL retains its original historical “not applied” comments to preserve approved bytes; the receipt and package manifest carry current status. The tool's migration-history write is verified separately from the candidate transaction. No database credentials or real identity rows were returned.

Managed PostgreSQL exposes the creator's ADMIN memberships via supabase_admin, and a separate postgres-granted owner membership supplies SET=true, INHERIT=false. These are operator authority, not runtime authority. No broad or owner membership is granted to map capability roles. An initial verification assumption that no owned objects could exist outside the private namespace was refined using a bounded catalog read: the 18 additional objects are exactly 9 internal TOAST tables and 9 indexes linked to the private tables. No user-facing objects were created in another schema. Global default privileges were not changed.

The previously supplied recovery reference remains **Historical reported evidence**: PHYSICAL backup 2026-10-09T11:16:52Z, listed with Restore, PITR disabled. It was 4 hours 0 minutes 56 seconds before this commit. Restoration was not performed or tested and would affect the whole Dev project.

This is catalog and effective privilege acceptance on the managed database. Real runtime connections remain disabled, so no authenticated API/WeWeb session, connection/TLS or independent-server concurrency acceptance is claimed. Shared PUBLIC privileges and other exposed-function paths still require bounded review before future LOGIN enablement. The SQL owner can alter its own objects; this ledger is operational traceability rather than independent tamper proof audit.

Next: establish the installed legacy Auth/session compatibility and exact app/API origins, then prepare the scoped Dev runtime/WeWeb wiring and trusted admin-bootstrap package for review. LOGIN/password/credential delivery, administrator/publisher appointments, API deployment, WeWeb component/page publication and map activation remain later authorized scopes. Existing Lighthouse and Relationship OS runners/ledgers were not used or changed.
