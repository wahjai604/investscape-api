-- Executed metadata-only review on Investscape-Dev; no application rows, secrets, role changes or SET ROLE.
-- Administrative connector results do not establish independent runtime connection or TLS acceptance.

BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
WITH map_roles AS (
 SELECT oid,rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit
 FROM pg_roles WHERE rolname IN ('mi_map_owner','mi_map_reader','mi_map_access_writer','mi_map_ingester','mi_map_reader_login','mi_map_access_login')
), runtime_roles AS (SELECT * FROM map_roles WHERE rolname IN ('mi_map_reader_login','mi_map_access_login')),
 map_tables AS (SELECT c.oid,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,n.oid AS nspoid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND c.relkind='r')
SELECT jsonb_build_object(
 'role_attributes',(SELECT jsonb_agg(to_jsonb(r) - 'oid') FROM map_roles r),
 'private_schema_exists',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='mi_map_private'),
 'private_table_count',(SELECT count(*) FROM map_tables),
 'all_private_tables_forced_rls',(SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM map_tables),
 'private_schema_owner_is_map_owner',EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='mi_map_private' AND r.rolname='mi_map_owner'),
 'runtime_private_privileges',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS role_name,t.relname AS table_name,has_schema_privilege(r.oid,t.nspoid,'USAGE') AS schema_usage,has_schema_privilege(r.oid,t.nspoid,'CREATE') AS schema_create,has_table_privilege(r.oid,t.oid,'SELECT') AS can_select,has_table_privilege(r.oid,t.oid,'INSERT') AS can_insert,has_table_privilege(r.oid,t.oid,'UPDATE') AS can_update,has_any_column_privilege(r.oid,t.oid,'UPDATE') AS column_update,has_table_privilege(r.oid,t.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS broad_mutation FROM runtime_roles r CROSS JOIN map_tables t ORDER BY r.rolname,t.relname) x),
 'privileged_membership_paths',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS runtime_role,b.rolname AS privileged_role,pg_has_role(r.oid,b.oid,'MEMBER') AS member,pg_has_role(r.oid,b.oid,'USAGE') AS inherits,pg_has_role(r.oid,b.oid,'SET') AS can_set FROM runtime_roles r CROSS JOIN pg_roles b WHERE b.rolname IN ('mi_map_owner','postgres','supabase_admin','service_role','authenticator')) x),
 'gateway_private_access_denied',NOT EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN map_tables t WHERE r.rolname IN ('anon','authenticated','service_role','authenticator') AND (has_schema_privilege(r.oid,t.nspoid,'USAGE') OR has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES'))),
 'runtime_private_function_execute_denied',NOT EXISTS(SELECT 1 FROM runtime_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mi_map_private' AND has_function_privilege(r.oid,p.oid,'EXECUTE')),
 'shared_path_counts',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS runtime_role,
 has_database_privilege(r.oid,current_database(),'CONNECT') AS database_connect,
 has_schema_privilege(r.oid,'public','CREATE') AS public_schema_create,
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','investscape','auth','storage') AND c.relkind IN ('r','p','v','m') AND has_schema_privilege(r.oid,n.oid,'USAGE') AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS reachable_other_relation_count,
 (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','mi_map_private') AND n.nspname NOT LIKE 'pg_toast%' AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS reachable_non_system_function_count,
 (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','mi_map_private') AND n.nspname NOT LIKE 'pg_toast%' AND p.prosecdef AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS reachable_non_system_security_definer_count
 FROM runtime_roles r) x)
) AS dev_wiring_catalog_metadata;
ROLLBACK;

BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
WITH eligible_relations AS MATERIALIZED (
 SELECT c.oid,c.relkind,c.relnamespace FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema','mi_map_private') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p','v','m','f')
), eligible_sequences AS MATERIALIZED (
 SELECT c.oid,c.relnamespace FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema','mi_map_private') AND n.nspname NOT LIKE 'pg_%' AND c.relkind='S'
)
SELECT jsonb_build_object(
'private_tables_all_owned_by_map_owner',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='mi_map_private' AND c.relkind='r' AND r.rolname<>'mi_map_owner'),
'runtime_column_update_privileges',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS role_name,c.relname AS table_name,a.attname AS column_name FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE r.rolname IN ('mi_map_reader_login','mi_map_access_login') AND n.nspname='mi_map_private' AND c.relkind='r' AND has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') ORDER BY r.rolname,c.relname,a.attnum) x),
'all_non_system_path_counts',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.rolname AS runtime_role,
 (SELECT count(*) FROM eligible_relations c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE has_schema_privilege(r.oid,n.oid,'USAGE') AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS reachable_other_relation_count,
 (SELECT count(*) FROM eligible_sequences c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE has_schema_privilege(r.oid,n.oid,'USAGE') AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')) AS reachable_other_sequence_count
 FROM pg_roles r WHERE r.rolname IN ('mi_map_reader_login','mi_map_access_login')) x)
) AS dev_wiring_catalog_followup;
ROLLBACK;

BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object(
 'admin_update_policies',(SELECT jsonb_agg(jsonb_build_object('policy_name',p.polname,'command',p.polcmd,'using_is_false',pg_get_expr(p.polqual,p.polrelid)='false','with_check_is_false',pg_get_expr(p.polwithcheck,p.polrelid)='false')) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND c.relname='access_admin_grants' AND p.polcmd IN ('w','*')),
 'private_schema_policy_count',(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private')
) AS dev_wiring_policy_metadata;
ROLLBACK;
