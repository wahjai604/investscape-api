import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMapSessionTransport} from '../../../ui/map-session-adapter.js';
const issuer='https://synthetic.supabase.co/auth/v1',apiOrigin='https://api.synthetic.invalid';
const path='/v1/market-intel/map/views?geographyId=US-STATE-04';
const makeSession=(subject='synthetic-a',token='e30.e30.c2ln')=>({issuer,subject,accessToken:token,expiresAt:Date.now()/1000+600});
function fixture(fetchImpl=async()=>Response.json({ok:true}),extra={}){
  let session=makeSession(),callback,closed=0,reads=0;const calls=[];
  const host={issuer,readSession:async()=>{reads++;return session;},subscribe:fn=>{callback=fn;return()=>{closed++;};}};
  const transport=createMapSessionTransport({apiOrigin,host,fetchImpl:async(...args)=>{calls.push(args);return fetchImpl(...args);},...extra});
  return {transport,calls,host,get reads(){return reads;},get closed(){return closed;},set(s){session=s;},notify(){callback();}};
}
test('adapter pins destination, resolves relative paths and sends only current Bearer without ambient credentials',async()=>{
  const f=fixture();try{
    const r=await f.transport.authenticatedFetch(path);assert.deepEqual(await r.json(),{ok:true});assert.equal(f.reads,2);
    const[url,o]=f.calls[0];assert.equal(url,apiOrigin+path);assert.equal(o.headers.Authorization,'Bearer e30.e30.c2ln');
    assert.equal(o.credentials,'omit');assert.equal(o.cache,'no-store');assert.equal(o.redirect,'error');assert(o.signal instanceof AbortSignal);
    f.set(makeSession('synthetic-a','e30.e30.bmV3'));await f.transport.authenticatedFetch(path);
    assert.equal(f.calls[1][1].headers.Authorization,'Bearer e30.e30.bmV3');
  }finally{f.transport.dispose();}
});
test('unknown paths, origins, headers, query overrides and GET bodies fail before session/network work',async()=>{
  for(const origin of ['http://api.invalid','https://api.invalid/path','https://user:pass@api.invalid','https://api.invalid/'])
    assert.throws(()=>createMapSessionTransport({apiOrigin:origin}),/MAP_REQUEST_UNAVAILABLE/);
  const f=fixture();try{
    for(const[p,o]of [['https://other.invalid/v1/market-intel/map/views',{}],['//other.invalid/v1/market-intel/map/views',{}],
      [path+'&bbox=1',{}],[path+'&geographyId=US-STATE-48',{}],[path+'#fragment',{}],
      ['/v1/market-intel/map/../map/views?geographyId=US-STATE-04',{}],
      [path,{headers:{Authorization:'Bearer caller-owned'}}],[path,{body:'anything'}],[path,{credentials:'include'}],
      [path,{redirect:'follow'}],['/v1/market-intel/map/admin/changes?unexpected=1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}]])
      await assert.rejects(f.transport.authenticatedFetch(p,o),/INVALID_MAP_REQUEST/);
    assert.equal(f.calls.length,0);assert.equal(f.reads,0);
  }finally{f.transport.dispose();}
});
test('missing, expired, malformed or foreign host sessions never reach fetch',async()=>{
  const f=fixture();try{
    for(const s of [null,{...makeSession(),expiresAt:0},{...makeSession(),issuer:'https://other.supabase.co/auth/v1'},
      {...makeSession(),accessToken:'not-a-token'}]){f.set(s);await assert.rejects(f.transport.authenticatedFetch(path),/AUTHENTICATION_REQUIRED/);}
    assert.equal(f.calls.length,0);
  }finally{f.transport.dispose();}
});
test('session notification cancels a pending fetch and suppresses old-account response',async()=>{
  let resolve;let invalidations=0;const f=fixture(()=>new Promise(r=>resolve=r),{onInvalidate:()=>invalidations++});
  try{
    const result=f.transport.authenticatedFetch(path);await new Promise(r=>setImmediate(r));f.set(makeSession('synthetic-b'));f.notify();
    await assert.rejects(result,/SESSION_CHANGED/);assert.equal(f.calls[0][1].signal.aborted,true);assert.equal(invalidations,1);
    resolve(Response.json({privateOldAccount:true}));
  }finally{f.transport.dispose();}
});
test('account replacement discovered at final observation refuses a buffered response',async()=>{
  let f;f=fixture(async()=>{f.set(makeSession('synthetic-b'));return Response.json({oldAccount:true});});
  try{await assert.rejects(f.transport.authenticatedFetch(path),/SESSION_CHANGED/);}finally{f.transport.dispose();}
});
test('timeout bounds an uncooperative session provider and a response body',async()=>{
  const f=fixture(async()=>Response.json({ok:true}),{timeoutMs:100});f.host.readSession=()=>new Promise(()=>{});
  try{await assert.rejects(f.transport.authenticatedFetch(path),/MAP_REQUEST_UNAVAILABLE/);assert.equal(f.calls.length,0);}finally{f.transport.dispose();}
  const g=fixture(async()=>new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'application/json'}}),{timeoutMs:100});
  try{await assert.rejects(g.transport.authenticatedFetch(path),/MAP_REQUEST_UNAVAILABLE/);}finally{g.transport.dispose();}
});
test('oversized/non-JSON/redirect responses and raw host failures are opaque',async()=>{
  for(const fetcher of [async()=>new Response('bad',{headers:{'Content-Type':'text/plain'}}),
    async()=>Response.json({large:'x'.repeat(1048576)}),
    async()=>{const r=Response.json({ok:true});Object.defineProperty(r,'redirected',{value:true});return r;},async()=>{throw Error('private-network-detail');}]){
    const f=fixture(fetcher);try{await assert.rejects(f.transport.authenticatedFetch(path),/^Error: MAP_REQUEST_UNAVAILABLE$/);}finally{f.transport.dispose();}
  }
  const f=fixture();f.host.readSession=()=>{throw Error('private-session-detail');};
  try{await assert.rejects(f.transport.authenticatedFetch(path),/^Error: MAP_REQUEST_UNAVAILABLE$/);}finally{f.transport.dispose();}
});
test('approval POST is issued once; an uncertain result is never automatically retried',async()=>{
  const f=fixture(async()=>{throw Error('synthetic dropped receipt');});try{
    await assert.rejects(f.transport.authenticatedFetch('/v1/market-intel/map/admin/changes',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:'synthetic-target'})}),/MAP_REQUEST_UNAVAILABLE/);
    assert.equal(f.calls.length,1);
  }finally{f.transport.dispose();}
});
test('dispose cancels pending work, unsubscribes once and refuses further calls',async()=>{
  const f=fixture(()=>new Promise(()=>{}));const result=f.transport.authenticatedFetch(path);await new Promise(r=>setImmediate(r));
  f.transport.dispose();f.transport.dispose();await assert.rejects(result,/SESSION_CHANGED/);assert.equal(f.closed,1);
  await assert.rejects(f.transport.authenticatedFetch(path),/MAP_REQUEST_UNAVAILABLE/);
});
test('self-contained component helper copies and documented properties match canonical implementation',async()=>{
  for(const name of ['map-session-adapter.js','map-approval-host.js','map-approval-admin.js']){
    const canonical=await readFile(new URL('../../../ui/'+name,import.meta.url),'utf8');
    const packaged=await readFile(new URL('../../../ui/weweb/map-approval-admin/src/utils/'+name,import.meta.url),'utf8');assert.equal(packaged,canonical);
  }
  const config=(await import('../../../ui/weweb/map-approval-admin/ww-config.js')).default;
  const ai=JSON.parse(await readFile(new URL('../../../ui/weweb/map-approval-admin/AI.json',import.meta.url),'utf8'));
  assert.equal(config.staticRendering,true);assert.deepEqual(Object.keys(config.properties).sort(),ai.properties.map(p=>p.name).sort());
  assert.equal(config.properties.enabled.defaultValue,false);assert.equal(config.properties.apiOrigin.defaultValue,'');
});
