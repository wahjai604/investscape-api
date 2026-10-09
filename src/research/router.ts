import { Router,json,type Request,type Response } from 'express';
import cors from 'cors';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createResearchVerifier,type ResearchAuthConfig,type ResearchSession,type ResearchVerifier} from './auth.ts';
import {editorialCommand,itemId,ResearchError} from './model.ts';
import type {ResearchEditor,ResearchReader} from './store.ts';

export interface ResearchAuthority {
  /** Fresh server-owned access on each request; never infer editorial permission from user-editable claims. */
  resolve(session:ResearchSession):Promise<{member:boolean;editor:boolean}>;
}
export interface ResearchRuntime {
  readEnabled:boolean;editorEnabled:boolean;auth:ResearchAuthConfig|null;origins:string[];editorOrigin:string|null;
}
export function defaultResearchRuntime():ResearchRuntime {
  return {readEnabled:false,editorEnabled:false,auth:null,origins:[],editorOrigin:null};
}
const origin=(s:string)=>{try{const u=new URL(s);return u.protocol==='https:'&&u.origin===s;}catch{return false;}};
const query=z.object({q:z.string().trim().max(120).optional(),geography:z.string().min(1).max(120).optional(),
  topic:z.string().min(1).max(120).optional(),offset:z.string().regex(/^(0|[1-9][0-9]{0,4})$/).optional(),
  limit:z.string().regex(/^[1-9][0-9]?$/).optional()}).strict();
/** Unmounted, terminal /v1/research composition. Existing API entrypoint remains unchanged. */
export function createResearchRouter(config:ResearchRuntime=defaultResearchRuntime(),options:{
  reader?:ResearchReader;editor?:ResearchEditor;authority?:ResearchAuthority;verifier?:ResearchVerifier;
  requestLimit?:number;now?:()=>number;
}={}){
  const router=Router(),origins=new Set(config.origins),now=options.now??(()=>Date.now()/1000);
  const valid=!!config.auth&&/^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/.test(config.auth.issuer)&&
    config.auth.audience==='authenticated'&&origins.size>0&&origins.size<=16&&[...origins].every(origin);
  const readReady=valid&&config.readEnabled===true&&!!options.reader&&!!options.authority;
  const editorReady=valid&&config.editorEnabled===true&&!!options.editor&&!!options.authority&&
    !!config.editorOrigin&&origins.has(config.editorOrigin);
  const verifier=readReady||editorReady?options.verifier??createResearchVerifier(config.auth!):null;
  const budget=options.requestLimit??120;
  if(!Number.isSafeInteger(budget)||budget<1||budget>10000)throw Error('RESEARCH_BUDGET_INVALID');
  let started=now(),used=0;
  const fail=(res:Response,status:number,code:string)=>res.status(status).json({error:{code,requestId:res.locals.requestId}});
  router.use(async(req,res,next)=>{
    res.locals.requestId=randomUUID();res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');
    const admin=/^\/admin(?:\/|$)/i.test(req.path);
    if(!(admin?editorReady:readReady)){fail(res,503,'RESEARCH_UNAVAILABLE');return;}
    if(req.headers.origin!==undefined&&!origins.has(req.headers.origin)){fail(res,403,'ORIGIN_DENIED');return;}
    if(admin&&req.headers.origin!==config.editorOrigin){fail(res,403,'ORIGIN_DENIED');return;}
    const time=now();if(time<started||time>=started+60){started=time;used=0;}
    if(++used>budget){res.setHeader('Retry-After','60');fail(res,429,'RESEARCH_RATE_LIMITED');return;}
    if(req.method==='OPTIONS'){next();return;}
    try{
      const session=await verifier!.verify(req.headers.authorization);
      if(!session||session.issuer!==config.auth!.issuer||session.expiresAt<=now()){
        fail(res,401,'AUTHENTICATION_REQUIRED');return;}
      const access=await options.authority!.resolve(session);
      if(session.expiresAt<=now()){fail(res,401,'AUTHENTICATION_REQUIRED');return;}
      if(!access||access.member!==true||(admin&&access.editor!==true)){fail(res,403,'ACCESS_DENIED');return;}
      res.locals.researchSession=session;next();
    }catch{fail(res,503,'RESEARCH_UNAVAILABLE');}
  });
  router.use(cors({origin:(o,cb)=>cb(null,o!==undefined&&origins.has(o)),methods:['GET','POST','OPTIONS'],
    allowedHeaders:['Authorization','Content-Type','Accept'],maxAge:0}));
  const execute=(work:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response)=>{
    try{await work(req,res);}catch(error){
      const code=error instanceof ResearchError?error.code:'RESEARCH_UNAVAILABLE';
      fail(res,code==='INVALID_RESEARCH_INPUT'?400:code==='RESEARCH_UNAVAILABLE'?503:409,code);
    }
  };
  router.get('/items',execute(async(req,res)=>{
    const parsed=query.safeParse(req.query);if(!parsed.success)throw new ResearchError('INVALID_RESEARCH_INPUT');
    const q=parsed.data;
    if((q.limit&&Number(q.limit)>50)||(q.offset&&Number(q.offset)>10000))throw new ResearchError('INVALID_RESEARCH_INPUT');
    res.json(await options.reader!.list({...q,limit:q.limit?Number(q.limit):undefined,offset:q.offset?Number(q.offset):undefined}));
  }));
  router.get('/items/:id',execute(async(req,res)=>{
    if(Object.keys(req.query).length||!itemId.safeParse(req.params.id).success)throw new ResearchError('INVALID_RESEARCH_INPUT');
    const result=await options.reader!.detail(req.params.id as string,'member');
    if(!result.item){fail(res,404,'RESEARCH_ITEM_UNAVAILABLE');return;}res.json(result);
  }));
  router.use('/admin',json({limit:'16kb',inflate:false,strict:true}));
  router.get('/admin/items/:id',execute(async(req,res)=>{
    if(Object.keys(req.query).length||!itemId.safeParse(req.params.id).success)throw new ResearchError('INVALID_RESEARCH_INPUT');
    const inspection=await options.editor!.inspect(req.params.id as string);
    if(!inspection){fail(res,404,'RESEARCH_ITEM_UNAVAILABLE');return;}res.json({inspection});
  }));
  router.post('/admin/changes',execute(async(req,res)=>{
    if(Object.keys(req.query).length)throw new ResearchError('INVALID_RESEARCH_INPUT');
    const parsed=editorialCommand.safeParse(req.body);if(!parsed.success)throw new ResearchError('INVALID_RESEARCH_INPUT');
    res.json(await options.editor!.change(res.locals.researchSession.subject,parsed.data));
  }));
  router.use((_req,res)=>{fail(res,404,'RESEARCH_ROUTE_NOT_FOUND');});
  router.use((error:unknown,_req:Request,res:Response,_next:unknown)=>{
    const status=(error as {status?:number})?.status;
    fail(res,status===413?413:status===415?415:400,'INVALID_RESEARCH_INPUT');
  });
  return {router,status:{read:!!readReady,editor:!!editorReady}};
}
