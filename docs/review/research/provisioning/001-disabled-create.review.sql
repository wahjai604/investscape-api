-- REVIEW ONLY: disabled-create package for Investscape-Dev hwhkgrwikczwztfnsjir.
-- Not applied or registered in a migration runner. Receipts prevent accidents, not replace operator authorization.
-- No Auth grants, real identities, credentials, source publication or runtime activation.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
  IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcreaterole)
    THEN RAISE EXCEPTION 'RESEARCH_PROVISIONING_OPERATOR'; END IF;
  IF current_setting('server_version_num')::integer<170000 THEN RAISE EXCEPTION 'RESEARCH_POSTGRES_VERSION'; END IF;
  IF current_setting('research.target_ref',true) IS DISTINCT FROM 'hwhkgrwikczwztfnsjir'
    THEN RAISE EXCEPTION 'RESEARCH_TARGET_REQUIRED'; END IF;
  IF COALESCE(current_setting('research.provisioning_receipt',true),'') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    OR COALESCE(current_setting('research.recovery_reference',true),'') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    THEN RAISE EXCEPTION 'RESEARCH_REVIEW_RECOVERY_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='research_private')
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('research_owner','research_identity_owner','research_reader','research_writer','research_authority','research_reader_login','research_writer_login','research_authority_login'))
    THEN RAISE EXCEPTION 'RESEARCH_NAME_COLLISION'; END IF;
END $$;
-- Managed PG17 creator gets ADMIN automatically. SET only for the two owners; no ADMIN regrant cycle.
SET LOCAL createrole_self_grant='set';
CREATE ROLE research_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE research_identity_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SET LOCAL createrole_self_grant='';
CREATE ROLE research_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE research_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE research_authority NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE research_reader_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
CREATE ROLE research_writer_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
CREATE ROLE research_authority_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
    GRANT research_owner,research_identity_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET TRUE;
    GRANT research_reader,research_writer,research_authority,research_reader_login,research_writer_login,
      research_authority_login TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE;
  END IF;
END $$;
CREATE SCHEMA research_private AUTHORIZATION research_owner;
SET LOCAL ROLE research_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA research_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA research_private REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA research_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON SCHEMA research_private FROM PUBLIC;
GRANT USAGE ON SCHEMA research_private TO research_reader,research_writer;
CREATE TABLE research_private.catalog(singleton boolean PRIMARY KEY CHECK(singleton),revision integer NOT NULL CHECK(revision>=0));
INSERT INTO research_private.catalog VALUES(true,0);
CREATE TABLE research_private.items(id text PRIMARY KEY,revision integer NOT NULL CHECK(revision>0));
CREATE TABLE research_private.revisions(id text REFERENCES research_private.items(id),revision integer NOT NULL,
  draft jsonb NOT NULL,state text NOT NULL CHECK(state IN('staged','approved','published','withdrawn')),
  reviewed_at timestamptz,PRIMARY KEY(id,revision));
CREATE TABLE research_private.publications(id text PRIMARY KEY,revision integer NOT NULL,item jsonb NOT NULL,
  rights_valid_until timestamptz NOT NULL,review_due_at timestamptz NOT NULL,
  FOREIGN KEY(id,revision) REFERENCES research_private.revisions(id,revision));
CREATE TABLE research_private.audit(catalog_revision integer PRIMARY KEY,id text NOT NULL,revision integer NOT NULL,
  actor text NOT NULL,action text NOT NULL CHECK(action IN('stage','approve','publish','withdraw')),
  reason text NOT NULL,occurred_at timestamptz NOT NULL,FOREIGN KEY(id,revision) REFERENCES research_private.revisions(id,revision));
REVOKE ALL ON ALL TABLES IN SCHEMA research_private FROM PUBLIC;
ALTER TABLE research_private.catalog OWNER TO research_owner;
ALTER TABLE research_private.items OWNER TO research_owner;
ALTER TABLE research_private.revisions OWNER TO research_owner;
ALTER TABLE research_private.publications OWNER TO research_owner;
ALTER TABLE research_private.audit OWNER TO research_owner;
DO $$ DECLARE gateway text; BEGIN
  FOR gateway IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA research_private FROM %I',gateway);
  END LOOP;
