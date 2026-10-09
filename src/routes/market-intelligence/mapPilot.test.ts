import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMapApiTestFixture} from '../../../docs/review/map-api-test-fixture.mjs';

let f:any;
const layer='us-state-acs-population',viewPath='/v1/market-intel/map/views?geographyId=US-STATE-04';
before(async()=>{f=await createMapApiTestFixture();});after(async()=>{await f?.close();});
async function manifest(name='memberA',geography='US-STATE-04'){
  const r=await f.request('/v1/market-intel/map/views?geographyId='+geography,name);assert.equal(r.status,200);return r.body;
}
const layerPath=(viewId:string,id=layer)=>`/v1/market-intel/map/layers/${id}?viewId=${viewId}`;
async function currentRevision(subject:string){const r=await f.store.inspect(f.principals.admin,subject);assert(r.ok);return r.inspection.revision;}
async function change(subject:string,action='approve',revision?:number){return f.store.change(f.principals.admin,
  {issuer:f.principals.admin.issuer,subject,action,expectedRevision:revision??await currentRevision(subject),requestId:randomUUID(),reason:'synthetic API test',
    ...(action==='approve'?{expiresAt:Date.now()/1000+1800}:{})});}
test('manifest metadata exposes only configured regional layers and no observations/actor fields',async()=>{
  const m=await manifest();assert.equal(m.contractVersion,'map-manifest-review-2');assert.equal(m.layers.length,4);
  assert(m.layers.some((l:any)=>l.availability==='unavailable'));assert.equal(m.layers.find((l:any)=>l.layerId===layer).availability,'readable');
  const text=JSON.stringify(m);for(const value of ['synthetic-memberA','grantId','rightsRevision','observations','private fixture evidence'])assert(!text.includes(value));
});
test('independent layer HTTP read returns pinned evidence and preserves zero/MOE marker',async()=>{
  const m=await manifest(),r=await f.request(layerPath(m.viewId));assert.equal(r.status,200);assert.equal(r.cache,'no-store');
  assert.equal(r.body.features[0].observations[0].value,0);assert.equal(r.body.features[0].observations[0].rawMoeMarker,'*****');
  assert.equal(r.body.features[0].geography.featureId,undefined);assert.equal(r.body.features[0].featureId,'04');
  assert.equal(r.body.coverage.nextCursor,null);assert.equal(r.body.comparisonMode,'context_only');
  assert(!JSON.stringify(r.body).includes('privateActor'));
  assert.equal((await f.request(layerPath(m.viewId,'us-state-acs-gross-rent'))).status,503);
  assert.equal((await f.request(layerPath(m.viewId))).status,200);
});
test('wrong actor or unknown view cannot reuse a member view; no account-only access',async()=>{
  const m=await manifest();assert.equal((await f.request(layerPath(m.viewId),'memberB')).status,409);
  assert.equal((await f.request(layerPath('x'.repeat(43)))).status,409);
  assert.equal((await f.request(viewPath,'unapproved')).status,403);assert.equal((await f.request(viewPath,null)).status,401);
});
test('view identifies geography separately and rejects unsupported query/page/filter shapes',async()=>{
  const m=await manifest('memberA','US-STATE-48');const r=await f.request(layerPath(m.viewId));assert.equal(r.body.features[0].featureId,'48');
  for(const path of [viewPath+'&actor=other',viewPath+'&geographyId=US-STATE-48',layerPath(m.viewId)+'&pageSize=251',
    layerPath(m.viewId)+'&bbox=0,0,1,1',layerPath(m.viewId)+'&cursor=other',layerPath(m.viewId)+'&periodStart=2024-01-01'])
    assert.equal((await f.request(path)).status,400);
  assert.equal((await f.request(layerPath(m.viewId)+'&pageSize=1')).status,200);
});
test('changed rights or publication invalidates an existing view instead of switching its release',async()=>{
  const key=layer+'-US-STATE-04';
  for(const mode of ['rights','head']){
    const m=await manifest();await f.pg.query(mode==='rights'?
      "UPDATE mi_map_private.rights_controls SET notices='[\"updated synthetic notice\"]' WHERE clearance_id=$1":
      "UPDATE mi_map_private.publication_heads SET state='published' WHERE release_id=$1",[key]);
    const r=await f.request(layerPath(m.viewId));assert.equal(r.status,409);assert.equal(r.body.error.code,'RELEASE_CHANGED');
    assert.equal((await f.request(layerPath((await manifest()).viewId))).status,200);
  }
});
test('withdrawal and required agreement withhold one layer while others remain independent',async()=>{
  const key=layer+'-US-STATE-04',m=await manifest();
  await f.pg.query("UPDATE mi_map_private.publication_heads SET state='withdrawn' WHERE release_id=$1",[key]);
  try{assert.equal((await f.request(layerPath(m.viewId))).status,503);
    const current=await manifest();assert.equal(current.layers.find((l:any)=>l.layerId===layer).availability,'unavailable');
    assert.equal((await f.request(layerPath(current.viewId,'us-state-acs-household-income'))).status,200);
  }finally{await f.pg.query("UPDATE mi_map_private.publication_heads SET state='published' WHERE release_id=$1",[key]);}
  await f.pg.query("UPDATE mi_map_private.rights_controls SET required_agreement='synthetic-terms-1' WHERE clearance_id=$1",[key]);
  try{const current=await manifest();assert.equal(current.layers.find((l:any)=>l.layerId===layer).reason,'TERMS_REQUIRED');
    assert.equal((await f.request(layerPath(current.viewId))).status,503);
  }finally{await f.pg.query('UPDATE mi_map_private.rights_controls SET required_agreement=null WHERE clearance_id=$1',[key]);}
});
test('grant renewal/revocation invalidates old views and reauthorizes every read',async()=>{
  const subject=f.principals.memberA.subject,m=await manifest();assert((await change(subject)).ok);
  assert.equal((await f.request(layerPath(m.viewId))).body.error.code,'VIEW_EXPIRED');
  const current=await manifest();assert((await change(subject,'revoke')).ok);
  assert.equal((await f.request(layerPath(current.viewId))).status,403);
  assert((await change(subject)).ok);
});
test('grant replacement between route authorization and reader authorization cannot reuse the old view',async()=>{
  const m=await manifest(),original=f.deps.catalog;
  f.deps.catalog={readManifest:original.readManifest.bind(original),readLayer:async(session:any,input:any)=>{
    assert((await change(session.subject)).ok);return original.readLayer(session,input);
  }};
  try{const r=await f.request(layerPath(m.viewId));assert.equal(r.status,409);assert.equal(r.body.error.code,'ACCESS_CHANGED');}
  finally{f.deps.catalog=original;}
});
test('separate default-disabled switches block both map and admin work',async()=>{
  const oldEnabled=f.deps.enabled,oldAdmin=f.deps.adminEnabled;
  delete f.deps.enabled;delete f.deps.adminEnabled;
  try{assert.equal((await f.request(viewPath)).status,503);
    assert.equal((await f.request('/v1/market-intel/map/admin/member?subject=synthetic-new','admin')).status,503);
  }finally{f.deps.enabled=oldEnabled;f.deps.adminEnabled=oldAdmin;}
});
test('administrator membership inspection works without map_read and rejects ordinary members',async()=>{
  const p='/v1/market-intel/map/admin/member?subject=synthetic-new';
  assert.equal((await f.request(viewPath,'admin')).status,403);
  const r=await f.request(p,'admin');assert.equal(r.status,200);assert.equal(r.body.member.state,'no_grant');assert.equal(r.body.member.revision,0);
  assert.equal((await f.request(p,'memberA')).status,403);assert.equal((await f.request(p,null)).status,401);
});
test('admin HTTP write uses verified issuer and records reason/audit; stale receipt cannot write twice',async()=>{
  const subject='synthetic-http-target',body={subject,action:'approve',expectedRevision:0,requestId:randomUUID(),reason:'Manual synthetic review',expiresAt:Date.now()/1000+1800};
  const opts={method:'POST',body,headers:{Origin:f.url}};
  const r=await f.request('/v1/market-intel/map/admin/changes','admin',opts);assert.equal(r.status,200);assert.equal(r.body.revision,1);
  const current=await f.request('/v1/market-intel/map/admin/member?subject='+subject,'admin');
  assert.equal(current.body.member.audit[0].reason,body.reason);assert.equal(current.body.member.state,'active');
  for(const privateField of ['actor_grant_id','before_state','after_state','approved_by'])assert(!JSON.stringify(current.body).includes(privateField));
  assert.equal((await f.request('/v1/market-intel/map/admin/changes','admin',opts)).status,409);
  const revoke=await f.request('/v1/market-intel/map/admin/changes','admin',{...opts,body:{subject,action:'revoke',expectedRevision:1,requestId:randomUUID(),reason:'Synthetic revoke'}});
  assert.equal(revoke.status,200);assert.equal((await f.request('/v1/market-intel/map/admin/member?subject='+subject,'admin')).body.member.state,'revoked');
});
test('admin rejects foreign/absent origin, non-JSON, oversized/malformed input and actor injection',async()=>{
  const p='/v1/market-intel/map/admin/changes',body={subject:'synthetic-bad',action:'approve',expectedRevision:0,requestId:randomUUID(),reason:'test',expiresAt:Date.now()/1000+1800};
  for(const headers of [{},{Origin:'https://foreign.invalid'}])assert.equal((await f.request(p,'admin',{method:'POST',body,headers})).status,403);
  assert.equal((await f.request(p,'admin',{method:'POST',body:'not JSON',headers:{Origin:f.url,'Content-Type':'text/plain'}})).status,415);
  assert.equal((await f.request(p,'admin',{method:'POST',body:'{',headers:{Origin:f.url,'Content-Type':'application/json'}})).status,400);
  assert.equal((await f.request(p,'admin',{method:'POST',body:' '.repeat(9000),headers:{Origin:f.url,'Content-Type':'application/json'}})).status,413);
  for(const extra of [{issuer:'https://other.supabase.co/auth/v1'},{actor:f.principals.admin},{capabilities:['access_admin']}])
    assert.equal((await f.request(p,'admin',{method:'POST',body:{...body,...extra},headers:{Origin:f.url}})).status,400);
});
test('dependency outages and malformed queries produce opaque JSON failures',async()=>{
  const original=f.deps.catalog;f.deps.catalog={readManifest:async()=>{throw Error('private database detail');}};
  try{const r=await f.request(viewPath);assert.equal(r.status,503);assert(!JSON.stringify(r).includes('private database detail'));}
  finally{f.deps.catalog=original;}
  assert.equal((await f.request('/v1/market-intel/map/admin/member?subject=one&subject=two','admin')).status,400);
});
