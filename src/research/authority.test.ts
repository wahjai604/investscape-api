import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresResearchAuthority} from './authority.ts';
import {PostgresResearchStore} from './store.ts';
import {createResearchHost} from './runtime.ts';
import {createResearchVerifier} from './auth.ts';
import {generateKeyPair,SignJWT} from 'jose';
const issuer='https://hwhkgrwikczwztfnsjir.supabase.co/auth/v1';
const subject='00000000-0000-4000-8000-000000000001',sessionId='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
function session(){return {issuer,subject,sessionId,expiresAt:Date.now()/1000+300};}
async function fixture(bound=true){
  const pg=new PGlite();
  for(const path of ['catalog-schema.review.sql','authority-schema.review.sql'])await pg.exec(await readFile(new URL('../../docs/review/research/'+path,import.meta.url),'utf8'));
  if(bound){
    await pg.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,is_anonymous boolean,banned_until timestamptz,deleted_at timestamptz,email text);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz,refresh_token text);
      INSERT INTO auth.users VALUES('${subject}',false,null,null,'SYNTHETIC ONLY');
      INSERT INTO auth.sessions VALUES('${sessionId}','${subject}',null,'SYNTHETIC ONLY');
      SELECT set_config('research.identity_receipt','synthetic:binding-review',false);
      SELECT set_config('research.identity_sha256',repeat('a',64),false);
      SELECT set_config('research.recovery_reference','synthetic:recovery-review',false);`);
    await pg.exec(await readFile(new URL('../../docs/review/research/identity-binding.review.sql',import.meta.url),'utf8'));
  }
  const db={async query(sql,values){return pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE research_authority');return tx.query(sql,values);});}};
  return {pg,authority:new PostgresResearchAuthority(db,issuer)};
}
test('unbound identity fails closed before any account/session lookup',async()=>{
  const f=await fixture(false);try{await assert.rejects(f.authority.resolve(session()),e=>e.message==='RESEARCH_UNAVAILABLE');}finally{await f.pg.close();}
});
test('automatic member access needs no enrollment or paid claim; editor requires fresh explicit grant and audit',async()=>{
  const f=await fixture();try{
    for(const tier of ['free','paid','downgraded-to-free'])assert.deepEqual(await f.authority.resolve({...session(),tier,user_metadata:{editor:true}}),{member:true,editor:false});
    await f.pg.exec(`SET ROLE research_owner;INSERT INTO research_private.editor_grants VALUES('${subject}',true,statement_timestamp()+interval '1 day','Synthetic editor decision','synthetic:owner-review');RESET ROLE;`);
    assert.deepEqual(await f.authority.resolve(session()),{member:true,editor:true});
    await f.pg.exec(`SET ROLE research_owner;UPDATE research_private.editor_grants SET active=false WHERE subject='${subject}';RESET ROLE;`);
    assert.deepEqual(await f.authority.resolve(session()),{member:true,editor:false});
    const audit=await f.pg.query('SELECT operation,record_type FROM research_private.access_audit ORDER BY id');
    assert.deepEqual(audit.rows,[{operation:'INSERT',record_type:'editor_grants'},{operation:'UPDATE',record_type:'editor_grants'}]);
  }finally{await f.pg.close();}
});
test('fresh deletion, bans, anonymous account, expired/revoked/wrong-subject session and Research suspension deny access',async()=>{
  const f=await fixture();try{
    for(const update of ["is_anonymous=true","deleted_at=statement_timestamp()","banned_until=statement_timestamp()+interval '1 day'"]){
      await f.pg.exec('UPDATE auth.users SET '+update);assert.deepEqual(await f.authority.resolve(session()),{member:false,editor:false});
      await f.pg.exec('UPDATE auth.users SET is_anonymous=false,deleted_at=null,banned_until=null');}
    await f.pg.exec("UPDATE auth.sessions SET not_after=statement_timestamp()-interval '1 second'");assert.equal((await f.authority.resolve(session())).member,false);
    await f.pg.exec('UPDATE auth.sessions SET not_after=null');assert.equal((await f.authority.resolve({...session(),sessionId:other})).member,false);
    await f.pg.exec(`SET ROLE research_owner;INSERT INTO research_private.member_restrictions VALUES('${subject}',true,'Synthetic restriction','synthetic:owner-review');RESET ROLE;`);
    assert.equal((await f.authority.resolve(session())).member,false);
    await f.pg.exec(`SET ROLE research_owner;UPDATE research_private.member_restrictions SET blocked=false;RESET ROLE;`);assert.equal((await f.authority.resolve(session())).member,true);
    await f.pg.exec('DELETE FROM auth.sessions');assert.equal((await f.authority.resolve(session())).member,false);
    await f.pg.exec(`DELETE FROM auth.users;INSERT INTO auth.sessions VALUES('${sessionId}','${subject}',null,'SYNTHETIC ONLY');`);assert.equal((await f.authority.resolve(session())).member,false);
  }finally{await f.pg.close();}
});
test('authority runtime cannot enumerate Auth identities, read secrets, edit grants or inspect drafts',async()=>{
  const f=await fixture();try{
    for(const sql of ['SELECT id FROM auth.users','SELECT email FROM auth.users','SELECT refresh_token FROM auth.sessions',
      'SELECT * FROM research_private.editor_grants','SELECT * FROM research_private.member_restrictions','SELECT * FROM research_private.revisions',
      'SELECT research_private.identity_status(null,null)','UPDATE research_private.runtime_settings SET identity_bound=true',
      'DELETE FROM research_private.access_audit'])await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE research_authority');return tx.exec(sql);}),/permission denied/);
    await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE research_identity_owner');return tx.exec('SELECT email FROM auth.users');}),/permission denied/);
    const rows=await f.pg.query(`SELECT p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='research_private' AND p.proname IN('identity_status','resolve_access')`);
    assert.equal(rows.rows.length,2);for(const r of rows.rows){assert.equal(r.prosecdef,true);assert.deepEqual(r.proconfig,['search_path=pg_catalog']);}
  }finally{await f.pg.close();}
});
test('access changes roll back when audit fails and deletes cannot erase restriction/grant history',async()=>{
  const f=await fixture();try{
    await f.pg.exec('DROP POLICY access_audit_owner_append ON research_private.access_audit');
    await assert.rejects(f.pg.exec(`SET ROLE research_owner;INSERT INTO research_private.member_restrictions VALUES('${subject}',true,'Synthetic restriction','synthetic:owner-review')`),/row-level security/);
    await f.pg.exec('RESET ROLE');assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM research_private.member_restrictions')).rows[0].n,0);
    await f.pg.exec('CREATE POLICY access_audit_owner_append ON research_private.access_audit FOR INSERT TO research_owner WITH CHECK(true)');
    await f.pg.exec(`SET ROLE research_owner;INSERT INTO research_private.member_restrictions VALUES('${subject}',true,'Synthetic restriction','synthetic:owner-review');RESET ROLE;`);
    await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE research_owner');return tx.exec('DELETE FROM research_private.member_restrictions');}),/RESEARCH_ACCESS_DELETE_DENIED/);
    await f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE research_owner');await tx.exec('DELETE FROM research_private.access_audit');});
    assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM research_private.access_audit')).rows[0].n,1);
  }finally{await f.pg.close();}
});
test('malformed/foreign/expired sessions avoid database access; missing readiness and backend faults are opaque',async()=>{
  let calls=0;const authority=new PostgresResearchAuthority({async query(){calls++;throw Error('Private diagnostics');}},issuer);
  for(const change of [{issuer:'https://foreign.supabase.co/auth/v1'},{subject:'malformed'},{sessionId:'missing'},{expiresAt:1}])
    assert.deepEqual(await authority.resolve({...session(),...change}),{member:false,editor:false});
  assert.equal(calls,0);await assert.rejects(authority.resolve(session()),e=>e.message==='RESEARCH_UNAVAILABLE');
  const f=await fixture();try{
    assert.deepEqual((await f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE research_authority');return tx.query('SELECT * FROM research_private.resolve_access(null,$1::uuid,$2::uuid)',[subject,sessionId]);})).rows[0],{ready:true,member:false,editor:false});
  }finally{await f.pg.close();}
});
test('dedicated HTTP host uses the fresh SQL adapter: free reads, denied metadata editor, grant and sign-out take effect',async()=>{
  const f=await fixture(),origin='https://research.synthetic.invalid';
  const keys=await generateKeyPair('ES256');const token=await new SignJWT({role:'authenticated',is_anonymous:false,
    session_id:sessionId,user_metadata:{editor:true},plan:'free'}).setProtectedHeader({alg:'ES256'})
    .setIssuer(issuer).setAudience('authenticated').setSubject(subject).setExpirationTime(Math.floor(Date.now()/1000)+300).sign(keys.privateKey);
  const db=role=>({async query(sql,values){return f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);return tx.query(sql,values);});},
    async transaction(work){return f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);return work(tx);});}});
  const h=await createResearchHost({RESEARCH_READ_ENABLED:'true',RESEARCH_EDITOR_ENABLED:'true',RESEARCH_AUTH_ISSUER:issuer,
    RESEARCH_AUTH_AUDIENCE:'authenticated',RESEARCH_ALLOWED_ORIGINS:origin,RESEARCH_EDITOR_ORIGIN:origin},
    {resources:{reader:new PostgresResearchStore(db('research_reader')),editor:new PostgresResearchStore(db('research_writer')),
      authority:f.authority,shutdown:()=>f.pg.close()},verifier:createResearchVerifier({issuer,audience:'authenticated'},async()=>keys.publicKey)});
  const s=h.app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  const request=path=>fetch(`http://127.0.0.1:${s.address().port}/v1/research`+path,{headers:{Origin:origin,Authorization:'Bearer '+token}});
  try{
    assert.equal((await request('/items')).status,200);assert.equal((await request('/admin/items/synthetic-report')).status,403);
    await f.pg.exec(`SET ROLE research_owner;INSERT INTO research_private.editor_grants VALUES('${subject}',true,statement_timestamp()+interval '1 day','Synthetic editor decision','synthetic:owner-review');RESET ROLE;`);
    assert.equal((await request('/admin/items/synthetic-report')).status,404);
    await f.pg.exec('DELETE FROM auth.sessions');assert.equal((await request('/items')).status,403);
    assert.equal((await request('/admin/items/synthetic-report')).status,403);
  }finally{await new Promise(r=>s.close(r));await h.shutdown();}
});
