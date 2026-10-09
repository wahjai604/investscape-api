-- Later runtime connection acceptance only. Not executed in this preparation slice.
-- Run through EACH independently scoped connection, never postgres or SET ROLE.
-- This reports only non-secret metadata; project/TLS hostname attestation is external.
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
DO $$ BEGIN
  IF current_user NOT IN ('mi_map_reader_login','mi_map_access_login') OR session_user<>current_user
    THEN RAISE EXCEPTION 'MAP_RUNTIME_PRINCIPAL_MISMATCH'; END IF;
END $$;
SELECT jsonb_build_object(
'principal',current_user,
'role_attributes',(SELECT jsonb_build_object('login',rolcanlogin,'superuser',rolsuper,
  'createdb',rolcreatedb,'createrole',rolcreaterole,'replication',rolreplication,
  'bypassrls',rolbypassrls,'connection_limit',rolconnlimit) FROM pg_roles WHERE rolname=current_user),
'private_schema_usage',has_schema_privilege(current_user,'mi_map_private','USAGE'),
'private_schema_create',has_schema_privilege(current_user,'mi_map_private','CREATE'),
'ledger_access',has_table_privilege(current_user,'mi_map_private.schema_receipts',
  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
'owner_membership',pg_has_role(current_user,'mi_map_owner','MEMBER'),
'owner_set',pg_has_role(current_user,'mi_map_owner','SET'),
'tls_transport',(SELECT jsonb_build_object('ssl',ssl,'version',version) FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
'private_rls',(SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='mi_map_private' AND c.relkind='r')
) AS map_runtime_acceptance;
ROLLBACK;
