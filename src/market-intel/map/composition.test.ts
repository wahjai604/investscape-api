import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {gzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createMapApiTestFixture} from '../../../docs/review/map-api-test-fixture.mjs';
import {createMapComposition,createMapPoolResources,resolveMapCompositionConfig} from './composition.ts';
const changePath='/v1/market-intel/map/admin/changes';
const body=()=>({subject:'synthetic-composition-target',action:'approve',expectedRevision:0,requestId:randomUUID(),
  reason:'Synthetic composition test',expiresAt:Date.now()/1000+900});
test('flags default off; no credentials or unrelated engine flags are read',()=>{
  const c=resolveMapCompositionConfig({INVESTSCAPE_FF_REQUIRE_ENGINE_AUTH:'true'});
  assert.equal(c.readEnabled,false);assert.equal(c.adminEnabled,false);
  const env=new Proxy({},{get(_t,k){if(k==='DATABASE_URL'||String(k).includes('SECRET'))throw Error('must not read');return undefined;}});
  assert.deepEqual(resolveMapCompositionConfig(env),c);
  for(const origins of ['*','https://ok.invalid,http://localhost:3000','https://ok.invalid/path','https://ok.invalid,'])
    assert.equal(resolveMapCompositionConfig({CORS_ALLOWED_ORIGINS:origins}).allowedOrigins.length,0);
});
test('armed flags without resources fail before parser/verifier and never reach legacy engines',async()=>{
  const app=express(),config=resolveMapCompositionConfig({MI_MAP_READ_ENABLED:'true',MI_MAP_ADMIN_ENABLED:'true',
    MI_MAP_AUTH_ISSUER:'https://synthetic.supabase.co/auth/v1',MI_MAP_AUTH_AUDIENCE:'authenticated',
    CORS_ALLOWED_ORIGINS:'https://dev.synthetic.invalid',MI_MAP_ADMIN_ORIGIN:'https://dev.synthetic.invalid'});
  let verifies=0;app.use('/v1',createMapComposition(config,{verifier:{async verify(){verifies++;throw Error('must not verify');}}}).router);
  app.use(express.json());app.use((_req,res)=>res.status(418).json({legacy:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}`+changePath,{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
    assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(verifies,0);
  }finally{await new Promise(r=>server.close(r));}
});
test('composed signed requests reach scoped stores without a legacy engine verifier',async()=>{
  const f=await createMapApiTestFixture({composition:true});try{
    const r=await f.request('/v1/market-intel/map/views?geographyId=US-STATE-04');assert.equal(r.status,200);
    assert.equal((await f.request('/v1/market-intel/map/layers/us-state-acs-population?viewId='+r.body.viewId)).body.features[0].observations[0].value,0);
    const applied=await f.request(changePath,'admin',{method:'POST',body:body(),headers:{Origin:f.syntheticOrigin}});assert.equal(applied.status,200);
    assert.equal((await f.request('/v1/market-intel/map/admin/member?subject=synthetic-composition-target','admin')).body.member.audit.length,1);
    assert.equal(f.downstream,0);
    assert.equal((await f.request('/v1/unrelated')).status,418);assert.equal(f.downstream,1);
  }finally{await f.close();}
});
test('composition authenticates before its 8KB parser and rejects compressed bodies',async()=>{
  const f=await createMapApiTestFixture({composition:true});try{
    const options={method:'POST',body:' '.repeat(9000),headers:{Origin:f.syntheticOrigin,'Content-Type':'application/json'}};
    assert.equal((await f.request(changePath,'admin',options)).status,413);
    assert.equal((await f.request(changePath,null,options)).status,401);
    assert.equal((await f.request(changePath,'foreignIssuer',options)).status,401);
    assert.equal((await f.request(changePath,'memberA',options)).status,403);
    const r=await fetch(f.url+changePath,{method:'POST',headers:{Origin:f.syntheticOrigin,'Content-Type':'application/json',
      Authorization:'Bearer '+f.tokens.admin,'Content-Encoding':'gzip'},body:gzipSync(JSON.stringify(body()))});
    assert.equal(r.status,415);assert.equal((await r.json()).error.code,'INVALID_APPROVAL');assert.equal(f.downstream,0);
  }finally{await f.close();}
});
test('private CORS owns preflights before permissive legacy CORS',async()=>{
  const f=await createMapApiTestFixture({composition:true});try{
    for(const origin of [f.syntheticOrigin,'https://foreign.invalid']){
      const r=await fetch(f.url+changePath,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST',
        'Access-Control-Request-Headers':'authorization,content-type'}});
      assert.equal(r.status,origin===f.syntheticOrigin?204:403);
      assert.equal(r.headers.get('access-control-allow-origin'),origin===f.syntheticOrigin?origin:null);
      assert.equal(r.headers.get('access-control-allow-credentials'),null);assert.equal(r.headers.get('cache-control'),'no-store');
    }
    const r=await f.request('/v1/market-intel/map/views?geographyId=US-STATE-04','memberA',{headers:{Origin:'https://foreign.invalid'}});
    assert.equal(r.status,403);assert.equal(f.downstream,0);
  }finally{await f.close();}
});
test('unknown map paths are terminal no-store JSON, including uppercase paths',async()=>{
  const f=await createMapApiTestFixture({composition:true});try{
    for(const path of ['/v1/market-intel/map/unknown','/v1/MARKET-INTEL/MAP/unknown']){
      const r=await f.request(path);assert.equal(r.status,404);assert.equal(r.cache,'no-store');assert.equal(r.body.error.code,'MAP_ROUTE_NOT_FOUND');
    }assert.equal(f.downstream,0);
  }finally{await f.close();}
});
test('read/admin disabling is independent in the real composition',async()=>{
  for(const readEnabled of [false,true]){
    const f=await createMapApiTestFixture({composition:true,readEnabled,adminEnabled:!readEnabled});try{
      assert.equal((await f.request('/v1/market-intel/map/views?geographyId=US-STATE-04')).status,readEnabled?200:503);
      assert.equal((await f.request('/v1/market-intel/map/admin/member?subject=synthetic-memberA','admin')).status,readEnabled?503:200);
    }finally{await f.close();}
  }
});
test('bounded shared counters ignore forwarded IP keys and reset after the window',async()=>{
  let now=Date.now()/1000;
  const f=await createMapApiTestFixture({composition:true,compositionOptions:{requestLimit:2,adminRequestLimit:1,now:()=>now}});try{
    now=Date.now()/1000;
    const path='/v1/market-intel/map/views?geographyId=US-STATE-04';
    assert.equal((await f.request(path)).status,200);assert.equal((await f.request(path,'memberB')).status,200);
    assert.equal((await f.request(path,'memberA',{headers:{'X-Forwarded-For':'arbitrary'}})).status,429);
    now+=60;assert.equal((await f.request(path)).status,200);
  }finally{await f.close();}
});
test('resource pairs refuse the same pool and close both exactly once despite rejection',async()=>{
  let a=0,b=0;const first={end:async()=>{a++;throw Error('private diagnostic');}},second={end:async()=>{b++;}};
  assert.throws(()=>createMapPoolResources(first,first),/MAP_RESOURCES_INVALID/);
  const resources=createMapPoolResources(first,second);const composition=createMapComposition(resolveMapCompositionConfig({}),{resources});
  const results=await Promise.allSettled([composition.shutdown(),composition.shutdown()]);
  assert.equal(a,1);assert.equal(b,1);for(const r of results){assert.equal(r.status,'rejected');assert.equal(r.reason.message,'MAP_SHUTDOWN_FAILED');}
});
test('source startup uses the tested composition before global CORS and parser',async()=>{
  const source=await readFile(new URL('../../index.ts',import.meta.url),'utf8');
  assert(source.indexOf('app.use("/v1", map.router)')<source.indexOf('app.use(createCorsMiddleware(corsConfig))'));
  assert(source.indexOf('app.use("/v1", map.router)')<source.indexOf('express.json({'));
  assert(source.includes('const map = createMapComposition(resolveMapCompositionConfig(process.env));'));
});
