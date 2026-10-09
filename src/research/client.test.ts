import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchLibrary} from '../../ui/weweb/research-library/src/utils/research-library.js';
import {createResearchSessionTransport} from '../../ui/weweb/research-library/src/utils/research-session-adapter.js';
const issuer='https://synthetic.supabase.co/auth/v1';
const session=()=>({issuer,subject:'synthetic-member',expiresAt:Date.now()/1000+120,accessToken:'synthetic.header.signature'});
function item(){return {id:'synthetic-report',revision:1,title:'Synthetic research',publisher:'Synthetic Publisher',
  canonicalUrl:'https://publisher.invalid/report',geography:['CA-CMA-933'],topics:['housing'],attribution:'Synthetic attribution',
  publishedAt:null,retrievedAt:null,reviewedAt:new Date().toISOString(),reviewDueAt:new Date(Date.now()+60000).toISOString(),
  readValidUntil:new Date(Date.now()+30000).toISOString(),summary:null,contentMode:'link_only',
  permissionMetadata:{audience:'member',aiAllowed:false,fullTextAllowed:false}};}
const list=(records=[item()])=>({revision:1,items:records,coverage:{status:records.length?'available':'no_data'},pagination:{offset:0,limit:25,hasMore:false}});
test('visible list/detail use safe projections and expire without storage',async()=>{
  let state,expire;
  const client=createResearchLibrary({request:async path=>Response.json(path.includes('/items/')?{revision:1,item:item()}:list()),
    onState:s=>{state=s;},setTimer:fn=>{expire=fn;return 1;},clearTimer:()=>{}});
  await client.load();assert.equal(state.items.length,1);assert.equal('permissionMetadata'in state.items[0],false);
  await client.select('synthetic-report');assert.equal(state.selected.summary,null);
  expire();assert.equal(state.items.length,0);assert.equal(state.selected,null);assert.equal(state.status,'refresh_required');client.dispose();
});
test('withdrawal/error and session invalidation clear list/detail; delayed result cannot repopulate',async()=>{
  let state,resolve;
  const client=createResearchLibrary({onState:s=>{state=s;},request:()=>new Promise(r=>{resolve=r;})});
  const pending=client.load();client.clear('refresh_required');resolve(Response.json(list()));await pending;assert.equal(state.items.length,0);
  client.dispose();
  const missing=createResearchLibrary({onState:s=>{state=s;},request:async()=>Response.json({error:{code:'RESEARCH_ITEM_UNAVAILABLE'}},{status:404})});
  await missing.select('synthetic-report');assert.equal(state.status,'unavailable');assert.equal(state.selected,null);missing.dispose();
});
test('unsafe source URLs, full-text modes and unbounded/expired response are rejected',async()=>{
  for(const change of [{canonicalUrl:'javascript:alert(1)'},{contentMode:'full_text'},{summary:'Unpermitted text'},
    {readValidUntil:new Date(Date.now()-1000).toISOString()},{permissionMetadata:{audience:'public',fullTextAllowed:true,aiAllowed:true}}]){
    let state;const client=createResearchLibrary({onState:s=>{state=s;},request:async()=>Response.json(list([{...item(),...change}]))});
    await client.load();assert.equal(state.status,'unavailable');assert.equal(state.items.length,0);client.dispose();
  }
});
test('transport sends only reviewed GET requests and cancels on an account change',async()=>{
  let changed,identity=session(),fetches=0;
  const host={issuer,readSession:async()=>identity,subscribe:fn=>{changed=fn;return()=>{};}};
  const transport=createResearchSessionTransport({apiOrigin:'https://api.synthetic.invalid',host,fetchImpl:async(_url,options)=>{
    fetches++;assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');return Response.json(list());}});
  await transport.authenticatedFetch('/v1/research/items?q=synthetic');assert.equal(fetches,1);
  for(const path of ['/v1/research/admin/changes','/v1/research/../admin/changes','//foreign.invalid/',
    '/v1/research/items/synthetic%2dreport','/v1/research/items?q=a&q=b'])await assert.rejects(transport.authenticatedFetch(path),/INVALID_RESEARCH_REQUEST/);
  await assert.rejects(transport.authenticatedFetch('/v1/research/items',{method:'POST'}),/INVALID_RESEARCH_REQUEST/);
  let resolve;host.readSession=()=>new Promise(r=>{resolve=r;});
  const pending=transport.authenticatedFetch('/v1/research/items');await new Promise(r=>setImmediate(r));
  changed();resolve(identity);await assert.rejects(pending,/SESSION_CHANGED/);transport.dispose();
});
test('transport rejects redirected/oversized responses and detects silent account switching',async()=>{
  for(const mode of ['oversized','switched']){
    let reads=0;
    const transport=createResearchSessionTransport({apiOrigin:'https://api.synthetic.invalid',
      host:{issuer,readSession:async()=>({...session(),subject:++reads>1&&mode==='switched'?'synthetic-other':'synthetic-member'}),subscribe:()=>()=>{}},
      fetchImpl:async()=>mode==='oversized'?new Response(' '.repeat(1048577),{headers:{'content-type':'application/json'}}):Response.json(list())});
    await assert.rejects(transport.authenticatedFetch('/v1/research/items'),mode==='switched'?/SESSION_CHANGED/:/RESEARCH_REQUEST_UNAVAILABLE/);transport.dispose();
  }
});
