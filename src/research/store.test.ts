import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresResearchStore} from './store.ts';
import {researchDraft,type ResearchDraft} from './model.ts';
import type {ResearchDatabase,ResearchSql} from './sql.ts';

export function draft(id='synthetic-report'):ResearchDraft{
  return {id,title:'Synthetic housing research',publisher:'Synthetic Publisher',canonicalUrl:'https://publisher.invalid/report',
    geography:['CA-CMA-933'],topics:['housing'],publishedAt:null,retrievedAt:null,attribution:'Synthetic attribution',summary:null,
    rights:{mode:'link_only',evidenceReference:'synthetic:permission-1',checkedAt:new Date(Date.now()-60000).toISOString(),
      validUntil:new Date(Date.now()+86400000).toISOString(),aiAllowed:false,note:'Synthetic fixture only'},
    reviewDueAt:new Date(Date.now()+3600000).toISOString()};
}
test('source publication date accepts known calendar days and rejects invented/invalid dates',()=>{
  assert.equal(researchDraft.parse({...draft(),publishedAt:'2026-09-21'}).publishedAt,'2026-09-21');
  assert.equal(researchDraft.safeParse({...draft(),publishedAt:'2026-02-30'}).success,false);
  assert.equal(researchDraft.safeParse({...draft(),publishedAt:'July 2025'}).success,false);
});
export async function fixture(){
  const pg=new PGlite();await pg.exec(await readFile(new URL('../../docs/review/research/catalog-schema.review.sql',import.meta.url),'utf8'));
  function database(role:string):ResearchDatabase{
    return {async query<T extends Record<string,unknown>>(sql:string,values:unknown[]=[]){return pg.transaction(async tx=>{
      await tx.exec('SET LOCAL ROLE '+role);return tx.query<T>(sql,values);});},
      async transaction<T>(work:(sql:ResearchSql)=>Promise<T>){return pg.transaction(async tx=>{
        await tx.exec('SET LOCAL ROLE '+role);return work(tx as unknown as ResearchSql);});}};
  }
  return {pg,reader:new PostgresResearchStore(database('research_reader')),writer:new PostgresResearchStore(database('research_writer'))};
}
async function publish(f:Awaited<ReturnType<typeof fixture>>,value=draft()){
  await f.writer.change('synthetic-editor',{action:'stage',expectedRevision:0,reason:'Synthetic staged review',draft:value});
  await f.writer.change('synthetic-editor',{action:'approve',id:value.id,expectedRevision:1,reason:'Synthetic rights checked'});
  return f.writer.change('synthetic-editor',{action:'publish',id:value.id,expectedRevision:1,reason:'Synthetic member publication'});
}
test('draft/approval are private; publication projects permitted fields and null dates faithfully',async()=>{
  const f=await fixture();try{
    const d=draft();await f.writer.change('synthetic-editor',{action:'stage',expectedRevision:0,reason:'Stage fixture',draft:d});
    assert.equal((await f.writer.inspect(d.id))?.state,'staged');
    await assert.rejects(f.reader.inspect(d.id),/permission denied/);
    assert.equal((await f.reader.list()).items.length,0);assert.equal((await f.reader.detail(d.id)).item,null);
    await f.writer.change('synthetic-editor',{action:'approve',id:d.id,expectedRevision:1,reason:'Check fixture'});
    assert.equal((await f.reader.detail(d.id)).item,null);
    await f.writer.change('synthetic-editor',{action:'publish',id:d.id,expectedRevision:1,reason:'Publish fixture'});
    const item=(await f.reader.detail(d.id)).item!;assert.equal(item.summary,null);assert.equal(item.publishedAt,null);
    assert.equal(item.retrievedAt,null);assert.equal(item.permissionMetadata.audience,'member');
    assert.equal(item.permissionMetadata.fullTextAllowed,false);assert.equal('rights' in item,false);assert.equal('actor' in item,false);
    assert.equal((await f.reader.detail(d.id,'ai')).item,null);
  }finally{await f.pg.close();}
});
test('unknown/withheld rights, missing evidence/review cadence and unpermitted content cannot approve',async()=>{
  for(const change of [{mode:'unknown'},{mode:'withheld'},{evidenceReference:null},{validUntil:null}]){
    const f=await fixture();try{
      const d=draft();Object.assign(d.rights,change);
      await f.writer.change('synthetic-editor',{action:'stage',expectedRevision:0,reason:'Stage fixture',draft:d});
      await assert.rejects(f.writer.change('synthetic-editor',{action:'approve',id:d.id,expectedRevision:1,reason:'Review fixture'}),/RIGHTS_NOT_CLEARED/);
      assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM research_private.audit')).rows[0].n,1);
    }finally{await f.pg.close();}
  }
  const d=draft();d.summary='Not permitted';assert.equal(researchDraft.safeParse(d).success,false);
  assert.equal(researchDraft.safeParse({...draft(),fullText:'Not permitted'}).success,false);
  assert.equal(researchDraft.safeParse({...draft(),canonicalUrl:'javascript:alert(1)'}).success,false);
});
test('summary rights and AI allowance project only permitted summary; expiry blocks both paths',async()=>{
  const f=await fixture();try{
    const d=draft();d.rights.mode='summary';d.rights.aiAllowed=true;d.summary='Synthetic permitted summary';await publish(f,d);
    assert.equal((await f.reader.detail(d.id,'ai')).item!.summary,d.summary);
    for(const column of ['rights_valid_until','review_due_at']){
      await f.pg.exec(`UPDATE research_private.publications SET ${column}=clock_timestamp()-interval '1 second'`);
      assert.equal((await f.reader.list()).items.length,0);assert.equal((await f.reader.detail(d.id)).item,null);
      await f.pg.exec(`UPDATE research_private.publications SET ${column}=clock_timestamp()+interval '1 hour'`);
    }
  }finally{await f.pg.close();}
});
test('correction stays private until promotion; withdrawal removes old active revision and keeps append-only audit',async()=>{
  const f=await fixture();try{
    await publish(f);const d=draft();d.title='Synthetic corrected title';
    await f.writer.change('synthetic-editor',{action:'stage',expectedRevision:1,reason:'Stage correction',draft:d});
    assert.equal((await f.reader.detail(d.id)).item!.revision,1);
    await assert.rejects(f.writer.change('synthetic-editor',{action:'approve',id:d.id,expectedRevision:1,reason:'Stale review'}),/REVISION_CONFLICT/);
    await f.writer.change('synthetic-editor',{action:'withdraw',id:d.id,expectedRevision:2,reason:'Synthetic source withdrawal'});
    assert.equal((await f.reader.detail(d.id)).item,null);assert.equal((await f.reader.list({q:'housing'})).items.length,0);
    const audit=await f.pg.query('SELECT action FROM research_private.audit ORDER BY catalog_revision');assert.equal(audit.rows.length,5);
    await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE research_writer');await tx.exec('DELETE FROM research_private.audit');}),/permission denied/);
  }finally{await f.pg.close();}
});
test('concurrent writers cannot replace the same revision; catalog/audit transaction failures roll back',async()=>{
  const f=await fixture();try{
    const command={action:'stage' as const,expectedRevision:0,reason:'Concurrent synthetic stage',draft:draft()};
    const result=await Promise.allSettled([f.writer.change('synthetic-a',command),f.writer.change('synthetic-b',command)]);
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM research_private.audit')).rows[0].n,1);
    await f.pg.exec('REVOKE INSERT ON research_private.audit FROM research_writer');
    await assert.rejects(f.writer.change('synthetic-editor',{action:'stage',expectedRevision:1,reason:'Rollback fixture',draft:draft()}));
    assert.equal((await f.pg.query('SELECT revision FROM research_private.items')).rows[0].revision,1);
    assert.equal((await f.pg.query('SELECT revision FROM research_private.catalog')).rows[0].revision,1);
  }finally{await f.pg.close();}
});
test('bounded filters/pagination do not leak hidden metadata; reader cannot read drafts/audit or mutate',async()=>{
  const f=await fixture();try{
    await publish(f,draft('synthetic-a'));await publish(f,draft('synthetic-b'));
    const page=await f.reader.list({geography:'CA-CMA-933',topic:'housing',q:'Synthetic',limit:1});
    assert.equal(page.items.length,1);assert.equal(page.pagination.hasMore,true);
    assert.equal((await f.reader.list({geography:'missing'})).coverage.status,'no_data');
    await assert.rejects(f.reader.list({limit:51}),/INVALID_RESEARCH_INPUT/);
    for(const sql of ['SELECT * FROM research_private.revisions','SELECT * FROM research_private.audit',
      'DELETE FROM research_private.publications'])await assert.rejects(f.pg.transaction(async tx=>{
        await tx.exec('SET LOCAL ROLE research_reader');await tx.exec(sql);}),/permission denied/);
  }finally{await f.pg.close();}
});