END $$;
ALTER TABLE research_private.catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.items FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.publications FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.audit FORCE ROW LEVEL SECURITY;
GRANT SELECT ON research_private.catalog,research_private.publications TO research_reader;
CREATE POLICY catalog_read ON research_private.catalog FOR SELECT TO research_reader USING(true);
CREATE POLICY publications_read ON research_private.publications FOR SELECT TO research_reader
  USING(rights_valid_until>statement_timestamp() AND review_due_at>statement_timestamp());
GRANT SELECT,UPDATE ON research_private.catalog TO research_writer;
GRANT SELECT,INSERT,UPDATE ON research_private.items,research_private.revisions TO research_writer;
GRANT SELECT,INSERT,UPDATE,DELETE ON research_private.publications TO research_writer;
GRANT SELECT,INSERT ON research_private.audit TO research_writer;
CREATE POLICY catalog_write ON research_private.catalog TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY items_write ON research_private.items TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY revisions_write ON research_private.revisions TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY publications_write ON research_private.publications TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY audit_read ON research_private.audit FOR SELECT TO research_writer USING(true);
CREATE POLICY audit_append ON research_private.audit FOR INSERT TO research_writer WITH CHECK(true);
-- Audit has no UPDATE/DELETE grant. Readers cannot inspect drafts, evidence, reviewer subjects or audit.
-- Before any live provisioning, separately verify default ACLs, inherited roles, owner memberships and exposed schemas.
CREATE TABLE research_private.runtime_settings(singleton boolean PRIMARY KEY CHECK(singleton),
  package_version text NOT NULL,project_ref text NOT NULL,identity_bound boolean NOT NULL DEFAULT false);
INSERT INTO research_private.runtime_settings VALUES(true,'research-dev-1','hwhkgrwikczwztfnsjir',false);
CREATE TABLE research_private.member_restrictions(subject uuid PRIMARY KEY,blocked boolean NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),review_reference text NOT NULL CHECK(length(review_reference) BETWEEN 8 AND 500));
CREATE TABLE research_private.editor_grants(subject uuid PRIMARY KEY,active boolean NOT NULL,expires_at timestamptz NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),review_reference text NOT NULL CHECK(length(review_reference) BETWEEN 8 AND 500));
CREATE TABLE research_private.access_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject uuid,operation text NOT NULL,record_type text NOT NULL,operator_role text NOT NULL,
  review_reference text NOT NULL,before_record jsonb,after_record jsonb,occurred_at timestamptz NOT NULL DEFAULT statement_timestamp());
CREATE TABLE research_private.provisioning_ledger(version text PRIMARY KEY,source_sha256 text NOT NULL,
  receipt_reference text NOT NULL,recovery_reference text NOT NULL,applied_at timestamptz NOT NULL DEFAULT statement_timestamp());
ALTER TABLE research_private.runtime_settings OWNER TO research_owner;
ALTER TABLE research_private.member_restrictions OWNER TO research_owner;
ALTER TABLE research_private.editor_grants OWNER TO research_owner;
ALTER TABLE research_private.access_audit OWNER TO research_owner;
ALTER TABLE research_private.provisioning_ledger OWNER TO research_owner;
ALTER SEQUENCE research_private.access_audit_id_seq OWNER TO research_owner;
REVOKE ALL ON research_private.runtime_settings,research_private.member_restrictions,
  research_private.editor_grants,research_private.access_audit,research_private.provisioning_ledger FROM PUBLIC;
