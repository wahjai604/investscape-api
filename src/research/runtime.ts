import express from 'express';
import helmet from 'helmet';
import {Pool,type PoolConfig} from 'pg';
import {createResearchRouter,defaultResearchRuntime,type ResearchRuntime,type ResearchAuthority} from './router.ts';
import type {ResearchVerifier} from './auth.ts';
import {PgResearchDatabase} from './sql.ts';
import {PostgresResearchStore} from './store.ts';

export const researchDevRef='hwhkgrwikczwztfnsjir';
export const researchPackageVersion='research-dev-1';
const httpsOrigin=(s:string|undefined)=>{try{const u=new URL(s!);return u.protocol==='https:'&&u.origin===s?s:null;}catch{return null;}};
const unavailable=()=>new Error('RESEARCH_RUNTIME_UNAVAILABLE');
/** Reads only explicitly named Research posture keys. No generic API/map settings or dotenv discovery. */
export function resolveResearchRuntime(env:NodeJS.ProcessEnv):ResearchRuntime {
  const readEnabled=env.RESEARCH_READ_ENABLED==='true',editorEnabled=env.RESEARCH_EDITOR_ENABLED==='true';
  if(!readEnabled&&!editorEnabled)return defaultResearchRuntime();
  const issuer=env.RESEARCH_AUTH_ISSUER;
  const raw=(env.RESEARCH_ALLOWED_ORIGINS??'').split(',').map(s=>s.trim());
  const origins=[...new Set(raw)];
  const editorOrigin=httpsOrigin(env.RESEARCH_EDITOR_ORIGIN);
  if(issuer!==`https://${researchDevRef}.supabase.co/auth/v1`||env.RESEARCH_AUTH_AUDIENCE!=='authenticated'||
    origins.length===0||origins.length>16||!origins.every(s=>httpsOrigin(s))||
    (editorEnabled&&(!editorOrigin||!origins.includes(editorOrigin))))throw unavailable();
  return {readEnabled,editorEnabled,auth:{issuer,audience:'authenticated'},origins,editorOrigin};
}
export type ResearchPoolKind='reader'|'writer'|'authority';
export type ResearchPoolFactory=(config:PoolConfig)=>Pool;
const bindings={reader:'RESEARCH_READER_DATABASE_URL',writer:'RESEARCH_WRITER_DATABASE_URL',authority:'RESEARCH_AUTHORITY_DATABASE_URL'} as const;
/** Secret bindings are consumed only when armed. SSL URL options cannot override certificate verification. */
export function researchPoolConfig(env:NodeJS.ProcessEnv,kind:ResearchPoolKind):PoolConfig {
  try{
    const connectionString=env[bindings[kind]],ca=env.RESEARCH_DB_CA_PEM,host=env.RESEARCH_DB_HOST;
    if(!connectionString||!ca||!ca.includes('-----BEGIN CERTIFICATE-----')||!host)throw unavailable();
    const u=new URL(connectionString),login=`research_${kind}_login`,user=decodeURIComponent(u.username);
    const direct=u.hostname===`db.${researchDevRef}.supabase.co`&&user===login;
    const pooler=/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)&&user===`${login}.${researchDevRef}`;
    if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==host||(!direct&&!pooler)||
      u.port!=='5432'||u.pathname!=='/postgres'||!u.password||u.search||u.hash)throw unavailable();
    return {connectionString,ssl:{ca,rejectUnauthorized:true},max:2,connectionTimeoutMillis:5000,
      idleTimeoutMillis:10000,query_timeout:5000,statement_timeout:5000,lock_timeout:3000,
      application_name:`investscape-research-${kind}`,options:`-c search_path=pg_catalog -c default_transaction_read_only=${kind==='writer'?'off':'on'}`};
  }catch{throw unavailable();}
}
export interface ResearchResources {
  reader?:PostgresResearchStore;editor?:PostgresResearchStore;authority:ResearchAuthority;
  shutdown():Promise<void>;
}
/** Supplied only by this dedicated host. Authority construction is added independently of catalog resources. */
export async function createResearchResources(env:NodeJS.ProcessEnv,config:ResearchRuntime,
  authorityFactory:(pool:Pool,issuer:string)=>ResearchAuthority,
  factory:ResearchPoolFactory=c=>new Pool(c)):Promise<ResearchResources> {
  if(!config.auth||(!config.readEnabled&&!config.editorEnabled))throw unavailable();
  const kinds:ResearchPoolKind[]=[...(config.readEnabled?['reader' as const]:[]),...(config.editorEnabled?['writer' as const]:[]),'authority'];
  const configs=kinds.map(kind=>researchPoolConfig(env,kind));
  const pools=new Map<ResearchPoolKind,Pool>();let closing:Promise<void>|undefined;
  const shutdown=()=>closing??=Promise.allSettled([...pools.values()].map(p=>Promise.resolve().then(()=>p.end())))
    .then(results=>{if(results.some(r=>r.status==='rejected'))throw new Error('RESEARCH_SHUTDOWN_FAILED');});
  try{
    for(let i=0;i<kinds.length;i++){
      const p=factory(configs[i]);if([...pools.values()].includes(p))throw unavailable();
      pools.set(kinds[i],p);p.on('error',()=>{/* Background errors are consumed; requests fail with static envelopes. */});
    }
    const results=await Promise.allSettled(kinds.map(async kind=>{
      const p=pools.get(kind)!;
      const r=await p.query(`SELECT session_user AS login,current_user AS effective_role,
        r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
        s.package_version,s.project_ref,s.identity_bound,
        NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname NOT IN('research_private','pg_catalog','information_schema') AND left(n.nspname,3)<>'pg_'
          AND c.relkind IN('r','p','v','m','f') AND has_schema_privilege(r.oid,n.oid,'USAGE')
          AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
        AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname NOT IN('research_private','pg_catalog','information_schema') AND left(n.nspname,3)<>'pg_'
          AND p.prosecdef AND p.prorettype NOT IN('trigger'::regtype,'event_trigger'::regtype)
          AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS isolated,
        ARRAY(SELECT parent.rolname FROM pg_roles parent WHERE parent.oid<>r.oid
          AND pg_has_role(r.oid,parent.oid,'MEMBER')) AS memberships
        FROM pg_roles r CROSS JOIN research_private.runtime_settings s WHERE r.rolname=session_user AND s.singleton`);
      const row=r.rows[0],expected=`research_${kind}_login`;
      if(r.rows.length!==1||row.login!==expected||row.effective_role!==expected||row.rolsuper||row.rolcreaterole||
        row.rolcreatedb||row.rolreplication||row.rolbypassrls||row.package_version!==researchPackageVersion||
        row.project_ref!==researchDevRef||row.identity_bound!==true||row.isolated!==true||
        !Array.isArray(row.memberships)||row.memberships.length!==1||row.memberships[0]!==`research_${kind}`)throw unavailable();
    }));
    if(results.some(r=>r.status==='rejected'))throw unavailable();
    return {reader:pools.has('reader')?new PostgresResearchStore(new PgResearchDatabase(pools.get('reader')!)):undefined,
      editor:pools.has('writer')?new PostgresResearchStore(new PgResearchDatabase(pools.get('writer')!)):undefined,
      authority:authorityFactory(pools.get('authority')!,config.auth.issuer),shutdown};
  }catch{try{await shutdown();}catch{/* Static startup failure remains unsuccessful. */}throw unavailable();}
}
/** Research-only host; imports no calculation, Lighthouse, map or legacy entrypoint. */
export async function createResearchHost(env:NodeJS.ProcessEnv,options:{
  resources?:ResearchResources;createResources?:(config:ResearchRuntime)=>Promise<ResearchResources>;verifier?:ResearchVerifier;
}={}) {
  const config=resolveResearchRuntime(env);let resources:ResearchResources|undefined;
  if(config.readEnabled||config.editorEnabled){
    resources=options.resources??await options.createResources?.(config);
    if(!resources?.authority||(config.readEnabled&&!resources.reader)||(config.editorEnabled&&!resources.editor)){
      try{await resources?.shutdown();}catch{}throw unavailable();}
  }
  let closing:Promise<void>|undefined;
  const shutdown=()=>closing??=Promise.resolve().then(()=>resources?.shutdown()).then(()=>undefined,()=>{throw new Error('RESEARCH_SHUTDOWN_FAILED');});
  try{
    const app=express();app.disable('x-powered-by');app.disable('etag');app.set('trust proxy',false);app.use(helmet());
    const composition=createResearchRouter(config,{reader:resources?.reader,editor:resources?.editor,
      authority:resources?.authority,verifier:options.verifier});
    app.get('/healthz',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({service:'research-api',
      read:composition.status.read?'ready':'disabled',editor:composition.status.editor?'ready':'disabled'});});
    app.use('/v1/research',composition.router);
    app.use((_req,res)=>{res.setHeader('Cache-Control','no-store');res.status(404).json({error:{code:'RESEARCH_ROUTE_NOT_FOUND'}});});
    return {app,status:composition.status,shutdown};
  }catch{try{await shutdown();}catch{}throw unavailable();}
}
