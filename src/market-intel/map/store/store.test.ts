import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PostgresManualMapStore } from './manualApproval.ts';
import { PostgresPrivateCatalogReader } from './catalogReader.ts';
import type { MapDatabase, MapSql } from './sql.ts';
import type { MapSession } from '../auth.ts';

// A real in-memory Postgres engine; never uses DATABASE_URL, files from Supabase or network endpoints.
const pg = new PGlite();
const issuer = 'https://synthetic.supabase.co/auth/v1';
const adminId = randomUUID();
const actor = (): MapSession => ({ issuer, subject: 'synthetic-admin', expiresAt: Date.now()/1000 + 3600 });
let serial = 0;
before(async () => {
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE authenticator;
    ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`);
  await pg.exec(await readFile(new URL('../../../../docs/review/map-store-schema.sql', import.meta.url), 'utf8'));
  await pg.query(`INSERT INTO mi_map_private.access_admin_grants
    VALUES ($1, $2, $3, true, clock_timestamp() + interval '1 day', 'synthetic bootstrap fixture only')`,
    [adminId, issuer, actor().subject]);
});
after(async () => { await pg.close(); });

function database(role: 'mi_map_reader' | 'mi_map_access_writer',
  hook?: (text: string, sql: MapSql) => Promise<void>): MapDatabase {
  return {
    query: async (text, values=[]) => pg.transaction(async tx => {
      await tx.exec(`SET LOCAL ROLE ${role}`); return tx.query(text, values);
    }),
    transaction: work => pg.transaction(async tx => {
      await tx.exec(`SET LOCAL ROLE ${role}`);
      const sql: MapSql = { query: async (text, values=[]) => {
        const result = await tx.query(text, values); await hook?.(text, tx); return result;
      } };
      return work(sql);
    }),
  } as MapDatabase;
}
const writer = () => new PostgresManualMapStore(database('mi_map_access_writer'));
function request(subject: string, action='approve', expectedRevision=0) {
  return { issuer, subject, action, expectedRevision, requestId: randomUUID(), reason: 'synthetic operator review',
    ...(action === 'approve' ? { expiresAt: Date.now()/1000 + 1800 } : {}) };
}
async function member() {
  const session: MapSession = {issuer, subject:'synthetic-member-'+(++serial), expiresAt:Date.now()/1000+3600};
  assert.deepEqual(await writer().change(actor(), request(session.subject)), {ok:true, revision:1});
  return session;
}
const hash='a'.repeat(64);
const row = () => ({ observationId:'obs-zero', metricId:'population', periodStart:'2024-01-01', periodEnd:'2024-12-31',
  periodLabel:'2020–2024 five-year estimate', unit:'people', currency:null, priceBasis:null, universe:'resident population',
  sourceGeographyId:'0400000US04', sourceGeographyVintage:'2024', dimensions:{age:'all'}, value:0, status:'available',
  rawValueMarker:null, marginOfError:null, rawMoeMarker:'*****', qualityFlags:['preliminary'], privateActor:'never expose' });
async function catalog(observations:unknown[]=[row()], options:{publish?:boolean;expectedCount?:number;qualified?:boolean}={}) {
  const key='synthetic-'+(++serial), layerId=key, releaseId=key+'-release';
  await pg.query('INSERT INTO mi_map_private.source_products VALUES ($1, $2, $3)', [key,'Synthetic Census','https://example.invalid/source']);
  await pg.query(`INSERT INTO mi_map_private.rights_controls
    (clearance_id, product_id, source_revision_id, boundary_hash, state, allow_ui, valid_until, evidence_ref, notices)
    VALUES ($1, $1, $2, $3, 'cleared', true, clock_timestamp()+interval '1 day', 'private evidence', $4)`,
    [key,key+'-revision',hash,JSON.stringify(['Synthetic provider attribution'])]);
  await pg.query(`INSERT INTO mi_map_private.catalog_releases
    (release_id, layer_id, geography_id, product_id, source_revision_id, boundary_version, boundary_hash, crosswalk_ref,
      clearance_id, qualified, observation_count, source_hash, parser_version, definition_version, retrieved_at, as_of)
    VALUES ($1, $2, 'US-STATE-04', $2, $3, 'cb-2024-500k', $4, 'explicit-state-code-review',
      $2, $6, $5, $4, 'synthetic-parser-1', 'synthetic-definition-1', clock_timestamp(), clock_timestamp())`,
    [releaseId, key,key+'-revision',hash,options.expectedCount??observations.length,options.qualified??true]);
  for(let i=0;i<observations.length;i++)await pg.query('INSERT INTO mi_map_private.observations VALUES ($1, $2, $3)',
    [releaseId,i,JSON.stringify(observations[i])]);
  if(options.publish!==false)await pg.query(`INSERT INTO mi_map_private.publication_heads (layer_id, geography_id, release_id, state)
    VALUES ($1, 'US-STATE-04', $2, 'published')`,[layerId,releaseId]);
  return {layerId, releaseId, geographyId:'US-STATE-04', key};
}
const reader = (hook?: (text:string,sql:MapSql)=>Promise<void>) => new PostgresPrivateCatalogReader(database('mi_map_reader',hook));
const selection=(c:Awaited<ReturnType<typeof catalog>>)=>({layerId:c.layerId,geographyId:c.geographyId});
async function ownerMutation(sql:MapSql, query:string, values:unknown[]=[]) {
  await sql.query('RESET ROLE'); await sql.query(query,values); await sql.query('SET LOCAL ROLE mi_map_reader');
}

test('manual approval and revocation persist with complete append-only audit',async()=>{
  const session=await member();const store=writer();const grant=await store.resolve(session);
  assert(grant);assert.equal(grant.approvedBy,adminId);assert.equal(grant.approvalMethod,'manual');
  assert.deepEqual(await store.change(actor(),request(session.subject,'revoke',1)),{ok:true,revision:2});
  assert.equal((await store.resolve(session))!.revoked,true);
  const events=await pg.query(`SELECT * FROM mi_map_private.approval_audit WHERE target_subject=$1 ORDER BY after_revision`,[session.subject]);
  assert.equal(events.rows.length,2);assert.equal(events.rows[0].before_state,null);
  assert.equal(events.rows[1].action,'revoke');assert.equal(events.rows[1].actor_grant_id,adminId);
  assert.equal((events.rows[1].before_state as any).revoked,false);assert.equal((events.rows[1].after_state as any).revoked,true);
});
test('renewed approval replaces grant id and increments revision once',async()=>{
  const session=await member();const store=writer();const before=await store.resolve(session);
  assert.deepEqual(await store.change(actor(),request(session.subject,'approve',1)),{ok:true,revision:2});
  assert.notEqual((await store.resolve(session))!.grantId,before!.grantId);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM mi_map_private.approval_audit WHERE target_subject=$1',[session.subject])).rows[0].n,2);
});
test('account alone, wrong issuer and expired admin session cannot approve',async()=>{
  const target='denied-'+(++serial);
  for(const [a,expected] of [[{...actor(),subject:'unappointed'},403], [{...actor(),expiresAt:1},401]] as const){
    const r=await writer().change(a,request(target));assert(!r.ok);assert.equal(r.status,expected);
  }
  const r=await writer().change(actor(),{...request(target),issuer:'https://other.supabase.co/auth/v1'});
  assert(!r.ok);assert.equal(r.status,403);
  assert.equal(await writer().resolve({issuer,subject:target,expiresAt:actor().expiresAt}),null);
});
test('stale revisions and repeated requests cannot apply another change',async()=>{
  const session=await member();const cmd=request(session.subject,'approve',1);
  assert.deepEqual(await writer().change(actor(),cmd),{ok:true,revision:2});
  for(const c of [cmd,{...cmd,expectedRevision:2}]){const r=await writer().change(actor(),c);assert(!r.ok);assert.equal(r.status,409);}
  assert.equal((await pg.query('SELECT revision FROM mi_map_private.member_grants WHERE subject=$1',[session.subject])).rows[0].revision,2);
});
test('invalid expiry, missing reason, automatic approval and unknown fields are rejected',async()=>{
  const cmd=request('invalid-'+(++serial));
  for(const change of [{expiresAt:1},{reason:''},{action:'automatic'},{capabilities:['access_admin']},{expectedRevision:-1}]){
    const r=await writer().change(actor(),{...cmd,...change});assert(!r.ok);assert.equal(r.status,400);
  }
});
test('audit insert failure rolls back the membership change',async()=>{
  const session=await member();
  await pg.exec(`CREATE FUNCTION mi_map_private.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'synthetic private diagnostic'; END $$;
    CREATE TRIGGER test_fail_audit BEFORE INSERT ON mi_map_private.approval_audit FOR EACH ROW
      EXECUTE FUNCTION mi_map_private.test_fail_audit()`);
  try {
    const r=await writer().change(actor(),request(session.subject,'revoke',1));
    assert.deepEqual(r,{ok:false,status:503,code:'MAP_STORE_UNAVAILABLE'});
    assert.equal((await writer().resolve(session))!.revoked,false);
    assert.equal((await pg.query('SELECT revision FROM mi_map_private.member_grants WHERE subject=$1',[session.subject])).rows[0].revision,1);
  } finally {await pg.exec('DROP TRIGGER test_fail_audit ON mi_map_private.approval_audit; DROP FUNCTION mi_map_private.test_fail_audit()');}
});
test('direct writer updates need administrator audit context; fabricated audit is denied',async()=>{
  const session=await member();
  await assert.rejects(database('mi_map_access_writer').query('UPDATE mi_map_private.member_grants SET revoked=true,active=false WHERE subject=$1',[session.subject]));
  await assert.rejects(database('mi_map_access_writer').query(`INSERT INTO mi_map_private.approval_audit
    (request_id,actor_grant_id,target_issuer,target_subject,action,before_revision,after_revision,reason,occurred_at,after_state)
    VALUES ($1,$2,$3,$4,'approve',0,1,'fabricated',clock_timestamp(),'{}')`,[randomUUID(),adminId,issuer,session.subject]));
});
test('runtime cannot appoint administrators or mutate audit',async()=>{
  await assert.rejects(database('mi_map_access_writer').query('UPDATE mi_map_private.access_admin_grants SET active=false'));
  await assert.rejects(database('mi_map_access_writer').query('DELETE FROM mi_map_private.approval_audit'));
  await assert.rejects(pg.query('UPDATE mi_map_private.approval_audit SET reason=$1',['rewrite']));
  await assert.rejects(pg.query('TRUNCATE mi_map_private.approval_audit'));
});
test('inactive or expired administrator assignment cannot approve',async()=>{
  for(const state of ["active=false", "expires_at=clock_timestamp()-interval '1 second'"]){
    await pg.query(`UPDATE mi_map_private.access_admin_grants SET ${state} WHERE grant_id=$1`,[adminId]);
    try{const r=await writer().change(actor(),request('denied-admin-'+(++serial)));assert(!r.ok);assert.equal(r.status,403);}
    finally{await pg.query("UPDATE mi_map_private.access_admin_grants SET active=true,expires_at=clock_timestamp()+interval '1 day' WHERE grant_id=$1",[adminId]);}
  }
});
test('private catalog returns approved zero with provenance and preserves MOE markers',async()=>{
  const session=await member(),c=await catalog();const r=await reader().readLayer(session,selection(c));assert(r.ok);
  assert.equal(r.layer.state,'available');assert.equal(r.layer.observations[0].value,0);
  assert.equal(r.layer.observations[0].rawMoeMarker,'*****');assert.equal(r.layer.observations[0].marginOfError,null);
  assert.equal(r.layer.source.revisionId,c.key+'-revision');assert.equal(r.layer.comparisonMode,'context_only');
  for(const secret of [session.subject,adminId,'private evidence','privateActor','never expose'])assert(!JSON.stringify(r).includes(secret));
});
test('empty qualified release is no_data; suppression is partial and never zero',async()=>{
  const session=await member();const empty=await catalog([]),mixed=await catalog([row(),{...row(),observationId:'suppressed',metricId:'another-metric',value:null,status:'suppressed',rawValueMarker:'F'}]);
  const a=await reader().readLayer(session,selection(empty));assert(a.ok);assert.equal(a.layer.state,'no_data');
  const b=await reader().readLayer(session,selection(mixed));assert(b.ok);assert.equal(b.layer.state,'partial');assert.equal(b.layer.observations[1].value,null);
});
test('membership is independent of catalog and checked on every read',async()=>{
  const session=await member(),c=await catalog();assert((await reader().readLayer(session,selection(c))).ok);
  assert.deepEqual(await writer().change(actor(),request(session.subject,'revoke',1)),{ok:true,revision:2});
  const r=await reader().readLayer(session,selection(c));assert(!r.ok);assert.equal(r.status,403);
  const expired=await reader().readLayer({...session,expiresAt:1},selection(c));assert(!expired.ok);assert.equal(expired.status,401);
});
test('unknown, restricted, expired or withdrawn source is unavailable',async()=>{
  const session=await member();
  for(const mutation of ["state='unknown'","state='restricted'",'allow_ui=false',"valid_until=clock_timestamp()-interval '1 second'"]){
    const c=await catalog();await pg.query(`UPDATE mi_map_private.rights_controls SET ${mutation} WHERE clearance_id=$1`,[c.key]);
    const r=await reader().readLayer(session,selection(c));assert(!r.ok);assert.equal(r.code,'LAYER_UNAVAILABLE');
  }
  const c=await catalog();await pg.query("UPDATE mi_map_private.publication_heads SET state='withdrawn' WHERE layer_id=$1",[c.layerId]);
  const r=await reader().readLayer(session,selection(c));assert(!r.ok);assert.equal(r.code,'LAYER_UNAVAILABLE');
});
test('recipient terms remain withheld until an actual acceptance system exists',async()=>{
  const session=await member(),c=await catalog();await pg.query('UPDATE mi_map_private.rights_controls SET required_agreement=$1 WHERE clearance_id=$2',['cmhc-version-1',c.key]);
  const r=await reader().readLayer(session,selection(c));assert(!r.ok);assert.equal(r.code,'TERMS_REQUIRED');
});
test('pins fail on generation changes; reader observes rights withdrawal after SQL read',async()=>{
  const session=await member(),c=await catalog();
  const wrong=await reader().readLayer(session,{...selection(c),pinnedReleaseId:c.releaseId,pinnedGeneration:2});
  assert(!wrong.ok);assert.equal(wrong.status,409);
  let changed=false;
  const r=await reader(async(text,sql)=>{if(!changed&&text.includes('SELECT observation FROM')){
    changed=true;await ownerMutation(sql,"UPDATE mi_map_private.rights_controls SET state='restricted' WHERE clearance_id=$1",[c.key]);
  }}).readLayer(session,selection(c));assert(!r.ok);assert.equal(r.code,'LAYER_UNAVAILABLE');
});
test('changed rights notices and publication generation cannot silently replace a pinned response',async()=>{
  const session=await member();
  for(const mode of ['rights','head']){
    const c=await catalog();let changed=false;
    const r=await reader(async(text,sql)=>{if(!changed&&text.includes('SELECT observation FROM')){
      changed=true;await ownerMutation(sql,mode==='rights'?
        "UPDATE mi_map_private.rights_controls SET notices='[\"changed\"]' WHERE clearance_id=$1":
        "UPDATE mi_map_private.publication_heads SET state='published' WHERE layer_id=$1",[c.key]);
    }}).readLayer(session,selection(c));assert(!r.ok);assert.equal(r.code,'RELEASE_CHANGED');
  }
});
test('observed membership revocation or replacement after reading blocks delivery',async()=>{
  for(const mode of ['revoke','replace']){
    const session=await member(),c=await catalog();let changed=false;
    const r=await reader(async(text,sql)=>{if(!changed&&text.includes('SELECT observation FROM')){
      changed=true;await sql.query('RESET ROLE');
      await sql.query(`SELECT set_config('mi_map.actor_issuer',$1,true), set_config('mi_map.actor_subject',$2,true),
        set_config('mi_map.actor_expiry',$3,true), set_config('mi_map.request_id',$4,true), set_config('mi_map.reason',$5,true)`,
        [issuer,actor().subject,String(actor().expiresAt),randomUUID(),'synthetic mid-read change']);
      await sql.query(mode==='revoke'?
        'UPDATE mi_map_private.member_grants SET active=false,revoked=true WHERE subject=$1':
        'UPDATE mi_map_private.member_grants SET grant_id=gen_random_uuid() WHERE subject=$1',[session.subject]);
      await sql.query('SET LOCAL ROLE mi_map_reader');
    }}).readLayer(session,selection(c));assert(!r.ok);assert.equal(r.code,mode==='revoke'?'ACCESS_DENIED':'ACCESS_CHANGED');
  }
});
test('invalid observations fail closed; closed releases reject later appends',async()=>{
  const session=await member();
  for(const observation of [{...row(),value:null},{...row(),status:'suppressed',value:1},{...row(),periodEnd:'2023-01-01'}]){
    const c=await catalog([observation]);const r=await reader().readLayer(session,selection(c));assert(!r.ok);assert.equal(r.code,'MAP_CATALOG_UNAVAILABLE');
  }
  const c=await catalog();await assert.rejects(pg.query('INSERT INTO mi_map_private.observations VALUES ($1,1,$2)',
    [c.releaseId,JSON.stringify({...row(),observationId:'extra',metricId:'another-metric'})]));
});
test('private reader never reads unpublished values; scope/hash mismatches cannot form a release',async()=>{
  const c=await catalog();await pg.query("UPDATE mi_map_private.publication_heads SET state='withdrawn' WHERE layer_id=$1",[c.layerId]);
  const result=await database('mi_map_reader').query('SELECT observation FROM mi_map_private.observations WHERE release_id=$1',[c.releaseId]);
  assert.equal(result.rows.length,0);
  await assert.rejects(pg.query(`INSERT INTO mi_map_private.publication_heads VALUES ($1,'US-STATE-48',$2,'published',1)`,[c.layerId,c.releaseId]));
  await assert.rejects(pg.query(`INSERT INTO mi_map_private.catalog_releases SELECT
    'wrong-scope',layer_id,geography_id,product_id,source_revision_id,boundary_version,$1,crosswalk_ref,
    clearance_id,qualified,observation_count,source_hash,parser_version,definition_version,retrieved_at,released_at,as_of
    FROM mi_map_private.catalog_releases WHERE release_id=$2`,['b'.repeat(64),c.releaseId]));
});
test('browser and service roles cannot read private tables/functions even with bypassrls',async()=>{
  for(const role of ['anon','authenticated','service_role','authenticator']){
    await assert.rejects(pg.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE ${role}`);await tx.query('SELECT * FROM mi_map_private.member_grants');}));
    await assert.rejects(pg.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE ${role}`);await tx.query('SELECT * FROM mi_map_private.observations');}));
    const result=await pg.query(`SELECT has_schema_privilege($1,'mi_map_private','USAGE') AS schema,
      has_function_privilege($1,'mi_map_private.audit_membership()','EXECUTE') AS execute`,[role]);
    assert.equal(result.rows[0].schema,false);assert.equal(result.rows[0].execute,false);
    const table=await pg.query("SELECT has_table_privilege($1,'mi_map_private.observations','SELECT') AS read",[role]);
    assert.equal(table.rows[0].read,false);
  }
});
test('reader cannot write; ingester cannot publish/read values or administer membership',async()=>{
  await assert.rejects(database('mi_map_reader').query('UPDATE mi_map_private.rights_controls SET allow_ui=true'));
  for(const text of ['SELECT * FROM mi_map_private.observations','UPDATE mi_map_private.publication_heads SET state=\'published\'',
    'SELECT * FROM mi_map_private.member_grants']){
    await assert.rejects(pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE mi_map_ingester');await tx.query(text);}));
  }
});
test('candidate ingestion works but incomplete/unqualified promotion and post-publication appends are denied',async()=>{
  const c=await catalog([],{publish:false,expectedCount:1});
  const promote=()=>pg.query(`INSERT INTO mi_map_private.publication_heads VALUES ($1,'US-STATE-04',$2,'published',1)`,[c.layerId,c.releaseId]);
  await assert.rejects(promote());
  await pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE mi_map_ingester');
    await tx.query('INSERT INTO mi_map_private.observations VALUES ($1,0,$2)',[c.releaseId,JSON.stringify(row())]);});
  await promote();
  await assert.rejects(pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE mi_map_ingester');
    await tx.query('INSERT INTO mi_map_private.observations VALUES ($1,1,$2)',[c.releaseId,JSON.stringify({...row(),metricId:'extra'})]);}));
  const unqualified=await catalog([],{publish:false,qualified:false});
  await assert.rejects(pg.query(`INSERT INTO mi_map_private.publication_heads VALUES ($1,'US-STATE-04',$2,'published',1)`,[unqualified.layerId,unqualified.releaseId]));
  const unpublished=await catalog([row()],{publish:false});
  assert.equal((await database('mi_map_reader').query('SELECT observation FROM mi_map_private.observations WHERE release_id=$1',[unpublished.releaseId])).rows.length,0);
});
test('same observation dimensions cannot be duplicated within an immutable release',async()=>{
  await assert.rejects(catalog([row(),{...row(),observationId:'conflicting-value',value:10}],{publish:false}));
});
test('immutable releases/observations and strict input bounds survive database access',async()=>{
  await assert.rejects(pg.query('UPDATE mi_map_private.catalog_releases SET qualified=true'));
  await assert.rejects(pg.query('DELETE FROM mi_map_private.observations'));
  const session=await member();
  for(const q of [{layerId:'x',geographyId:'US-STATE-04',use:'export'}, {layerId:'x',geographyId:'unknown'},
    {layerId:'x',geographyId:'US-STATE-04',pinnedReleaseId:'x'}]){
    const r=await reader().readLayer(session,q);assert(!r.ok);assert.equal(r.status,400);
  }
});