REVOKE ALL ON SEQUENCE research_private.access_audit_id_seq FROM PUBLIC;
ALTER TABLE research_private.runtime_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.runtime_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.member_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.member_restrictions FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.editor_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.editor_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.access_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.provisioning_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.provisioning_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_owner_read ON research_private.provisioning_ledger FOR SELECT TO research_owner USING(true);
CREATE POLICY ledger_owner_append ON research_private.provisioning_ledger FOR INSERT TO research_owner WITH CHECK(true);
CREATE POLICY settings_owner ON research_private.runtime_settings TO research_owner USING(true) WITH CHECK(true);
CREATE POLICY restrictions_owner ON research_private.member_restrictions TO research_owner USING(true) WITH CHECK(true);
CREATE POLICY editors_owner ON research_private.editor_grants TO research_owner USING(true) WITH CHECK(true);
CREATE POLICY access_audit_owner_read ON research_private.access_audit FOR SELECT TO research_owner USING(true);
CREATE POLICY access_audit_owner_append ON research_private.access_audit FOR INSERT TO research_owner WITH CHECK(true);
GRANT USAGE ON SCHEMA research_private TO research_authority,research_identity_owner;
GRANT SELECT ON research_private.runtime_settings TO research_reader,research_writer,research_authority;
CREATE POLICY settings_runtime_read ON research_private.runtime_settings FOR SELECT
  TO research_reader,research_writer,research_authority USING(true);
