# Research Auth schema access — operator request draft

Prepared for Eric Tse to review. Not sent. No database grant performed.

Target: **Investscape-Dev**, `hwhkgrwikczwztfnsjir`. Research is default-off; the proposed private schema and roles do not exist yet.

We plan a narrowly scoped, private eligibility lookup owned by `research_identity_owner`, a NOLOGIN role without superuser, BYPASSRLS, role creation or database creation privileges. The application roles receive only a fixed boolean permission result, not raw Auth table access. Existing Auth and other applications remain unchanged.

Read-only catalog evidence refreshed Oct 10 UTC / Oct 9 owner-local date establishes:

- Connected operator `postgres` has Auth schema USAGE but lacks USAGE WITH GRANT OPTION.
- Auth schema owner is `supabase_admin`; `postgres` cannot SET that role.
- Earlier scoped metadata confirms the operator can grant SELECT on the seven proposed columns: `auth.users(id,is_anonymous,banned_until,deleted_at)` and `auth.sessions(id,user_id,not_after)`.

Please confirm the supported managed-Supabase procedure for an authorized schema-owner operator to grant **only** the following, after the isolated Research role exists and its creation has been separately approved:

```sql
GRANT USAGE ON SCHEMA auth TO research_identity_owner;
```

The request does not include CREATE, grant option, Auth mutation, table-wide SELECT, inherited authenticated/service_role/admin memberships, passwords, keys or access to user/session records. Please provide a non-secret verification receipt for the target project and exact grant, or explain why this procedure is unsupported. No attempt will be made to obtain or impersonate the internal schema-owner role.

Identity binding and its seven column grants remain a separately reviewed transaction. If the grant is unsupported, a different eligibility provider must be designed and verified against the same current-account and exact-session requirements before activation; a JWT-only check is not automatically accepted as equivalent.
