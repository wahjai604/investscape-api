import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createMapSessionVerifier } from '../../market-intel/map/auth.ts';
import { createMapRouter, type MapRouteDeps } from './map.ts';
import type { ManualMapGrant } from '../../market-intel/map/memberAccess.ts';

async function fixture() {
 const issuer='https://synthetic.supabase.co/auth/v1';const clock=1700000000;
 const {publicKey,privateKey}=await generateKeyPair('ES256');const jwk=await exportJWK(publicKey);
 const token=await new SignJWT({role:'authenticated',is_anonymous:false,user_metadata:{map_read:true}})
  .setIssuer(issuer).setAudience('authenticated').setSubject('synthetic-member').setExpirationTime(clock+100)
  .setProtectedHeader({alg:'ES256',kid:'synthetic'}).sign(privateKey);
 const state={grant:{grantId:'manual-grant',issuer,subject:'synthetic-member',approvalMethod:'manual',
  approvedAt:clock-1,approvedBy:'synthetic-approver',active:true,revoked:false,expiresAt:clock+100,
  capabilities:['map_read']} as ManualMapGrant | null,reads:0,clock,duringRead:()=>{}};
 const deps:MapRouteDeps={enabled:()=>true,verifier:createMapSessionVerifier({issuer,audience:'authenticated'},
  {now:()=>state.clock,keyResolver:createLocalJWKSet({keys:[{...jwk,alg:'ES256',kid:'synthetic'}]})}),
  authority:{resolve:async()=>state.grant?structuredClone(state.grant):null},now:()=>state.clock,
  reader:{read:async query=>{state.reads++;state.duringRead();return {contractVersion:'map-manifest-review-1',
   geographyId:query.geographyId,state:'unavailable',reason:'CATALOG_NOT_CONFIGURED'};}}};
 return {state,deps,token};
}
async function request(deps:MapRouteDeps,token?:string,query='geographyId=US-STATE-04&geographyLevel=province_state') {
 const app=express();app.use('/v1',createMapRouter(deps));const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const addr=server.address();assert(addr&&typeof addr==='object');
 try {const r=await fetch(`http://127.0.0.1:${addr.port}/v1/market-intel/map/views?${query}`,
  {headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};}
 finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
test('router disabled by default and never invokes verifier',async()=>{const f=await fixture();delete f.deps.enabled;
 f.deps.verifier={verify:async()=>{throw Error('must not run');}};assert.equal((await request(f.deps,f.token)).status,503);assert.equal(f.state.reads,0);});
test('real signed token needs manual grant; self-assigned metadata grants nothing',async()=>{
 const f=await fixture();f.state.grant=null;assert.equal((await request(f.deps,f.token)).status,403);assert.equal(f.state.reads,0);
});
test('approved grant reads only unavailable placeholder; no actor or grant leaks',async()=>{
 const f=await fixture();const r=await request(f.deps,f.token);assert.equal(r.status,200);assert.equal(r.body.state,'unavailable');
 assert.equal(r.cache,'no-store');assert(!JSON.stringify(r.body).includes('synthetic-member'));
 assert(!JSON.stringify(r.body).includes('manual-grant'));assert.equal(f.state.reads,1);
});
for(const [name,change] of Object.entries({revoked:{revoked:true},inactive:{active:false},expired:{expiresAt:1700000000},
 automatic:{approvalMethod:'automatic'},wrongSubject:{subject:'other'},wrongIssuer:{issuer:'other'},
 noApprover:{approvedBy:''},noApprovalTime:{approvedAt:undefined},futureApproval:{approvedAt:1700000001},
 noCapability:{capabilities:[]}}))test(name+' rejected before catalog',async()=>{
 const f=await fixture();f.state.grant={...f.state.grant!,...change} as ManualMapGrant;
 assert.equal((await request(f.deps,f.token)).status,403);assert.equal(f.state.reads,0);
});
test('no token denied before catalog',async()=>{const f=await fixture();assert.equal((await request(f.deps)).status,401);assert.equal(f.state.reads,0);});
test('authority missing/unavailable fails closed',async()=>{const f=await fixture();f.deps.authority=null;
 assert.equal((await request(f.deps,f.token)).status,503);f.deps.authority={resolve:async()=>{throw Error('private failure');}};
 const r=await request(f.deps,f.token);assert.equal(r.status,503);assert(!JSON.stringify(r).includes('private failure'));assert.equal(f.state.reads,0);
});
test('reader missing/outage unavailable; never leak exception',async()=>{const f=await fixture();f.deps.reader=null;
 assert.equal((await request(f.deps,f.token)).status,503);f.deps.reader={read:async()=>{throw Error('private database failure');}};
 const r=await request(f.deps,f.token);assert.equal(r.status,503);assert(!JSON.stringify(r).includes('private database failure'));
});
test('malformed catalog responses fail closed with a JSON error',async()=>{
 for(const response of [null,undefined,{}, {contractVersion:'other'}, {contractVersion:'map-manifest-review-1',
  geographyId:'US-STATE-48',state:'unavailable',reason:'CATALOG_NOT_CONFIGURED'}]){
  const f=await fixture();f.deps.reader={read:async()=>response} as unknown as MapRouteDeps['reader'];
  const r=await request(f.deps,f.token);assert.equal(r.status,503);assert.equal(r.body.error.code,'MAP_CATALOG_UNAVAILABLE');
 }
});
test('revocation or expiry during read blocks response; subsequent request reauthorizes',async()=>{
 for(const mode of ['revoked','expired','replacement']){const f=await fixture();f.state.duringRead=()=>{
  if(mode==='revoked')f.state.grant={...f.state.grant!,revoked:true};
  else if(mode==='expired')f.state.clock+=101;else f.state.grant={...f.state.grant!,grantId:'replacement'};};
 const r=await request(f.deps,f.token);assert.equal(r.status,mode==='expired'?401:mode==='replacement'?409:403);}
 const f=await fixture();assert.equal((await request(f.deps,f.token)).status,200);f.state.grant={...f.state.grant!,revoked:true};
 assert.equal((await request(f.deps,f.token)).status,403);assert.equal(f.state.reads,1);
});
test('unknown/duplicate/incorrect query rejected; no catalog access',async()=>{
 for(const q of ['geographyId=unknown&geographyLevel=metro','geographyId=US-STATE-04&geographyLevel=metro',
 'geographyId=US-STATE-04&geographyLevel=province_state&actor=other',
 'geographyId=US-STATE-04&geographyId=US-STATE-48&geographyLevel=province_state']){
  const f=await fixture();assert.equal((await request(f.deps,f.token,q)).status,400);assert.equal(f.state.reads,0);}
});
