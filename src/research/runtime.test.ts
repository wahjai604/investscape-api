import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createResearchHost,createResearchResources,researchPoolConfig,resolveResearchRuntime,researchDevRef,researchPackageVersion} from './runtime.ts';
const origin='https://research.synthetic.invalid',issuer=`https://${researchDevRef}.supabase.co/auth/v1`;
function env(){return {RESEARCH_READ_ENABLED:'true',RESEARCH_EDITOR_ENABLED:'true',RESEARCH_AUTH_ISSUER:issuer,
  RESEARCH_AUTH_AUDIENCE:'authenticated',RESEARCH_ALLOWED_ORIGINS:origin,RESEARCH_EDITOR_ORIGIN:origin,
  RESEARCH_DB_HOST:`db.${researchDevRef}.supabase.co`,RESEARCH_DB_CA_PEM:'-----BEGIN CERTIFICATE-----\nSYNTHETIC ONLY\n-----END CERTIFICATE-----',
  ...Object.fromEntries(['reader','writer','authority'].map(k=>[`RESEARCH_${k.toUpperCase()}_DATABASE_URL`,
    `postgresql://research_${k}_login:synthetic@db.${researchDevRef}.supabase.co:5432/postgres`]))};}
test('default-off host never reads credential/generic API bindings and contains no other product routes',async()=>{
  const settings=new Proxy({} as NodeJS.ProcessEnv,{get(_target,key){if(!['RESEARCH_READ_ENABLED','RESEARCH_EDITOR_ENABLED'].includes(String(key)))throw Error('unexpected settings read');}});
  let creates=0;const h=await createResearchHost(settings,{createResources:async()=>{creates++;throw Error('unexpected resource creation');}});
  const s=h.app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  try{const base=`http://127.0.0.1:${s.address().port}`;
    for(const p of ['/v1/research/items','/v1/research/admin/changes']){
      const r=await fetch(base+p);assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');}
    for(const p of ['/v1/full/calculate','/v1/quick/calculate','/v1/market-intel/map','/lighthouse','/'])assert.equal((await fetch(base+p)).status,404);
    const health=await fetch(base+'/healthz');assert.deepEqual(await health.json(),{service:'research-api',read:'disabled',editor:'disabled'});
    assert.equal(health.headers.get('x-powered-by'),null);assert.equal(creates,0);
    assert.equal(h.shutdown(),h.shutdown());await h.shutdown();
  }finally{await new Promise(r=>s.close(r));}
});
test('armed runtime requires exact Dev issuer, dedicated HTTPS origins and explicit resources',async()=>{
  for(const change of [{RESEARCH_AUTH_ISSUER:'https://foreign.supabase.co/auth/v1'},{RESEARCH_AUTH_AUDIENCE:'anon'},
    {RESEARCH_ALLOWED_ORIGINS:'https://research.synthetic.invalid/path'},{RESEARCH_ALLOWED_ORIGINS:''},
    {RESEARCH_EDITOR_ORIGIN:'https://other.invalid'}])assert.throws(()=>resolveResearchRuntime({...env(),...change}),/RESEARCH_RUNTIME_UNAVAILABLE/);
  await assert.rejects(createResearchHost(env()),/RESEARCH_RUNTIME_UNAVAILABLE/);
  assert.deepEqual(resolveResearchRuntime({CORS_ALLOWED_ORIGINS:origin,MI_MAP_READ_ENABLED:'true'}).origins,[]);
});
test('dedicated scoped pool config rejects TLS override, foreign host/project and wrong principal',()=>{
  const good=researchPoolConfig(env(),'reader');assert.equal(good.ssl.rejectUnauthorized,true);assert.equal(good.max,2);
  for(const url of [env().RESEARCH_READER_DATABASE_URL+'?sslmode=no-verify',
    'postgres://postgres:synthetic@db.'+researchDevRef+'.supabase.co/postgres',
    'postgres://research_reader_login:synthetic@foreign.invalid/postgres',
    'postgres://research_reader_login.foreign:synthetic@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
    env().RESEARCH_READER_DATABASE_URL.replace(':5432',':6543'),env().RESEARCH_READER_DATABASE_URL.replace(':5432','')])
    assert.throws(()=>researchPoolConfig({...env(),RESEARCH_READER_DATABASE_URL:url},'reader'),/RESEARCH_RUNTIME_UNAVAILABLE/);
  assert.throws(()=>researchPoolConfig({...env(),RESEARCH_DB_CA_PEM:''},'reader'),/RESEARCH_RUNTIME_UNAVAILABLE/);
});
function factory(change={},endFails=false){const created=[];
  return {created,make(config){const kind=config.application_name.split('-').at(-1);let ends=0;
    const pool=Object.assign(new EventEmitter(),{async query(){return {rows:[{login:`research_${kind}_login`,effective_role:`research_${kind}_login`,
      rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolbypassrls:false,
      package_version:researchPackageVersion,project_ref:researchDevRef,identity_bound:true,isolated:true,memberships:[`research_${kind}`],...change}]};},
      async end(){ends++;if(endFails)throw Error('Private raw diagnostic');}});
    Object.defineProperty(pool,'ends',{get:()=>ends});
    created.push(pool);return pool;}};
}
test('resources use distinct pools and close each once; disabled editor creates no writer pool',async()=>{
  const f=factory(),e={...env(),RESEARCH_EDITOR_ENABLED:'false'};
  const r=await createResearchResources(e,resolveResearchRuntime(e),()=>({async resolve(){return {member:true,editor:false};}}),f.make);
  assert.equal(f.created.length,2);assert(r.reader);assert.equal(r.editor,undefined);
  const close=r.shutdown();assert.equal(close,r.shutdown());await close;assert.deepEqual(f.created.map(p=>p.ends),[1,1]);
});
test('unsafe principal, extra memberships, foreign package or unbound identity fail startup and clean all pools',async()=>{
  for(const change of [{rolbypassrls:true},{rolcreaterole:true},{effective_role:'postgres'},
    {memberships:['research_reader','research_owner']},{project_ref:'foreign'},{package_version:'foreign'},{identity_bound:false},{isolated:false}]){
    const f=factory(change);await assert.rejects(createResearchResources(env(),resolveResearchRuntime(env()),()=>({}),f.make),/RESEARCH_RUNTIME_UNAVAILABLE/);
    assert.deepEqual(f.created.map(p=>p.ends),[1,1,1]);}
});
test('partial pool construction and cleanup failure return only static errors with no retry',async()=>{
  const f=factory({},true);let n=0;
  await assert.rejects(createResearchResources(env(),resolveResearchRuntime(env()),()=>({}),c=>{if(++n===2)throw Error('Secret construction diagnostic');return f.make(c);}),e=>e.message==='RESEARCH_RUNTIME_UNAVAILABLE');
  assert.equal(f.created[0].ends,1);
  const f2=factory({},true),r=await createResearchResources(env(),resolveResearchRuntime(env()),()=>({}),f2.make);
  const close=r.shutdown();await assert.rejects(close,e=>e.message==='RESEARCH_SHUTDOWN_FAILED');assert.equal(close,r.shutdown());assert.deepEqual(f2.created.map(p=>p.ends),[1,1,1]);
});
