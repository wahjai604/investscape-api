-- Run after approved disabled create, before any LOGIN, credential binding or identity activation.
-- Metadata only. Effective privileges must be reviewed; output absence is not automatic clearance.
SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls
  FROM pg_roles r WHERE r.rolname LIKE 'research_%' ORDER BY r.rolname;
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='research_private' AND c.relkind='r' ORDER BY c.relname;
SELECT p.proname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='research_private' ORDER BY p.proname;
SELECT role.rolname AS granted_role,member.rolname AS member_role,m.admin_option,m.inherit_option,m.set_option
  FROM pg_auth_members m JOIN pg_roles role ON role.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
  WHERE role.rolname LIKE 'research_%' OR member.rolname LIKE 'research_%' ORDER BY role.rolname,member.rolname;
SELECT r.rolname AS gateway_role,has_schema_privilege(r.oid,n.oid,'USAGE') AS schema_usage,
  has_schema_privilege(r.oid,n.oid,'CREATE') AS schema_create,
  EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind='r'
    AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS any_table_privilege,
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace=n.oid AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS any_function_execute
  FROM pg_roles r CROSS JOIN pg_namespace n WHERE n.nspname='research_private'
    AND r.rolname IN('anon','authenticated','service_role','authenticator');
SELECT runtime.rolname AS runtime_role,privileged.rolname AS privileged_role,
  pg_has_role(runtime.oid,privileged.oid,'MEMBER') AS is_member,pg_has_role(runtime.oid,privileged.oid,'SET') AS can_set_role
  FROM pg_roles runtime CROSS JOIN pg_roles privileged WHERE runtime.rolname IN('research_reader_login','research_writer_login','research_authority_login')
    AND privileged.rolname IN('research_owner','research_identity_owner','postgres','supabase_admin','service_role','authenticator');
-- Reachable foreign table and non-trigger definer paths: must be empty before live runtime binding.
SELECT r.rolname,n.nspname,c.relname FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE r.rolname IN('research_reader_login','research_writer_login','research_authority_login')
    AND n.nspname NOT IN('research_private','pg_catalog','information_schema') AND left(n.nspname,3)<>'pg_'
    AND c.relkind IN('r','p','v','m','f') AND has_schema_privilege(r.oid,n.oid,'USAGE')
    AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
SELECT r.rolname,n.nspname,p.proname FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE r.rolname IN('research_reader_login','research_writer_login','research_authority_login')
    AND n.nspname NOT IN('research_private','pg_catalog','information_schema') AND left(n.nspname,3)<>'pg_'
    AND p.prosecdef AND p.prorettype NOT IN('trigger'::regtype,'event_trigger'::regtype)
    AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE');
-- Auth function-owner grants are separate and should be absent at disabled-create stage.
SELECT c.relname,a.attname,has_column_privilege('research_identity_owner',c.oid,a.attnum,'SELECT') AS granted
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
WHERE n.nspname='auth' AND c.relname IN('users','sessions') AND a.attnum>0 AND NOT a.attisdropped;
