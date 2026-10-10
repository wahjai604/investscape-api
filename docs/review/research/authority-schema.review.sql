-- Review/disposable source only. Apply after catalog-schema.review.sql in an empty disposable database.
-- Automatic eligible permanent-member access; no enrollment rows or subscription gate.
BEGIN;
CREATE ROLE research_authority NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE research_identity_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
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
-- Minimal Auth projection is deliberately unbound. This stub reads no Auth user/session data.
CREATE FUNCTION research_private.identity_status(p_subject uuid,p_session uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT false $$;
ALTER FUNCTION research_private.identity_status(uuid,uuid) OWNER TO research_identity_owner;
REVOKE ALL ON FUNCTION research_private.identity_status(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research_private.identity_status(uuid,uuid) TO research_owner;
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
DO $$ DECLARE gateway text; BEGIN
  FOR gateway IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role','authenticator') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA research_private FROM %I',gateway);
  END LOOP;
END $$;
-- No real editor appointment, member restriction, Auth privileges or identity binding is installed.
COMMIT;
