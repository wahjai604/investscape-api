-- Catalog metadata only. No user/session/article rows, credentials or environment exports.
SELECT current_setting('server_version') AS server_version,current_user AS operator_role,
  (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS operator_can_create_roles,
  EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='research_private') AS research_schema_exists,
  ARRAY(SELECT rolname FROM pg_roles WHERE rolname IN('research_owner','research_identity_owner','research_reader',
    'research_writer','research_authority','research_reader_login','research_writer_login','research_authority_login')) AS research_roles_present;
SELECT n.nspname AS schema_name,c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,
  has_column_privilege(current_user,c.oid,a.attnum,'SELECT WITH GRANT OPTION') AS operator_can_grant_column_select
FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid
WHERE n.nspname='auth' AND ((c.relname='users' AND a.attname IN('id','is_anonymous','banned_until','deleted_at'))
  OR(c.relname='sessions' AND a.attname IN('id','user_id','not_after'))) AND a.attnum>0 AND NOT a.attisdropped;
SELECT has_schema_privilege(current_user,'auth','USAGE') AS operator_auth_usage,
  has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION') AS operator_can_grant_auth_usage;
