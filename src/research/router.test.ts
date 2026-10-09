import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {generateKeyPair,SignJWT} from 'jose';
import {createResearchRouter,defaultResearchRuntime} from './router.ts';
import {createResearchVerifier} from './auth.ts';
const issuer='https://synthetic.supabase.co/auth/v1',origin='https://research.synthetic.invalid';
async function serverFixture(options={}){
  const {privateKey,publicKey}=await generateKeyPair('ES256');
  const token=async(subject='synthetic-member',claims={})=>new SignJWT({role:'authenticated',is_anonymous:false,...claims})
    .setProtectedHeader({alg:'ES256'}).setIssuer(issuer).setAudience('authenticated').setSubject(subject)
    .setExpirationTime(Math.floor(Date.now()/1000)+300).sign(privateKey);
  let reads=0,changes=0,access=true;
  const reader={async list(){reads++;return {revision:1,items:[],coverage:{status:'no_data'},pagination:{offset:0,limit:25,hasMore:false}};},
    async detail(){reads++;return {revision:1,item:null};}};
  const editor={async change(){changes++;return {id:'synthetic-report',revision:1,catalogRevision:1,state:'staged'};},
    async inspect(){return {id:'synthetic-report',revision:1,state:'staged',audit:[]};}};
  const app=express();app.use('/v1/research',createResearchRouter({readEnabled:true,editorEnabled:true,
    auth:{issuer,audience:'authenticated'},origins:[origin],editorOrigin:origin},
    {reader,editor,authority:{async resolve(s){return {member:access,editor:s.subject==='synthetic-editor'};}},
      verifier:createResearchVerifier({issuer,audience:'authenticated'},async()=>publicKey),...options}).router);
  app.use((_req,res)=>res.status(418).json({legacy:true}));const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/v1/research`;
  return {token,get reads(){return reads;},get changes(){return changes;},revoke(){access=false;},
    async request(path='/items',bearer: string|null|undefined=undefined,config={}){
      if(bearer===undefined)bearer=await token();
      const response=await fetch(url+path,{...config,headers:{Origin:origin,...(bearer?{Authorization:'Bearer '+bearer}:{}),...config.headers}});
      return {status:response.status,body:response.status===204?null:await response.json(),headers:response.headers};},
    close:()=>new Promise(resolve=>server.close(resolve))};
}
test('default-off and armed-without-resources are terminal and do not instantiate live JWKS',async()=>{
  for(const config of [defaultResearchRuntime(),{readEnabled:true,editorEnabled:true,auth:{issuer,audience:'authenticated'},origins:[origin],editorOrigin:origin}]){
    const app=express();app.use('/v1/research',createResearchRouter(config).router);
    app.use((_req,res)=>res.status(418).end());const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    try{const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/research/items`);assert.equal(r.status,503);
      assert.equal(r.headers.get('cache-control'),'no-store');}finally{await new Promise(r=>server.close(r));}
  }
});
test('signed member reads require independent fresh access; list and hidden detail fail consistently',async()=>{
  const f=await serverFixture();try{
    assert.equal((await f.request('/items',null)).status,401);
    assert.equal((await f.request('/items',await f.token('synthetic-anonymous',{is_anonymous:true}))).status,401);
    assert.equal((await f.request()).status,200);assert.equal((await f.request('/items/synthetic-hidden')).status,404);
    assert.equal((await f.request('/items/synthetic-missing')).body.error.code,'RESEARCH_ITEM_UNAVAILABLE');
    f.revoke();assert.equal((await f.request()).status,403);assert.equal(f.reads,3);
  }finally{await f.close();}
});
test('editor role is server-owned; authentication precedes JSON parsing and denied origins do not reach writer',async()=>{
  const f=await serverFixture();try{
    const invalid={method:'POST',headers:{'Content-Type':'application/json'},body:'{'};
    assert.equal((await f.request('/admin/changes',null,invalid)).status,401);
    assert.equal((await f.request('/admin/changes',await f.token('synthetic-member',{user_metadata:{editor:true}}),invalid)).status,403);
    assert.equal((await f.request('/admin/items/synthetic-report')).status,403);
    assert.equal((await f.request('/admin/items/synthetic-report',await f.token('synthetic-editor'))).status,200);
    assert.equal((await f.request('/admin/changes',await f.token('synthetic-editor'),invalid)).status,400);
    const input={action:'withdraw',id:'synthetic-report',expectedRevision:1,reason:'Synthetic withdrawal'};
    const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)};
    assert.equal((await f.request('/admin/changes',await f.token('synthetic-editor'),options)).status,200);assert.equal(f.changes,1);
    assert.equal((await f.request('/admin/changes',await f.token('synthetic-editor'),{...options,headers:{Origin:'https://foreign.invalid','Content-Type':'application/json'}})).status,403);
  }finally{await f.close();}
});
test('CORS, malformed/repeated filters, bounded budget and opaque backend failure',async()=>{
  const f=await serverFixture();try{
    assert.equal((await f.request('/items?q=a&q=b')).status,400);
    assert.equal((await f.request('/items?limit=51')).status,400);
    assert.equal((await f.request('/items/synthetic-hidden?extra=1')).status,400);
    const preflight=await f.request('/items',null,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
    assert.equal((await f.request('/items',null,{method:'OPTIONS',headers:{Origin:'https://foreign.invalid'}})).status,403);
  }finally{await f.close();}
  const limited=await serverFixture({requestLimit:1});try{assert.equal((await limited.request()).status,200);
    assert.equal((await limited.request()).status,429);}finally{await limited.close();}
  const failed=await serverFixture({reader:{async list(){throw Error('Private connection diagnostics');}}});try{
    const r=await failed.request();assert.equal(r.status,503);assert.equal(JSON.stringify(r.body).includes('Private'),false);
  }finally{await failed.close();}
});
