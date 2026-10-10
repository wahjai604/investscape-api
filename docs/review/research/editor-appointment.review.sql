-- REVIEW ONLY. Not applied, auto-run or included in disabled provisioning.
-- Initial Eric Tse appointment: exactly 365 days from the actual audited insert.
-- Subject/session and identity-verification receipt must come from the verified existing app identity.
-- Receipts prevent accidents; they do not prove identity or confer execution authorization.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('research.target_ref',true) IS DISTINCT FROM 'hwhkgrwikczwztfnsjir'
    OR to_regnamespace('research_private') IS NULL THEN
    RAISE EXCEPTION 'RESEARCH_EDITOR_TARGET_OPERATOR';
  END IF;
  IF COALESCE(current_setting('research.editor_identity_reference',true),'') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    OR COALESCE(current_setting('research.editor_appointment_receipt',true),'') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$' THEN
    RAISE EXCEPTION 'RESEARCH_EDITOR_IDENTITY_RECEIPT_REQUIRED';
  END IF;
END $$;
SET LOCAL ROLE research_owner;
LOCK TABLE research_private.editor_grants IN SHARE ROW EXCLUSIVE MODE;
DO $$ DECLARE subject_id uuid;session_id uuid;access_state record;BEGIN
  BEGIN
    subject_id:=current_setting('research.editor_subject',true)::uuid;
    session_id:=current_setting('research.editor_session',true)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'RESEARCH_EDITOR_IDENTITY_REQUIRED';
  END;
  IF subject_id IS NULL OR session_id IS NULL THEN
    RAISE EXCEPTION 'RESEARCH_EDITOR_IDENTITY_REQUIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM research_private.runtime_settings WHERE singleton
    AND package_version='research-dev-1' AND project_ref='hwhkgrwikczwztfnsjir' AND identity_bound)
    OR NOT EXISTS(SELECT 1 FROM research_private.provisioning_ledger WHERE version='research-dev-1'
      AND source_sha256='c43ac209c02c92f1a7c4ebcc713dc99616af98781f931b5120d98b4540dee23f')
    OR NOT EXISTS(SELECT 1 FROM research_private.provisioning_ledger WHERE version='research-identity-bind-1'
      AND source_sha256='3cb76531a357612d9035a19e6717d9fe183cf94280f8a7cc715241068e6d4198') THEN
    RAISE EXCEPTION 'RESEARCH_EDITOR_BINDING_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM research_private.editor_grants) THEN
    RAISE EXCEPTION 'RESEARCH_EDITOR_INITIAL_APPOINTMENT_ONLY';
  END IF;
  SELECT * INTO access_state FROM research_private.resolve_access(
    'https://hwhkgrwikczwztfnsjir.supabase.co/auth/v1',subject_id,session_id);
  IF access_state.ready IS NOT TRUE OR access_state.member IS NOT TRUE THEN
    RAISE EXCEPTION 'RESEARCH_EDITOR_MEMBER_REQUIRED';
  END IF;
  INSERT INTO research_private.editor_grants(subject,active,expires_at,reason,review_reference)
    VALUES(subject_id,true,statement_timestamp()+interval '365 days',
      'Eric Tse sole initial Research editor; owner:research:2026-10-09T18:49:04-07:00; identity receipt: '
        || current_setting('research.editor_identity_reference'),
      current_setting('research.editor_appointment_receipt'));
END $$;
RESET ROLE;
COMMIT;
-- The existing access_audit trigger records actor, actual appointment instant and expiry atomically.
-- No user/session identifiers are emitted, no memberships changed and no retries/renewals performed.
