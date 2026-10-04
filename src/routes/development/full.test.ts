import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as CALC from '@investscape/calc-engine';
import { createFullRouter, fullRouterFromEnv } from './full.ts';
import { calculateFull, verifyRuntimeArtifacts, DECLARED_ENGINE_IDENTITY, ENGINE_MANIFEST } from '../../development/engineManifest.ts';
import { encode, decode, DEFAULT_LIMITS } from '../../development/transport.ts';
import type { SessionVerifier } from '../../lighthouse/auth/session.ts';
const require = createRequire(import.meta.url);
const pkg = require('investscape-dev-calc');
const inputs = JSON.parse(readFileSync(new URL('../../development/fixtures/full-baseline.json', import.meta.url), 'utf8'));
const request = (mods = {}) => ({ contractVersion:'full-adapter-1', mode:'full', inputRevision:1, inputs:{...inputs,...mods} });
const verifier: SessionVerifier = { async verify(token) { return token === 'valid' ? {ok:true,session:{actorRef:'test-user',issuer:'synthetic',expiresAt:9999999999}} : {ok:false,reason:'INVALID_TOKEN'}; } };
async function withServer(router: express.Router, fn: (url:string)=>Promise<void>) { const app=express();app.use(express.json({limit:'100kb'}));app.use('/v1',router); const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address() as {port:number};try{await fn(`http://127.0.0.1:${address.port}/v1/development/full/calculate`);}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));} }
const post=(url:string,body:unknown,token='valid')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
test('[REAL-PACKAGE] reviewed archives verified and raw baseline exact',()=>{assert.equal(verifyRuntimeArtifacts(),true);const result=calculateFull(request());assert.equal(result.status,'ok');assert.deepEqual(result.raw,pkg.devstudioCompute(result.normalizedInputs,{CALC}));assert.deepEqual(decode(encode(result)),result);assert.equal(pkg.fullResultMatchesRequest(decode(encode(result)),request(),{engineIdentity:DECLARED_ENGINE_IDENTITY}),true);});
test('[REAL-PACKAGE] 600month result fits provisional transport and retains freshness',()=>{const r=calculateFull(request({constructionMonths:600,seniorRepaymentType:'amortizing',sellOffMonths:null}));assert.ok(['ok','partial'].includes(r.status as string));const encoded=encode(r);assert.ok(Buffer.byteLength(encoded)<DEFAULT_LIMITS.maxBytes);assert.deepEqual(decode(encoded),r);console.log('600month transport bytes',Buffer.byteLength(encoded));});
test('[SYNTHETIC] gate and absent verifier/artifacts fail closed before engine',async()=>{let calls=0;for(const params of [{enabled:()=>false,verifier},{enabled:()=>true,verifier:null}])await withServer(createFullRouter({...params,artifactsVerified:true,calculate:()=>{calls++;return {};}}),async url=>{assert.equal((await post(url,request())).status,503);});await withServer(createFullRouter({enabled:()=>true,verifier,artifactsVerified:false,calculate:()=>{calls++;return {};}}),async url=>assert.equal((await post(url,request())).status,503));assert.equal(calls,0);});
test('[SYNTHETIC] missing/rejected/thrown session does not execute',async()=>{let calls=0;await withServer(createFullRouter({enabled:()=>true,verifier,artifactsVerified:true,calculate:()=>{calls++;return {};}}),async url=>{for(const token of ['', 'expired','wrong-issuer','wrong-signature'])assert.equal((await post(url,request(),token)).status,401);});assert.equal(calls,0);await withServer(createFullRouter({enabled:()=>true,verifier:{async verify(){throw Error('secret detail');}},artifactsVerified:true,calculate:()=>({})}),async url=>assert.equal((await post(url,request())).status,401));});
test('[REAL-PACKAGE] authenticated request delivers decodeable exact result, no-store',async()=>{await withServer(createFullRouter({enabled:()=>true,verifier,artifactsVerified:true,calculate:calculateFull}),async url=>{const response=await post(url,request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();assert.equal(body.transportVersion,'full-api-transport-1');assert.deepEqual(body.deploymentIdentity,ENGINE_MANIFEST);assert.deepEqual(decode(body.encodedResult),calculateFull(request()));});});
test('[REAL-PACKAGE] incomplete/invalid outcomes are distinct successful transport',async()=>{await withServer(createFullRouter({enabled:()=>true,verifier,artifactsVerified:true,calculate:calculateFull}),async url=>{for(const [value,status]of [[null,'incomplete'],['abc','invalid']] as const){const response=await post(url,request({landCost:value}));assert.equal(response.status,200);const body=await response.json();assert.equal((decode(body.encodedResult) as Record<string,unknown>).status,status);}});});
test('[SYNTHETIC] unsafe envelope rejected, identity must use transmitted request',async()=>{let calls=0;await withServer(createFullRouter({enabled:()=>true,verifier,artifactsVerified:true,calculate:()=>{calls++;return {};}}),async url=>{for(const body of [null,[],{...request(),inputRevision:-1},{...request(),inputRevision:'1'},{...request(),userId:'pretend-owner'},request({landCost:{}}),request({landCost:'x'.repeat(257)})])assert.equal((await post(url,body)).status,400);});assert.equal(calls,0);const req=request({landCost:'-0'}),result=calculateFull(req);assert.equal(pkg.fullResultMatchesRequest(decode(encode(result)),JSON.parse(JSON.stringify(req)),{engineIdentity:DECLARED_ENGINE_IDENTITY}),true);assert.ok(Object.is((result.normalizedInputs as Record<string,unknown>).landCost,-0));});
test('[SYNTHETIC] unencodable/error output returns opaque delivery failure',async()=>{for(const output of [()=>{throw Error('private-engine-detail');},()=>({loop:(()=>{const x:any={};x.x=x;return x;})()})])await withServer(createFullRouter({enabled:()=>true,verifier,artifactsVerified:true,calculate:output}),async url=>{const r=await post(url,request());assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:{message:'Full calculation could not be delivered'}});});});
test('[SOURCE] environment defaults gate off even with irrelevant dev session configuration',async()=>{await withServer(fullRouterFromEnv({LIGHTHOUSE_ALLOW_DEV_SESSIONS:'true'}),async url=>assert.equal((await post(url,request())).status,503));});
test('[REAL-JWT] signature, issuer, audience and expiration verified on route',async()=>{
 const {SignJWT}=await import('jose'); const {SupabaseSessionVerifier}=await import('../../lighthouse/auth/session.ts');
 const key=new TextEncoder().encode('local-test-fixture-secret-never-production');
 const goodVerifier=new SupabaseSessionVerifier({issuer:'https://test.invalid/auth/v1',audience:'authenticated',jwtSecret:'local-test-fixture-secret-never-production'});
 const sign=(changes:Record<string,unknown>={},signKey=key)=>new SignJWT({sub:'test-user',...changes}).setProtectedHeader({alg:'HS256'}).setIssuer(String(changes.iss??'https://test.invalid/auth/v1')).setAudience(String(changes.aud??'authenticated')).setExpirationTime(changes.exp as number??Math.floor(Date.now()/1000)+60).sign(signKey);
 await withServer(createFullRouter({enabled:()=>true,verifier:goodVerifier,artifactsVerified:true,calculate:calculateFull}),async url=>{
  assert.equal((await post(url,request(),await sign())).status,200);
  for(const token of [await sign({iss:'https://wrong.invalid'}),await sign({aud:'wrong'}),await sign({exp:1}),await sign({},new TextEncoder().encode('wrong-test-signing-key'))])assert.equal((await post(url,request(),token)).status,401);
 });
});
test('[REAL-PACKAGE] bounded 600month active mezz/presale fixture fits transport',()=>{
 const r=calculateFull(request({constructionMonths:594,sellOffMonths:6,mezzAmount:1000000,mezzRate:12,mezzAmortizationYears:3,mezzDrawMonth:1,mezzRepaymentType:'interest_only_bullet',mezzSellOffMonths:6,presaleDepositAmount:300000,presaleDepositMilestoneMonth:600}));
 assert.ok(['ok','partial'].includes(r.status as string));const encoded=encode(r);assert.deepEqual(decode(encoded),r);console.log('600month active mezz/presale transport bytes',Buffer.byteLength(encoded));
});
test('[SYNTHETIC] nonenumerable finite business property refuses transport explicitly',async()=>{
 const x={};Object.defineProperty(x,'wacc',{value:0.1,enumerable:false});
 await withServer(createFullRouter({enabled:()=>true,verifier,artifactsVerified:true,calculate:()=>({raw:{stack:x}})}),async url=>assert.equal((await post(url,request())).status,500));
});
test('[REAL-JWKS] asymmetric environment factory verifies valid and refuses bad claims/signature',async()=>{
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const {createServer}=await import('node:http');
 const keys=await generateKeyPair('RS256'),wrong=await generateKeyPair('RS256');const jwk={...await exportJWK(keys.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
 const jwks=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});jwks.listen(0,'127.0.0.1');await new Promise<void>(r=>jwks.once('listening',r));const address=jwks.address() as {port:number};
 const sign=(changes:Record<string,unknown>={},privateKey=keys.privateKey)=>new SignJWT({sub:'test-user'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(String(changes.iss??'https://test.invalid/auth/v1')).setAudience(String(changes.aud??'authenticated')).setExpirationTime(changes.exp as number??Math.floor(Date.now()/1000)+60).sign(privateKey);
 try{await withServer(fullRouterFromEnv({INVESTSCAPE_FF_NATIVE_FULL:'true',SUPABASE_JWT_ISSUER:'https://test.invalid/auth/v1',SUPABASE_JWKS_URL:`http://127.0.0.1:${address.port}/jwks`}),async url=>{
  assert.equal((await post(url,request(),await sign())).status,200);
  for(const token of [await sign({iss:'https://wrong.invalid'}),await sign({aud:'wrong'}),await sign({exp:1}),await sign({},wrong.privateKey),await new SignJWT({sub:'test-user'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://test.invalid/auth/v1').setAudience('authenticated').sign(keys.privateKey)])assert.equal((await post(url,request(),token)).status,401);
 });}finally{await new Promise<void>((r,j)=>jwks.close(e=>e?j(e):r()));}
});
