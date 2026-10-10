import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {createResearchVerifier} from './auth.ts';
test('Research JWT verifier rejects expired, wrong issuer/audience, missing permanent-member claim and bad signature',async()=>{
  const issuer='https://synthetic.supabase.co/auth/v1',keys=await generateKeyPair('ES256'),foreign=await generateKeyPair('ES256');
  const verifier=createResearchVerifier({issuer,audience:'authenticated'},async()=>keys.publicKey);
  const sign=async(change={})=>new SignJWT({iss:issuer,aud:'authenticated',sub:'00000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+300,
    session_id:'00000000-0000-4000-8000-000000000002',role:'authenticated',is_anonymous:false,...change}).setProtectedHeader({alg:'ES256'}).sign(keys.privateKey);
  assert((await verifier.verify('Bearer '+await sign()))?.subject==='00000000-0000-4000-8000-000000000001');
  for(const change of [{exp:1},{iss:'https://foreign.supabase.co/auth/v1'},{aud:'foreign'},{is_anonymous:true},
    {is_anonymous:undefined},{role:'anon'},{sub:''},{session_id:undefined},{session_id:'invalid'}])assert.equal(await verifier.verify('Bearer '+await sign(change)),null);
  const invalid=await new SignJWT({iss:issuer,aud:'authenticated',sub:'00000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+300,
    session_id:'00000000-0000-4000-8000-000000000002',role:'authenticated',is_anonymous:false}).setProtectedHeader({alg:'ES256'}).sign(foreign.privateKey);
  assert.equal(await verifier.verify('Bearer '+invalid),null);
});