-- Temporary schema CREATE solely for the fixed, disabled identity stub; removed in this transaction.
GRANT CREATE ON SCHEMA research_private TO research_identity_owner;
RESET ROLE;
SET LOCAL ROLE research_identity_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA research_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE FUNCTION research_private.identity_status(p_subject uuid,p_session uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT false $$;
ALTER FUNCTION research_private.identity_status(uuid,uuid) OWNER TO research_identity_owner;
REVOKE ALL ON FUNCTION research_private.identity_status(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research_private.identity_status(uuid,uuid) TO research_owner;
RESET ROLE;
SET LOCAL ROLE research_owner;
REVOKE CREATE ON SCHEMA research_private FROM research_identity_owner;
-- Legitimate narrow definer: lookup only, same statement snapshot, private schema, fixed search path,
-- no user metadata, SQL interpolation, app-table lookup, identity export or mutation.
CREATE FUNCTION research_private.resolve_access(p_issuer text,p_subject uuid,p_session uuid)
  RETURNS TABLE(ready boolean,member boolean,editor boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg research_private.runtime_settings%ROWTYPE;eligible boolean;
BEGIN
  SELECT * INTO cfg FROM research_private.runtime_settings WHERE singleton;
  IF NOT FOUND OR NOT cfg.identity_bound OR cfg.project_ref<>'hwhkgrwikczwztfnsjir'
    OR cfg.package_version<>'research-dev-1' THEN
    RETURN QUERY SELECT false,false,false; RETURN;
  END IF;
  IF p_issuer IS DISTINCT FROM 'https://hwhkgrwikczwztfnsjir.supabase.co/auth/v1' OR p_subject IS NULL OR p_session IS NULL THEN
    RETURN QUERY SELECT true,false,false; RETURN;
  END IF;
  eligible:=research_private.identity_status(p_subject,p_session) IS TRUE
    AND NOT EXISTS(SELECT 1 FROM research_private.member_restrictions WHERE subject=p_subject AND blocked);
  RETURN QUERY SELECT true,eligible,eligible AND EXISTS(SELECT 1 FROM research_private.editor_grants
    WHERE subject=p_subject AND active AND expires_at>statement_timestamp());
END $$;
ALTER FUNCTION research_private.resolve_access(text,uuid,uuid) OWNER TO research_owner;
REVOKE ALL ON FUNCTION research_private.resolve_access(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research_private.resolve_access(text,uuid,uuid) TO research_authority;
CREATE FUNCTION research_private.audit_access_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RESEARCH_ACCESS_DELETE_DENIED'; END IF;
  INSERT INTO research_private.access_audit(subject,operation,record_type,operator_role,review_reference,before_record,after_record)
    VALUES(NEW.subject,TG_OP,TG_TABLE_NAME,session_user,NEW.review_reference,
      CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END $$;
ALTER FUNCTION research_private.audit_access_change() OWNER TO research_owner;
REVOKE ALL ON FUNCTION research_private.audit_access_change() FROM PUBLIC;
CREATE TRIGGER restrictions_audit BEFORE INSERT OR UPDATE OR DELETE ON research_private.member_restrictions
  FOR EACH ROW EXECUTE FUNCTION research_private.audit_access_change();
CREATE TRIGGER editors_audit BEFORE INSERT OR UPDATE OR DELETE ON research_private.editor_grants
  FOR EACH ROW EXECUTE FUNCTION research_private.audit_access_change();
CREATE FUNCTION research_private.deny_history_mutation() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'RESEARCH_HISTORY_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION research_private.deny_history_mutation() FROM PUBLIC;
CREATE TRIGGER content_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON research_private.audit
  FOR EACH STATEMENT EXECUTE FUNCTION research_private.deny_history_mutation();
CREATE TRIGGER access_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON research_private.access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION research_private.deny_history_mutation();
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON research_private.provisioning_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION research_private.deny_history_mutation();
INSERT INTO research_private.provisioning_ledger VALUES('research-dev-1','c43ac209c02c92f1a7c4ebcc713dc99616af98781f931b5120d98b4540dee23f',
  current_setting('research.provisioning_receipt'),current_setting('research.recovery_reference'),statement_timestamp());
-- Only explicit private objects. Global/other product defaults remain unchanged.
REVOKE ALL ON ALL TABLES IN SCHEMA research_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA research_private FROM PUBLIC;
REVOKE ALL ON FUNCTION research_private.resolve_access(text,uuid,uuid),research_private.audit_access_change(),
  research_private.deny_history_mutation() FROM PUBLIC;
DO $$ DECLARE gateway text; BEGIN
  FOR gateway IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role','authenticator') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON FUNCTION research_private.resolve_access(text,uuid,uuid),research_private.audit_access_change(),research_private.deny_history_mutation() FROM %I',gateway);
  END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE research_identity_owner;
REVOKE ALL ON FUNCTION research_private.identity_status(uuid,uuid) FROM PUBLIC;
DO $$ DECLARE gateway text; BEGIN
  FOR gateway IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role','authenticator') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION research_private.identity_status(uuid,uuid) FROM %I',gateway);
  END LOOP;
END $$;
RESET ROLE;
GRANT research_reader TO research_reader_login WITH ADMIN FALSE,INHERIT TRUE,SET FALSE;
GRANT research_writer TO research_writer_login WITH ADMIN FALSE,INHERIT TRUE,SET FALSE;
GRANT research_authority TO research_authority_login WITH ADMIN FALSE,INHERIT TRUE,SET FALSE;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO research_reader_login,research_writer_login,research_authority_login',current_database());
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='research_private' AND c.relkind='r')<>10
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='research_private' AND c.relkind='r' AND
      (pg_get_userbyid(c.relowner)<>'research_owner' OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity))
    THEN RAISE EXCEPTION 'RESEARCH_OWNER_RLS_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('research_owner','research_identity_owner','research_reader','research_writer','research_authority','research_reader_login','research_writer_login','research_authority_login')
    AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
    THEN RAISE EXCEPTION 'RESEARCH_ROLE_ATTRIBUTES'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_namespace n WHERE n.nspname='research_private'
    AND r.rolname IN('anon','authenticated','service_role','authenticator')
    AND (has_schema_privilege(r.oid,n.oid,'USAGE') OR has_schema_privilege(r.oid,n.oid,'CREATE')))
    OR EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='research_private' AND c.relkind='r' AND r.rolname IN('anon','authenticated','service_role','authenticator')
      AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    OR EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='research_private' AND r.rolname IN('anon','authenticated','service_role','authenticator')
      AND has_function_privilege(r.oid,p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'RESEARCH_GATEWAY_ACCESS'; END IF;
END $$;
COMMIT;
