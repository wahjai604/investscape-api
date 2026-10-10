-- SEPARATE REVIEW ONLY. Not part of the disabled-create package.
-- Requires explicit approval of these narrow Auth column grants, current recovery reference and verified managed grantability.
-- No table changes, Auth data writes, hooks, user records, keys or identities are included.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
  IF current_user<>'postgres' OR COALESCE(current_setting('research.identity_receipt',true),'')
    !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    OR COALESCE(current_setting('research.identity_sha256',true),'') !~ '^[a-f0-9]{64}$'
    OR COALESCE(current_setting('research.recovery_reference',true),'') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    THEN RAISE EXCEPTION 'RESEARCH_IDENTITY_REVIEW_REQUIRED'; END IF;
  IF NOT has_schema_privilege('research_identity_owner','auth','USAGE')
    AND NOT has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION')
    THEN RAISE EXCEPTION 'RESEARCH_AUTH_SCHEMA_USAGE_REQUIRED'; END IF;
END $$;
SET LOCAL ROLE research_owner;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM research_private.runtime_settings WHERE singleton
    AND project_ref='hwhkgrwikczwztfnsjir' AND package_version='research-dev-1' AND NOT identity_bound)
    THEN RAISE EXCEPTION 'RESEARCH_IDENTITY_STATE_CONFLICT'; END IF;
END $$;
RESET ROLE;
-- Separate NOLOGIN projection owner only. No runtime role can enumerate auth.users/auth.sessions.
DO $$ BEGIN
  IF NOT has_schema_privilege('research_identity_owner','auth','USAGE') THEN
    GRANT USAGE ON SCHEMA auth TO research_identity_owner;
  END IF;
END $$;
GRANT SELECT(id,is_anonymous,banned_until,deleted_at) ON auth.users TO research_identity_owner;
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO research_identity_owner;
SET LOCAL ROLE research_owner;
GRANT CREATE ON SCHEMA research_private TO research_identity_owner;
RESET ROLE;
SET LOCAL ROLE research_identity_owner;
CREATE OR REPLACE FUNCTION research_private.identity_status(p_subject uuid,p_session uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
    WHERE u.id=p_subject AND s.id=p_session AND u.is_anonymous IS FALSE AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
      AND (s.not_after IS NULL OR s.not_after>statement_timestamp()))
$$;
ALTER FUNCTION research_private.identity_status(uuid,uuid) OWNER TO research_identity_owner;
REVOKE ALL ON FUNCTION research_private.identity_status(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research_private.identity_status(uuid,uuid) TO research_owner;
-- Fixed definition + exact subject/session match; returns one boolean only.
RESET ROLE;
SET LOCAL ROLE research_owner;
REVOKE CREATE ON SCHEMA research_private FROM research_identity_owner;
UPDATE research_private.runtime_settings SET identity_bound=true WHERE singleton;
INSERT INTO research_private.provisioning_ledger(version,source_sha256,receipt_reference,recovery_reference)
  VALUES('research-identity-bind-1',current_setting('research.identity_sha256'),
    current_setting('research.identity_receipt'),current_setting('research.recovery_reference'));
RESET ROLE;
COMMIT;
