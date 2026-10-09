-- READ ONLY: bounded pg_catalog metadata baseline, not a provisioning script.
-- Authorized Dev verification executed 2026-10-09; re-run only within that explicit scope.
-- No app-table/auth-user reads, function bodies, credentials or environment exports.
-- A single result envelope preserves empty intermediate sections in the SQL connector.
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object(
'section_1', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'schema_baseline' AS section, n.nspname AS schema_name,
  pg_get_userbyid(n.nspowner) AS owner_role,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE a.grantee=0 AND a.privilege_type='USAGE') AS public_usage,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE a.grantee=0 AND a.privilege_type='CREATE') AS public_create
FROM pg_namespace n WHERE n.nspname = 'mi_map_private') meta),
 'section_2', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'role_baseline' AS section, rolname AS role_name, rolcanlogin,
  rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit
FROM pg_roles WHERE rolname IN
  ('mi_map_owner','mi_map_reader','mi_map_access_writer','mi_map_ingester',
   'mi_map_reader_login','mi_map_access_login') ORDER BY rolname) meta),
 'section_3', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'broad_membership' AS section, r.rolname AS map_role, b.rolname AS broad_role,
  pg_has_role(r.oid, b.oid, 'MEMBER') AS membership_path
FROM pg_roles r CROSS JOIN pg_roles b
WHERE r.rolname IN ('mi_map_reader','mi_map_access_writer','mi_map_ingester',
  'mi_map_reader_login','mi_map_access_login')
  AND b.rolname IN ('postgres','supabase_admin','service_role','authenticator')) meta),
 'section_4', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'private_objects' AS section, c.relname AS object_name, c.relkind,
  pg_get_userbyid(c.relowner) AS owner_role, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='mi_map_private' ORDER BY c.relname) meta),
 'section_5', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'browser_schema_access' AS section, r.rolname AS gateway_role,
  has_schema_privilege(r.oid,n.oid,'USAGE') AS usage,
  has_schema_privilege(r.oid,n.oid,'CREATE') AS can_create
FROM pg_roles r CROSS JOIN pg_namespace n
WHERE n.nspname='mi_map_private'
  AND r.rolname IN ('anon','authenticated','service_role','authenticator')) meta),
 'section_6', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'browser_object_access' AS section, r.rolname AS gateway_role,
  c.relname AS object_name,
  has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
  has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
  has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
  has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
  has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='mi_map_private' AND c.relkind IN ('r','p','v','m','f')
  AND r.rolname IN ('anon','authenticated','service_role','authenticator')) meta),
 'section_7', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'private_function_access' AS section, p.proname AS function_name,
  p.prosecdef AS security_definer, r.rolname AS gateway_role,
  has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r
WHERE n.nspname='mi_map_private'
  AND r.rolname IN ('anon','authenticated','service_role','authenticator')) meta),
 'section_8', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'creation_defaults' AS section, pg_get_userbyid(d.defaclrole) AS creator_role,
  COALESCE(n.nspname,'GLOBAL') AS default_scope, d.defaclobjtype AS object_type,
  CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_role,
  a.privilege_type, a.is_grantable
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE (d.defaclnamespace=0 OR n.nspname='mi_map_private')
  AND (d.defaclrole IN (SELECT oid FROM pg_roles WHERE rolname IN ('postgres','mi_map_owner'))
       OR d.defaclrole IN (SELECT c.relowner FROM pg_class c JOIN pg_namespace x
         ON x.oid=c.relnamespace WHERE x.nspname='mi_map_private')
       OR d.defaclrole IN (SELECT p.proowner FROM pg_proc p JOIN pg_namespace x
         ON x.oid=p.pronamespace WHERE x.nspname='mi_map_private'))
  AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles
    WHERE rolname IN ('anon','authenticated','service_role','authenticator')))) meta),
 'section_9', (SELECT COALESCE(jsonb_agg(to_jsonb(meta)), '[]'::jsonb) FROM (SELECT 'candidate_exposed_function_surface' AS section, n.nspname AS schema_name,
  count(*) AS functions, count(*) FILTER (WHERE p.prosecdef) AS security_definers
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','investscape','graphql_public') GROUP BY n.nspname) meta)) AS metadata_baseline;
ROLLBACK;
