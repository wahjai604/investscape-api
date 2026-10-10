import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const dir=new URL('../../docs/review/research/provisioning/',import.meta.url);
const candidate=await readFile(new URL('001-disabled-create.review.sql',dir),'utf8');
const teardown=await readFile(new URL('002-empty-teardown.review.sql',dir),'utf8');
const manifest=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));
const sha=s=>createHash('sha256').update(s).digest('hex');
async function fixture(){const pg=new PGlite();await pg.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE ROLE authenticator;
  CREATE SCHEMA unrelated;CREATE TABLE unrelated.marker(id int);INSERT INTO unrelated.marker VALUES(1);
  SET research.target_ref='hwhkgrwikczwztfnsjir';SET research.provisioning_receipt='synthetic:review-receipt';
  SET research.recovery_reference='synthetic:recovery-reference';SET research.rollback_receipt='synthetic:review-receipt';`);return pg;}
async function denied(pg,sql,pattern){await assert.rejects(pg.exec(sql),pattern);await pg.exec('ROLLBACK;RESET ROLE;');}
test('manifest pins exact source/create/teardown and excludes identity binding, credentials and activation',async()=>{
  assert.equal(sha(candidate),manifest.candidateSha256);assert.equal(sha(teardown),manifest.emptyTeardownSha256);
  for(const [key,file] of [['catalog','catalog-schema.review.sql'],['authority','authority-schema.review.sql'],['separateIdentityBinding','identity-binding.review.sql']])
    assert.equal(sha(await readFile(new URL('../'+file,dir),'utf8')),manifest.sourceHashes[key]);
  assert.equal(manifest.status,'prepared-not-applied');assert.equal(manifest.identityBindingIncluded,false);
  assert.equal(manifest.readyToApply,false);assert.equal(manifest.identityBound,false);assert.equal(manifest.credentialsBound,false);
  assert.equal(/GRANT.*ON auth\./.test(candidate),false);
});
test('exact create has ten owned forced-RLS tables, eight NOLOGIN roles and three isolated runtime memberships',async()=>{
  const pg=await fixture();try{await pg.exec(candidate);
    const roles=(await pg.query("SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname LIKE 'research_%'")).rows;
    assert.equal(roles.length,8);assert(roles.every(r=>!r.rolcanlogin&&!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolreplication&&!r.rolbypassrls));
    const tables=(await pg.query("SELECT pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='research_private' AND c.relkind='r'")).rows;
    assert.equal(tables.length,10);assert(tables.every(t=>t.owner==='research_owner'&&t.relrowsecurity&&t.relforcerowsecurity));
    const memberships=(await pg.query("SELECT r.rolname AS granted,m.rolname AS login,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE m.rolname LIKE 'research_%_login' ORDER BY m.rolname")).rows;
    assert.equal(memberships.length,3);assert(memberships.every(m=>m.granted===m.login.replace('_login','')&&!m.admin_option&&m.inherit_option&&!m.set_option));
    await pg.exec('SET ROLE research_authority_login');assert.deepEqual((await pg.query("SELECT * FROM research_private.resolve_access('https://hwhkgrwikczwztfnsjir.supabase.co/auth/v1',null,null)")).rows,[{ready:false,member:false,editor:false}]);
    await denied(pg,'SELECT * FROM research_private.editor_grants',/permission denied/);
    for(const role of ['anon','authenticated','service_role','authenticator']){
      await pg.exec('SET ROLE '+role);await denied(pg,'SELECT * FROM research_private.catalog',/permission denied/);
      await pg.exec('SET ROLE '+role);await denied(pg,"SELECT * FROM research_private.resolve_access(null,null,null)",/permission denied/);}
    assert.deepEqual((await pg.query('SELECT * FROM unrelated.marker')).rows,[{id:1}]);
  }finally{await pg.close();}
});
test('managed-style nonsuperuser CREATEROLE fixture can create the exact package with only operator-name substitution',async()=>{
  const pg=await fixture();try{
    await pg.exec(`CREATE ROLE fixture_operator CREATEROLE BYPASSRLS;DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO fixture_operator',current_database());END $$;SET ROLE fixture_operator;`);
    // PGlite bootstrap postgres cannot lose SUPERUSER. Only the fixed operator token is substituted.
    await pg.exec(candidate.replace(/\bpostgres\b/g,'fixture_operator'));
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='research_private'")).rows[0].n,1);
  }finally{await pg.close();}
});
test('missing target/review/recovery or existing names roll back without taking over objects',async()=>{
  for(const reset of ['research.target_ref','research.provisioning_receipt','research.recovery_reference']){
    const pg=await fixture();try{await pg.exec('RESET '+reset);await denied(pg,candidate,/RESEARCH_TARGET_REQUIRED|RESEARCH_REVIEW_RECOVERY_REQUIRED/);
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'research_%'")).rows[0].n,0);}finally{await pg.close();}}
  const pg=await fixture();try{await pg.exec('CREATE ROLE research_reader');await denied(pg,candidate,/RESEARCH_NAME_COLLISION/);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'research_%'")).rows[0].n,1);
  }finally{await pg.close();}
});
test('empty disabled teardown preserves unrelated data and rejects a different receipt or extra dependent object',async()=>{
  const pg=await fixture();try{await pg.exec(candidate);
    await pg.exec("SET research.rollback_receipt='synthetic:wrong-receipt'");await denied(pg,teardown,/RESEARCH_ROLLBACK_STATE/);
    await pg.exec("SET research.rollback_receipt='synthetic:review-receipt';CREATE VIEW unrelated.dependency AS SELECT * FROM research_private.catalog");
    await denied(pg,teardown,/depend/);assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='research_private' AND c.relkind='r'")).rows[0].n,10);
    await pg.exec('DROP VIEW unrelated.dependency');await pg.exec(teardown);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'research_%'")).rows[0].n,0);
    assert.deepEqual((await pg.query('SELECT * FROM unrelated.marker')).rows,[{id:1}]);
  }finally{await pg.close();}
});
test('teardown refuses any content, editor appointment, identity binding or enabled principal',async()=>{
  for(const change of ["INSERT INTO research_private.items VALUES('synthetic-report',1)",
    "SET ROLE research_owner;INSERT INTO research_private.editor_grants VALUES('00000000-0000-4000-8000-000000000001',true,statement_timestamp()+interval '1 day','Synthetic decision','synthetic:owner-review');RESET ROLE",
    'UPDATE research_private.runtime_settings SET identity_bound=true','ALTER ROLE research_reader_login LOGIN']){
    const pg=await fixture();try{await pg.exec(candidate);await pg.exec(change);await denied(pg,teardown,/RESEARCH_ROLLBACK_NOT_EMPTY|RESEARCH_ROLLBACK_STATE/);
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='research_private'")).rows[0].n,1);}finally{await pg.close();}}
});
test('schema-scoped final revokes defeat inherited global gateway defaults without changing unrelated ACLs',async()=>{
  const pg=await fixture();try{
    const hostile=candidate.replace('SET LOCAL ROLE research_owner;\nALTER DEFAULT PRIVILEGES',
      'SET LOCAL ROLE research_owner;\nALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon;\nALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO authenticated;\nALTER DEFAULT PRIVILEGES');
    await pg.exec(hostile);
    await pg.exec('SET ROLE anon');await denied(pg,'SELECT * FROM research_private.runtime_settings',/permission denied/);
    await pg.exec('SET ROLE authenticated');await denied(pg,'SELECT research_private.identity_status(null,null)',/permission denied/);
    assert.deepEqual((await pg.query('SELECT * FROM unrelated.marker')).rows,[{id:1}]);
  }finally{await pg.close();}
});
test('managed identity binding refuses missing schema authority and succeeds only after a separately authorized narrow grant',async()=>{
  const pg=await fixture();try{
    await pg.exec(`CREATE ROLE fixture_operator CREATEROLE BYPASSRLS;DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO fixture_operator',current_database());END $$;SET ROLE fixture_operator;`);
    await pg.exec(candidate.replace(/\bpostgres\b/g,'fixture_operator'));await pg.exec('RESET ROLE');
    await pg.exec(`CREATE ROLE fixture_auth_schema_owner;CREATE SCHEMA auth AUTHORIZATION fixture_auth_schema_owner;
      CREATE TABLE auth.users(id uuid,is_anonymous boolean,banned_until timestamptz,deleted_at timestamptz);
      CREATE TABLE auth.sessions(id uuid,user_id uuid,not_after timestamptz);
      GRANT USAGE ON SCHEMA auth TO fixture_operator;
      GRANT SELECT ON auth.users,auth.sessions TO fixture_operator WITH GRANT OPTION;
      SET research.identity_receipt='synthetic:identity-review';SET research.identity_sha256='${'a'.repeat(64)}';`);
    const binding=(await readFile(new URL('../identity-binding.review.sql',dir),'utf8')).replace(/\bpostgres\b/g,'fixture_operator');
    await pg.exec('SET ROLE fixture_operator');await denied(pg,binding,/RESEARCH_AUTH_SCHEMA_USAGE_REQUIRED/);
    assert.equal((await pg.query('SELECT identity_bound FROM research_private.runtime_settings')).rows[0].identity_bound,false);
    // Synthetic authorized schema-owner operation only; never issued to the live project.
    await pg.exec('SET ROLE fixture_auth_schema_owner;GRANT USAGE ON SCHEMA auth TO research_identity_owner;RESET ROLE;SET ROLE fixture_operator;');
    await pg.exec(binding);await pg.exec('RESET ROLE');
    assert.equal((await pg.query('SELECT identity_bound FROM research_private.runtime_settings')).rows[0].identity_bound,true);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM research_private.provisioning_ledger WHERE version='research-identity-bind-1'")).rows[0].n,1);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'research_%' AND rolcanlogin")).rows[0].n,0);
  }finally{await pg.close();}
});
