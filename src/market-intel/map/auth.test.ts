import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import { createMapSessionVerifier } from './auth.ts';
const issuer='https://synthetic.supabase.co/auth/v1'; const config={issuer,audience:'authenticated'};
const clock=1700000000;
async function fixture(alg='ES256') {
  const keys=await generateKeyPair(alg);const jwk=await exportJWK(keys.publicKey);
  const verifier=createMapSessionVerifier(config,{keyResolver:createLocalJWKSet({keys:[{...jwk,alg,kid:'synthetic'}]}),now:()=>clock});
  async function token(changes: Record<string,unknown>={}) {
    return new SignJWT({iss:issuer,aud:'authenticated',sub:'synthetic-member',exp:clock+100,
      role:'authenticated',is_anonymous:false,...changes}).setProtectedHeader({alg,kid:'synthetic'}).sign(keys.privateKey);
  }
  return {verifier,token};
}
for(const alg of ['ES256','RS256'])test(`${alg} verifies locally generated signature`,async()=>{
 const f=await fixture(alg);const r=await f.verifier.verify('Bearer '+await f.token());assert.equal(r.ok,true);
});
for(const [label,claims] of Object.entries({wrongIssuer:{iss:'https://other.supabase.co/auth/v1'},
 wrongAudience:{aud:'other'},expired:{exp:clock},missingExp:{exp:undefined},missingSub:{sub:undefined},
 emptySub:{sub:''},notYetValid:{nbf:clock+30},anonymous:{is_anonymous:true},missingAnonymous:{is_anonymous:undefined},
 wrongRole:{role:'anon'},selfAssignedMetadata:{role:'anon',user_metadata:{map_read:true}}}))
 test(label+' fails closed',async()=>{const f=await fixture();const r=await f.verifier.verify('Bearer '+await f.token(claims));
 assert.equal(r.ok,false);if(!r.ok)assert.equal(r.status,401);});
test('none and HS256 rejected',async()=>{const f=await fixture();
 const payload={iss:issuer,aud:'authenticated',sub:'synthetic',exp:clock+100,role:'authenticated',is_anonymous:false};
 const unsecured=new UnsecuredJWT(payload).encode();const symmetric=await new SignJWT(payload)
  .setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode('synthetic-test-secret-not-a-credential'));
 assert.equal((await f.verifier.verify('Bearer '+unsecured)).ok,false);
 assert.equal((await f.verifier.verify('Bearer '+symmetric)).ok,false);
});
test('bad signature rejected',async()=>{const a=await fixture();const b=await fixture();
 assert.equal((await a.verifier.verify('Bearer '+await b.token())).ok,false);});
test('malformed/dev/missing tokens denied without identities',async()=>{const f=await fixture();
 for(const input of [undefined,'Basic synthetic','Bearer dev:synthetic','Bearer token extra','Bearer malformed']){
  const r=await f.verifier.verify(input);assert.equal(r.ok,false);assert(!JSON.stringify(r).includes('dev:synthetic'));}
});
test('unconfigured or invalid config never authenticates; key outage unavailable',async()=>{
 for(const c of [null,{issuer:'http://invalid/auth/v1',audience:'authenticated'},{issuer,audience:''}]){
  const r=await createMapSessionVerifier(c).verify('Bearer synthetic');assert(!r.ok&&r.status===503);}
 const f=await fixture();const verifier=createMapSessionVerifier(config,{now:()=>clock,keyResolver:async()=>{throw Error('private network diagnostic');}});
 const r=await verifier.verify('Bearer '+await f.token());assert(!r.ok&&r.status===503);
 assert(!JSON.stringify(r).includes('private network diagnostic'));
});
