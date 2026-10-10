// Offline generator only. No connections, credential discovery or migration runner registration.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url),out=new URL('./provisioning/',root);
const hash=s=>createHash('sha256').update(s).digest('hex');
const catalog=await readFile(new URL('catalog-schema.review.sql',root),'utf8');
const authority=await readFile(new URL('authority-schema.review.sql',root),'utf8');
const identity=await readFile(new URL('identity-binding.review.sql',root),'utf8');
const sourceHash=hash(catalog+'\n'+authority);
const slice=(s,start,end)=>{const a=s.indexOf(start),b=s.lastIndexOf(end);if(a<0||b<=a)throw Error('RESEARCH_SOURCE_BOUNDARY_CHANGED');return s.slice(a,b).trim();};
const core=slice(catalog,'REVOKE ALL ON SCHEMA research_private FROM PUBLIC;','COMMIT;');
const accessTables=slice(authority,'CREATE TABLE research_private.runtime_settings','-- Minimal Auth projection');
const accessFunctions=slice(authority,'-- Legitimate narrow definer','DO $$ DECLARE gateway');
const stub=slice(authority,'CREATE FUNCTION research_private.identity_status','-- Legitimate narrow definer');
const roles=['research_owner','research_identity_owner','research_reader','research_writer','research_authority',
  'research_reader_login','research_writer_login','research_authority_login'];
const roleList=roles.map(n=>`'${n}'`).join(',');
const attrs='NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
const sql=`-- REVIEW ONLY: disabled-create package for Investscape-Dev hwhkgrwikczwztfnsjir.
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
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN(${roleList}))
    THEN RAISE EXCEPTION 'RESEARCH_NAME_COLLISION'; END IF;
END $$;
-- Managed PG17 creator gets ADMIN automatically. SET only for the two owners; no ADMIN regrant cycle.
SET LOCAL createrole_self_grant='set';
CREATE ROLE research_owner ${attrs};
CREATE ROLE research_identity_owner ${attrs};
SET LOCAL createrole_self_grant='';
${roles.slice(2).map(n=>`CREATE ROLE ${n} ${attrs}${n.endsWith('_login')?' CONNECTION LIMIT 2':''};`).join('\n')}
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
${core}
${accessTables}
-- Temporary schema CREATE solely for the fixed, disabled identity stub; removed in this transaction.
GRANT CREATE ON SCHEMA research_private TO research_identity_owner;
RESET ROLE;
SET LOCAL ROLE research_identity_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA research_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
${stub}
RESET ROLE;
SET LOCAL ROLE research_owner;
REVOKE CREATE ON SCHEMA research_private FROM research_identity_owner;
${accessFunctions}
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
INSERT INTO research_private.provisioning_ledger VALUES('research-dev-1','${sourceHash}',
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
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN(${roleList})
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
`;
const rollback=`-- REVIEW ONLY: empty, disabled Research teardown. No CASCADE, whole-project restore or unrelated schema operations.
-- Operator must select this concrete teardown separately; never run automatically on an application error.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
DO $$ BEGIN
  IF current_user<>'postgres' OR current_setting('research.target_ref',true) IS DISTINCT FROM 'hwhkgrwikczwztfnsjir'
    THEN RAISE EXCEPTION 'RESEARCH_ROLLBACK_TARGET'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN(${roleList}) AND rolcanlogin)
    OR EXISTS(SELECT 1 FROM research_private.runtime_settings WHERE identity_bound)
    OR NOT EXISTS(SELECT 1 FROM research_private.provisioning_ledger WHERE version='research-dev-1'
      AND source_sha256='${sourceHash}' AND receipt_reference=current_setting('research.rollback_receipt',true))
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
`;
await mkdir(out,{recursive:true});await writeFile(new URL('001-disabled-create.review.sql',out),sql);
await writeFile(new URL('002-empty-teardown.review.sql',out),rollback);
await writeFile(new URL('manifest.json',out),JSON.stringify({status:'prepared-not-applied',reviewLocalDate:'2026-10-09',
  target:{project:'Investscape-Dev',ref:'hwhkgrwikczwztfnsjir',postgresMajor:17,ownerSelection:'Owner selected existing Dev project in this conversation'},
  packageVersion:'research-dev-1',roles,privateTables:10,allRolesNoLogin:true,identityBound:false,editorAppointments:0,publishedItems:0,
  sourceHashes:{catalog:hash(catalog),authority:hash(authority),separateIdentityBinding:hash(identity)},sourceCombinedSha256:sourceHash,
  candidateSha256:hash(sql),emptyTeardownSha256:hash(rollback),identityBindingIncluded:false,
  readyToApply:false,ownerExecutionApproval:null,currentRecoveryReference:null,appliedReceipt:null,
  runtimeReadEnabled:false,runtimeEditorEnabled:false,credentialsBound:false,deployed:false,wewebPublished:false},null,2)+'\n');
console.log('Prepared disabled Research create/empty-teardown package; no database contacted.');
