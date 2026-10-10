import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {editorialCommand,assertPublishable} from './model.ts';
const dir=new URL('../../docs/review/research/',import.meta.url);
const read=p=>readFile(new URL(p,dir),'utf8');
const create=await read('provisioning/001-disabled-create.review.sql');
const bind=await read('identity-binding.review.sql');
const appoint=await read('editor-appointment.review.sql');
const packageManifest=JSON.parse(await read('editor-appointment.review.json'));
const subject='00000000-0000-4000-8000-000000000001';
const session='00000000-0000-4000-8000-000000000002';
async function fixture(){
  const pg=new PGlite();
  await pg.exec(`SET research.target_ref='hwhkgrwikczwztfnsjir';
    SET research.provisioning_receipt='synthetic:disabled-review';SET research.recovery_reference='synthetic:recovery';
    CREATE SCHEMA unrelated;CREATE TABLE unrelated.marker(id int);INSERT INTO unrelated.marker VALUES(1);`);
  await pg.exec(create);
  await pg.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid,is_anonymous boolean,banned_until timestamptz,deleted_at timestamptz);
    CREATE TABLE auth.sessions(id uuid,user_id uuid,not_after timestamptz);
    INSERT INTO auth.users VALUES('${subject}',false,null,null);
    INSERT INTO auth.sessions VALUES('${session}','${subject}',null);
    SET research.identity_receipt='synthetic:identity-review';
    SET research.identity_sha256='${packageManifest.bindingSha256}';`);
  await pg.exec(bind);
  await pg.exec(`SET research.editor_subject='${subject}';SET research.editor_session='${session}';
    SET research.editor_identity_reference='synthetic:verified-app-identity';
    SET research.editor_appointment_receipt='synthetic:initial-editor-review';`);
  return pg;
}
async function denied(pg,pattern){await assert.rejects(pg.exec(appoint),pattern);await pg.exec('ROLLBACK;RESET ROLE;');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM research_private.editor_grants')).rows[0].n,0);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM research_private.access_audit WHERE record_type='editor_grants'")).rows[0].n,0);}
test('approved source bundle preserves pinned originals, clears only four links and expires at the owner cap',async()=>{
  const bundle=JSON.parse(await read('cleared-source-stage-commands.review.json'));
  const initial=JSON.parse(await read('initial-catalog.review.json'));
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  assert.equal(bundle.records.length,4);assert.equal(bundle.liveExecuted,false);
  for(const record of bundle.records){
    const original=initial.candidates.find(c=>c.command.draft.id===record.id).command;
    assert.equal(hash(original),record.approvedOriginalCommandSha256);
    assert.equal(hash(record.command),record.preparedCommandSha256);
    const parsed=editorialCommand.parse(record.command);assert.equal(parsed.action,'stage');
    if(parsed.action!=='stage')throw Error('Stage required');
    const draft=parsed.draft;assert.equal(draft.rights.mode,'link_only');assert.equal(draft.summary,null);assert.equal(draft.rights.aiAllowed,false);
    for(const field of ['id','title','publisher','canonicalUrl','geography','topics','publishedAt','retrievedAt','attribution'])
      assert.deepEqual(draft[field],original.draft[field]);
    assert.equal(draft.reviewDueAt,'2027-01-08T01:49:04Z');
    assertPublishable(draft,'2026-10-10T01:49:04Z',new Date('2026-10-10T01:49:04Z'));
    assert.throws(()=>assertPublishable(draft,'2026-10-10T01:49:04Z',new Date(draft.rights.validUntil)),/RIGHTS_NOT_CLEARED/);
  }
  assert.equal(initial.candidates.filter(c=>c.ownerDecision===null).length,4);
});
test('initial appointment grants exactly 365 audited days without overwriting or renewing existing decisions',async()=>{
  const pg=await fixture();try{
    await pg.exec(appoint);
    const result=await pg.query(`SELECT g.active,extract(epoch FROM (g.expires_at-a.occurred_at))::double precision AS seconds,
      a.operator_role,a.operation FROM research_private.editor_grants g JOIN research_private.access_audit a USING(subject)`);
    assert.deepEqual(result.rows,[{active:true,seconds:365*86400,operator_role:'postgres',operation:'INSERT'}]);
    await assert.rejects(pg.exec(appoint),/RESEARCH_EDITOR_INITIAL_APPOINTMENT_ONLY/);await pg.exec('ROLLBACK;RESET ROLE;');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM research_private.access_audit')).rows[0].n,1);
    assert.deepEqual((await pg.query('SELECT * FROM unrelated.marker')).rows,[{id:1}]);
  }finally{await pg.close();}
});
test('unbound identity, wrong session and suspension prevent appointment without inserting an editor audit',async()=>{
  for(const change of ["UPDATE research_private.runtime_settings SET identity_bound=false",
    "SET research.editor_session='00000000-0000-4000-8000-000000000003'",
    `SET ROLE research_owner;INSERT INTO research_private.member_restrictions VALUES('${subject}',true,'Synthetic restriction','synthetic:restriction');RESET ROLE`]){
    const pg=await fixture();try{await pg.exec(change);await denied(pg,/RESEARCH_EDITOR_BINDING_REQUIRED|RESEARCH_EDITOR_MEMBER_REQUIRED/);}finally{await pg.close();}
  }
});
test('identity receipt and target mismatch stop before appointment',async()=>{
  for(const change of ['RESET research.editor_identity_reference',"SET research.target_ref='wrong-project'"]){
    const pg=await fixture();try{await pg.exec(change);await denied(pg,/RESEARCH_EDITOR_IDENTITY_RECEIPT_REQUIRED|RESEARCH_EDITOR_TARGET_OPERATOR/);}finally{await pg.close();}
  }
});
test('audit insertion failure rolls back the appointment',async()=>{
  const pg=await fixture();try{await pg.exec('DROP POLICY access_audit_owner_append ON research_private.access_audit');
    await denied(pg,/row-level security/);
  }finally{await pg.close();}
});
