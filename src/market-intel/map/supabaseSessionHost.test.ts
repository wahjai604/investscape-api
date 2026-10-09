import test from 'node:test';
import assert from 'node:assert/strict';
import {createExistingSupabaseMapHost} from '../../../ui/map-supabase-session-host.js';
import {createMapSessionTransport} from '../../../ui/map-session-adapter.js';
const issuer='https://synthetic.supabase.co/auth/v1';
const path='/v1/market-intel/map/views?geographyId=US-STATE-04';
const session=(id='synthetic-a',token='e30.e30.c2ln')=>({user:{id,is_anonymous:false},expires_at:Date.now()/1000+600,access_token:token});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
  let current=session(),callback,reads=0,subscribed=0,closed=0,inCallback=false;
  let read=async()=>({data:{session:current},error:null});
  const client={auth:{
    getSession(){reads++;assert.equal(inCallback,false);return read();},
    onAuthStateChange(fn){subscribed++;callback=fn;return {data:{subscription:{unsubscribe(){closed++;}}}};}
  }};
  let binding=client;
  const host=createExistingSupabaseMapHost({client,issuer,getCurrentClient:()=>binding});
  return {host,client,get reads(){return reads;},get subscribed(){return subscribed;},get closed(){return closed;},
    set(value){current=value;},setRead(fn){read=fn;},replace(value={}){binding=value;},
    event(){inCallback=true;try{callback('TOKEN_REFRESHED',current);}finally{inCallback=false;}}};
}
test('existing client bridge reads fresh minimal transient session without discovery or cache',async()=>{
  const f=fixture();try{
    assert.equal(f.subscribed,0);assert.equal(f.reads,0);
    assert.deepEqual(await f.host.readSession(),{issuer,subject:'synthetic-a',expiresAt:(await f.client.auth.getSession()).data.session.expires_at,accessToken:'e30.e30.c2ln'});
    f.set(session('synthetic-b','e30.e30.bmV3'));assert.equal((await f.host.readSession()).subject,'synthetic-b');
    assert(Object.isFrozen(f.host));
  }finally{f.host.destroy();}
});
test('invalid binding methods or issuer are denied before SDK use',()=>{
  for(const issuer of ['http://synthetic.supabase.co/auth/v1','https://other.invalid/auth/v1',undefined])
    assert.throws(()=>createExistingSupabaseMapHost({issuer}),/^Error: MAP_HOST_UNAVAILABLE$/);
  const f=fixture();try{
    assert.throws(()=>createExistingSupabaseMapHost({client:f.client,issuer,getCurrentClient:()=>({})}),/^Error: SESSION_CHANGED$/);
    assert.throws(()=>createExistingSupabaseMapHost({client:f.client,issuer}),/^Error: MAP_HOST_UNAVAILABLE$/);
  }finally{f.host.destroy();}
});
test('null, expired, malformed and anonymous sessions return only static denial',async()=>{
  const f=fixture();try{
    for(const value of [null,{...session(),expires_at:0},{...session(),access_token:'bad'},
      {...session(),user:{id:'synthetic',is_anonymous:true}},{...session(),user:{id:'synthetic'}}]){
      f.set(value);await assert.rejects(f.host.readSession(),/^Error: AUTHENTICATION_REQUIRED$/);
    }
    f.setRead(async()=>{throw Error('synthetic private SDK diagnostic');});
    await assert.rejects(f.host.readSession(),/^Error: AUTHENTICATION_REQUIRED$/);
    f.setRead(async()=>({data:{session:session()},error:{message:'synthetic private SDK diagnostic'}}));
    await assert.rejects(f.host.readSession(),/^Error: AUTHENTICATION_REQUIRED$/);
  }finally{f.host.destroy();}
});
test('Auth listener delivery is deferred and coalesced outside SDK callback',async()=>{
  const f=fixture();let notified=0;
  const stop=f.host.subscribe(()=>{notified++;void f.host.readSession();});
  try{f.event();f.event();assert.equal(notified,0);await tick();assert.equal(notified,1);assert.equal(f.reads,1);}
  finally{stop();f.host.destroy();}assert.equal(f.closed,1);
});
test('multiple consumers share one SDK subscription and each unsubscribe is idempotent',()=>{
  const f=fixture(),listener=()=>{};const a=f.host.subscribe(listener),b=f.host.subscribe(listener);
  assert.equal(f.subscribed,1);a();a();assert.equal(f.closed,0);b();b();assert.equal(f.closed,1);
  const c=f.host.subscribe(listener);assert.equal(f.subscribed,2);c();f.host.destroy();assert.equal(f.closed,2);
});
test('pending tasks are cancelled when the last consumer leaves',async()=>{
  const f=fixture();let notified=0;const stop=f.host.subscribe(()=>notified++);
  f.event();stop();await tick();assert.equal(notified,0);f.host.destroy();assert.equal(f.closed,1);
});
test('an Auth event fences a session read before deferred notification executes',async()=>{
  const f=fixture();const stop=f.host.subscribe(()=>{});let resolve;
  f.setRead(()=>new Promise(r=>resolve=r));const read=f.host.readSession();f.event();
  resolve({data:{session:session()},error:null});
  await assert.rejects(read,/SESSION_CHANGED/);stop();f.host.destroy();
});
test('client replacement permanently invalidates old host until explicit recreation',async()=>{
  const f=fixture();let notified=0;const stop=f.host.subscribe(()=>notified++);
  f.replace();await assert.rejects(f.host.readSession(),/^Error: SESSION_CHANGED$/);await tick();assert.equal(notified,1);
  f.replace(f.client);await assert.rejects(f.host.readSession(),/^Error: SESSION_CHANGED$/);
  assert.throws(()=>f.host.subscribe(()=>{}),/^Error: SESSION_CHANGED$/);
  stop();f.host.destroy();
});
test('destroy cancels consumers once and suppresses late SDK reads/events',async()=>{
  const f=fixture();let invalidated=0;f.host.subscribe(()=>invalidated++);
  let resolve;f.setRead(()=>new Promise(r=>resolve=r));const read=f.host.readSession();f.event();
  f.host.destroy();f.host.destroy();resolve({data:{session:session()},error:null});
  await assert.rejects(read,/MAP_HOST_UNAVAILABLE/);await tick();assert.equal(invalidated,1);assert.equal(f.closed,1);
  await assert.rejects(f.host.readSession(),/MAP_HOST_UNAVAILABLE/);f.event();assert.equal(invalidated,1);
});
test('existing-client bridge composes with bounded transport; sign-out cancels delayed private response',async()=>{
  const f=fixture();let resolve,invalidated=0;const calls=[];
  const transport=createMapSessionTransport({host:f.host,apiOrigin:'https://api.synthetic.invalid',
    onInvalidate:()=>invalidated++,fetchImpl:async(url,options)=>{calls.push({url,options});return new Promise(r=>resolve=r);}});
  try{
    const request=transport.authenticatedFetch(path);await tick();assert.equal(calls.length,1);
    assert.equal(calls[0].options.headers.Authorization,'Bearer e30.e30.c2ln');
    f.set(null);f.event();await assert.rejects(request,/SESSION_CHANGED/);
    assert.equal(calls[0].options.signal.aborted,true);assert.equal(invalidated,1);
    resolve(Response.json({syntheticOldAccount:true}));
    await assert.rejects(transport.authenticatedFetch(path),/AUTHENTICATION_REQUIRED/);assert.equal(calls.length,1);
  }finally{transport.dispose();f.host.destroy();}assert.equal(f.closed,1);
});
test('failing listener does not prevent another consumer from invalidating',async()=>{
  const f=fixture();let notified=0;const a=f.host.subscribe(()=>{throw Error('synthetic consumer error');}),b=f.host.subscribe(()=>notified++);
  try{f.event();await tick();assert.equal(notified,1);}finally{a();b();f.host.destroy();}
});
