-- Read-only executed acceptance queries, fixed to the new map schema/roles.
-- Three single-result envelopes; no user identities or application rows returned.
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object(
'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT version, source_ddl_sha256, receipt_ref, applied_at FROM mi_map_private.schema_receipts WHERE version='map-private-v1') x),
'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT r.rolname AS granted_role, b.rolname AS member_role,g.rolname AS grantor_role,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles b ON b.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE r.rolname LIKE 'mi_map_%' OR b.rolname LIKE 'mi_map_%' ORDER BY r.rolname,b.rolname) x),
'table_count',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND c.relkind='r'),
'function_count',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mi_map_private'),
'policy_count',(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private'),
'trigger_count',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND NOT t.tgisinternal),
'initial_store_counts',jsonb_build_object(
'access_admin_grants',(SELECT count(*) FROM mi_map_private.access_admin_grants),
'member_grants',(SELECT count(*) FROM mi_map_private.member_grants),
'approval_audit',(SELECT count(*) FROM mi_map_private.approval_audit),
'source_products',(SELECT count(*) FROM mi_map_private.source_products),
'rights_controls',(SELECT count(*) FROM mi_map_private.rights_controls),
'catalog_releases',(SELECT count(*) FROM mi_map_private.catalog_releases),
'observations',(SELECT count(*) FROM mi_map_private.observations),
'publication_heads',(SELECT count(*) FROM mi_map_private.publication_heads))
) AS map_provisioning_verification;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object(
'role_attributes',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit FROM pg_roles WHERE rolname IN ('mi_map_owner','mi_map_reader','mi_map_access_writer','mi_map_ingester','mi_map_reader_login','mi_map_access_login') ORDER BY rolname) x),
'runtime_privileges',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS role_name,c.relname AS table_name,
 has_schema_privilege(r.oid,n.oid,'USAGE') AS schema_usage,has_schema_privilege(r.oid,n.oid,'CREATE') AS schema_create,
 has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
 has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,has_any_column_privilege(r.oid,c.oid,'UPDATE') AS any_column_update,
 has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate,
 has_table_privilege(r.oid,c.oid,'REFERENCES') AS can_reference,has_table_privilege(r.oid,c.oid,'TRIGGER') AS can_trigger,
 has_table_privilege(r.oid,c.oid,'MAINTAIN') AS can_maintain
 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='mi_map_private' AND c.relkind='r' AND r.rolname IN ('mi_map_reader','mi_map_access_writer','mi_map_ingester','mi_map_reader_login','mi_map_access_login') ORDER BY r.rolname,c.relname) x),
'gateway_column_access',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS gateway_role,c.relname AS table_name,has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') AS has_column_access FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND c.relkind='r' AND r.rolname IN ('anon','authenticated','service_role','authenticator')) x),
'role_escalation_paths',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS runtime_role,b.rolname AS privileged_role,pg_has_role(r.oid,b.oid,'MEMBER') AS is_member,pg_has_role(r.oid,b.oid,'USAGE') AS inherits,pg_has_role(r.oid,b.oid,'SET') AS can_set FROM pg_roles r CROSS JOIN pg_roles b WHERE r.rolname IN ('mi_map_reader','mi_map_access_writer','mi_map_ingester','mi_map_reader_login','mi_map_access_login') AND b.rolname IN ('mi_map_owner','postgres','supabase_admin','service_role','authenticator')) x),
'private_functions',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT p.proname,pg_get_userbyid(p.proowner) AS owner_role,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mi_map_private' ORDER BY p.proname) x),
'policies',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT c.relname AS table_name,p.polname,p.polcmd,p.polpermissive,ARRAY(SELECT pg_get_userbyid(r) FROM unnest(p.polroles) r) AS role_names,pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' ORDER BY c.relname,p.polname) x),
'map_objects_outside_private_schema',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname IN ('mi_map_owner','mi_map_reader','mi_map_access_writer','mi_map_ingester','mi_map_reader_login','mi_map_access_login') AND n.nspname<>'mi_map_private')
) AS permission_acceptance;
ROLLBACK;
BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object(
'triggers',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT c.relname AS table_name,t.tgname,t.tgenabled,t.tgtype,p.proname AS function_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='mi_map_private' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname) x),
'gateway_all_table_privileges_denied',NOT EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND c.relkind='r' AND r.rolname IN ('anon','authenticated','service_role','authenticator') AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')),
'runtime_function_execute_denied',NOT EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mi_map_private' AND r.rolname IN ('mi_map_reader','mi_map_access_writer','mi_map_ingester','mi_map_reader_login','mi_map_access_login') AND has_function_privilege(r.oid,p.oid,'EXECUTE'))
) AS final_acceptance;
ROLLBACK;
