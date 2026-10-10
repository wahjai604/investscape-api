-- REVIEW ONLY: empty, disabled Research teardown. No CASCADE, whole-project restore or unrelated schema operations.
-- Operator must select this concrete teardown separately; never run automatically on an application error.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
DO $$ BEGIN
  IF current_user<>'postgres' OR current_setting('research.target_ref',true) IS DISTINCT FROM 'hwhkgrwikczwztfnsjir'
    THEN RAISE EXCEPTION 'RESEARCH_ROLLBACK_TARGET'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('research_owner','research_identity_owner','research_reader','research_writer','research_authority','research_reader_login','research_writer_login','research_authority_login') AND rolcanlogin)
    OR EXISTS(SELECT 1 FROM research_private.runtime_settings WHERE identity_bound)
    OR NOT EXISTS(SELECT 1 FROM research_private.provisioning_ledger WHERE version='research-dev-1'
      AND source_sha256='c43ac209c02c92f1a7c4ebcc713dc99616af98781f931b5120d98b4540dee23f' AND receipt_reference=current_setting('research.rollback_receipt',true))
    THEN RAISE EXCEPTION 'RESEARCH_ROLLBACK_STATE'; END IF;
  IF EXISTS(SELECT 1 FROM research_private.items) OR EXISTS(SELECT 1 FROM research_private.revisions)
    OR EXISTS(SELECT 1 FROM research_private.publications) OR EXISTS(SELECT 1 FROM research_private.audit)
    OR EXISTS(SELECT 1 FROM research_private.editor_grants) OR EXISTS(SELECT 1 FROM research_private.member_restrictions)
    OR EXISTS(SELECT 1 FROM research_private.access_audit)
    THEN RAISE EXCEPTION 'RESEARCH_ROLLBACK_NOT_EMPTY'; END IF;
END $$;
SET LOCAL ROLE research_owner;
DROP FUNCTION research_private.resolve_access(text,uuid,uuid);
DROP TABLE research_private.publications,research_private.audit;
DROP TABLE research_private.revisions;
DROP TABLE research_private.items,research_private.catalog,research_private.member_restrictions,
  research_private.editor_grants,research_private.access_audit,research_private.runtime_settings,research_private.provisioning_ledger;
DROP FUNCTION research_private.audit_access_change(),research_private.deny_history_mutation();
RESET ROLE;SET LOCAL ROLE research_identity_owner;
DROP FUNCTION research_private.identity_status(uuid,uuid);
RESET ROLE;SET LOCAL ROLE research_owner;
DROP SCHEMA research_private;
RESET ROLE;
DO $$ BEGIN EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM research_reader_login,research_writer_login,research_authority_login',current_database());END $$;
DROP ROLE research_reader_login,research_writer_login,research_authority_login,research_reader,research_writer,
  research_authority,research_identity_owner,research_owner;
COMMIT;
