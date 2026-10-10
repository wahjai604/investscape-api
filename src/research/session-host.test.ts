import test from 'node:test';
import assert from 'node:assert/strict';
import {createExistingSupabaseResearchHost} from '../../ui/weweb/research-library/src/utils/research-supabase-session-host.js';
import {createResearchSessionTransport} from '../../ui/weweb/research-library/src/utils/research-session-adapter.js';
const issuer='https://synthetic.supabase.co/auth/v1';
const session=()=>({user:{id:'synthetic-member',is_anonymous:false},expires_at:Date.now()/1000+120,
  access_token:'synthetic.header.signature'});
function fixture(){
  let current:any,callback:()=>void,reads=0,closes=0,value:any=session(),read:any;
  const client={auth:{getSession:async()=>{reads++;return read?read():{data:{session:value}};},
    onAuthStateChange:(fn:()=>void)=>{callback=fn;return {data:{subscription:{unsubscribe:()=>{closes++;}}}};}}};
  current=client;
  const host=createExistingSupabaseResearchHost({client,issuer,getCurrentClient:()=>current});
  return {host,client,event:()=>callback(),replace:()=>{current={};},restore:()=>{current=client;},set:(v:any)=>{value=v;},read:(fn:any)=>{read=fn;},
    reads:()=>reads,closes:()=>closes};
}
test('Research existing-client bridge supplies only transient transport fields and shares one SDK subscription',async()=>{
  const f=fixture();let notifications=0;
  Object.defineProperty(f.client,'privateInstance',{get(){throw Error('SYNTHETIC_SECRET');}});
  const fn=()=>{notifications++;};const off1=f.host.subscribe(fn),off2=f.host.subscribe(fn);
  assert.deepEqual(Object.keys(await f.host.readSession()).sort(),['accessToken','expiresAt','issuer','subject']);
  f.event();assert.equal(notifications,0);await new Promise(r=>setTimeout(r,5));assert.equal(notifications,2);
  off1();assert.equal(f.closes(),0);off2();off2();f.host.destroy();assert.equal(f.closes(),1);
});
test('sign-out fences pending SDK reads and replacement is terminal even if the old client returns',async()=>{
  const f=fixture();const off=f.host.subscribe(()=>{});let resolve:any;
  f.read(()=>new Promise(r=>{resolve=r;}));const pending=f.host.readSession();
  f.event();resolve({data:{session:session()}});await assert.rejects(pending,/^Error: SESSION_CHANGED$/);
  f.replace();await assert.rejects(f.host.readSession(),/^Error: SESSION_CHANGED$/);
  f.restore();await assert.rejects(f.host.readSession(),/^Error: SESSION_CHANGED$/);
  off();f.host.destroy();assert.equal(f.closes(),1);
});
test('absent, anonymous, expired or malformed sessions and secret-bearing getters yield only static denial',async()=>{
  const f=fixture();
  for(const value of [null,{...session(),user:{id:'synthetic',is_anonymous:true}},
    {...session(),expires_at:0},{...session(),access_token:'bad'},
    Object.defineProperty({},'user',{get(){throw Error('SYNTHETIC_SECRET');}})]){
    f.set(value);await assert.rejects(f.host.readSession(),/^Error: AUTHENTICATION_REQUIRED$/);
  }
  f.read(()=>{throw Error('SYNTHETIC_SECRET');});await assert.rejects(f.host.readSession(),/^Error: AUTHENTICATION_REQUIRED$/);
  f.host.destroy();
});
test('destroy cancels pending notifications, denies later reads and attempts failing cleanup once',async()=>{
  const queued=fixture();let delayed=0;queued.host.subscribe(()=>{delayed++;});
  queued.event();queued.host.destroy();assert.equal(delayed,1);
  await new Promise(r=>setTimeout(r,5));assert.equal(delayed,1);assert.equal(queued.closes(),1);
  const f=fixture();let notifications=0,closes=0;
  f.client.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){closes++;throw Error('SYNTHETIC_SECRET');}}}});
  const off=f.host.subscribe(()=>{notifications++;});
  assert.throws(()=>f.host.destroy(),/^Error: RESEARCH_HOST_CLEANUP_FAILED$/);
  off();f.host.destroy();await new Promise(r=>setTimeout(r,5));
  assert.equal(closes,1);assert.equal(notifications,1);
  await assert.rejects(f.host.readSession(),/^Error: RESEARCH_HOST_UNAVAILABLE$/);
});
test('bridge composes with the existing reader transport and rejects sign-out before another fetch',async()=>{
  const f=fixture();let fetches=0,cleared=0;
  const transport=createResearchSessionTransport({apiOrigin:'https://api.synthetic.invalid',host:f.host,
    onInvalidate:()=>{cleared++;},fetchImpl:async(_url:any,options:any)=>{
      fetches++;assert.equal(options.headers.Authorization,'Bearer synthetic.header.signature');return Response.json({items:[]});}});
  assert.equal((await transport.authenticatedFetch('/v1/research/items')).status,200);
  assert.equal(f.reads(),2);f.set(null);f.event();await new Promise(r=>setTimeout(r,5));
  await assert.rejects(transport.authenticatedFetch('/v1/research/items'),/^Error: AUTHENTICATION_REQUIRED$/);
  assert.equal(fetches,1);assert.equal(cleared,1);transport.dispose();f.host.destroy();assert.equal(f.closes(),1);
});
