import { randomUUID } from 'node:crypto';
import { Router, json, type Request, type Response } from 'express';
import { z } from 'zod';
import type { MapSession, MapSessionVerifier } from '../../market-intel/map/auth.ts';
import { resolveManualMapAccess, type ManualMapAuthority } from '../../market-intel/map/memberAccess.ts';
import { PILOT_GEOGRAPHIES } from '../../market-intel/map/pilot.ts';
import { MapViewStore } from '../../market-intel/map/views.ts';
import type { PostgresPrivateCatalogReader } from '../../market-intel/map/store/catalogReader.ts';
import type { PostgresManualMapStore } from '../../market-intel/map/store/manualApproval.ts';

export interface PilotRouteDeps { enabled?: () => boolean; adminEnabled?: () => boolean;
  adminOrigin?: string; verifier: MapSessionVerifier | null; authority: ManualMapAuthority | null;
  catalog: Pick<PostgresPrivateCatalogReader,'readManifest'|'readLayer'> | null;
  administrator: Pick<PostgresManualMapStore,'authorize'|'inspect'|'change'> | null;
  views: MapViewStore; now?: () => number; }
const manifestQuery = z.object({geographyId:z.enum(['CA-CMA-535','CA-CMA-933','US-STATE-04','US-STATE-48'])}).strict();
const layerQuery = z.object({viewId:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  pageSize:z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(n=>n<=250).optional()}).strict();
const changeBody = z.object({subject:z.string().min(1).max(256), action:z.enum(['approve','revoke']),
  expectedRevision:z.number().int().nonnegative().max(2147483646), requestId:z.string().uuid(),
  reason:z.string().trim().min(1).max(500),expiresAt:z.number().finite().positive().optional()}).strict();
const targetQuery = z.object({subject:z.string().min(1).max(256)}).strict();

/** Independent factory only. No startup imports, implicit enabling, credentials or administrator bootstrap. */
export function createMapPilotRouter(deps: PilotRouteDeps): Router {
  const router=Router(); const now=deps.now??(()=>Date.now()/1000);
  const fail=(res:Response,status:number,code:string)=>res.status(status).json({error:{code,requestId:res.locals.requestId}});
  router.use((req,res,next)=>{res.locals.requestId=randomUUID();res.setHeader('Cache-Control','no-store');next();});
  async function session(req:Request,res:Response,admin=false):Promise<MapSession|null>{
    try{
      if(!(admin?deps.adminEnabled?.():deps.enabled?.())||!deps.verifier){fail(res,503,'MAP_UNAVAILABLE');return null;}
      const auth=await deps.verifier.verify(req.headers.authorization);
      if(!auth.ok){fail(res,auth.status,auth.code);return null;}return auth.session;
    }catch{fail(res,503,'MAP_UNAVAILABLE');return null;}
  }
  async function member(req:Request,res:Response){
    const actor=await session(req,res);if(!actor)return null;
    const access=await resolveManualMapAccess(actor,deps.authority,now());
    if(!access.ok){fail(res,access.status,access.code);return null;}return {actor,grant:access.grant};
  }
  router.get('/market-intel/map/views',async(req,res)=>{
    const access=await member(req,res);if(!access)return;
    const q=manifestQuery.safeParse(req.query);if(!q.success){fail(res,400,'INVALID_SELECTION');return;}
    if(!deps.catalog){fail(res,503,'MAP_CATALOG_UNAVAILABLE');return;}
    try{
      const result=await deps.catalog.readManifest(access.actor,q.data.geographyId);
      if(!result.ok){fail(res,result.status,result.code);return;}
      const m=result.manifest;
      if(m.geographyId!==q.data.geographyId||m.grantId!==access.grant.grantId){fail(res,409,'ACCESS_CHANGED');return;}
      const layers=Object.fromEntries(m.layers.filter(l=>l.pin).map(l=>[l.layerId,l.pin!]));
      const viewId=deps.views.create({issuer:access.actor.issuer,subject:access.actor.subject,grantId:m.grantId,
        geographyId:m.geographyId,expiresAt:m.expiresAt,layers});
      const geo=PILOT_GEOGRAPHIES[m.geographyId];
      res.json({contractVersion:'map-manifest-review-2',requestId:res.locals.requestId,viewId,
        geography:{id:m.geographyId,name:geo.name,level:geo.level},comparisonMode:'context_only',
        layers:m.layers.map(l=>({layerId:l.layerId,label:l.label,unitHint:l.unit,availability:l.availability,
          reason:l.reason,asOf:l.asOf,release:l.pin?{releaseId:l.pin.releaseId,generation:l.pin.generation,
            boundaryVersion:l.pin.boundaryVersion,boundaryHash:l.pin.boundaryHash}:null}))});
    }catch{fail(res,503,'MAP_CATALOG_UNAVAILABLE');}
  });
  router.get('/market-intel/map/layers/:layerId',async(req,res)=>{
    const access=await member(req,res);if(!access)return;
    const q=layerQuery.safeParse(req.query);if(!q.success||typeof req.params.layerId!=='string' ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(req.params.layerId)){fail(res,400,'INVALID_SELECTION');return;}
    const view=deps.views.get(q.data.viewId,access.actor,access.grant.grantId);
    if(!view){fail(res,409,'VIEW_EXPIRED');return;}
    const pin=Object.prototype.hasOwnProperty.call(view.layers,req.params.layerId)?view.layers[req.params.layerId]:null;
    if(!pin){fail(res,503,'LAYER_UNAVAILABLE');return;}
    if(!deps.catalog){fail(res,503,'MAP_CATALOG_UNAVAILABLE');return;}
    try{
      const result=await deps.catalog.readLayer(access.actor,{layerId:req.params.layerId,geographyId:view.geographyId,
        pinnedReleaseId:pin.releaseId,pinnedGeneration:pin.generation,pinnedRightsRevision:pin.rightsRevision,
        pinnedBoundaryVersion:pin.boundaryVersion,pinnedBoundaryHash:pin.boundaryHash});
      if(!result.ok){fail(res,result.status,result.code);return;}
      const l=result.layer;
      if(l.releaseId!==pin.releaseId||l.generation!==pin.generation||l.boundaryHash!==pin.boundaryHash||
        l.boundaryVersion!==pin.boundaryVersion||l.layerId!==req.params.layerId||l.geographyId!==view.geographyId){
        fail(res,409,'RELEASE_CHANGED');return;}
      const current=await resolveManualMapAccess(access.actor,deps.authority,now());
      if(!current.ok){fail(res,current.status,current.code);return;}
      if(current.grant.grantId!==view.grantId){fail(res,409,'ACCESS_CHANGED');return;}
      const geo=PILOT_GEOGRAPHIES[view.geographyId];
      res.json({contractVersion:'map-layer-review-2',requestId:res.locals.requestId,viewId:q.data.viewId,
        layerId:l.layerId,asOf:l.asOf,release:{releaseId:l.releaseId,generation:l.generation},
        coverage:{status:l.state,matchedFeatureCount:1,returnedFeatureCount:1,
          missingFeatureCount:l.state==='no_data'?1:0,nextCursor:null,viewportClipped:false},
        features:[{featureId:geo.featureId,geography:{id:view.geographyId,name:geo.name,level:geo.level,
          boundaryVersion:l.boundaryVersion,boundaryHash:l.boundaryHash,crosswalkRef:l.crosswalkRef},
          observations:l.observations}],source:l.source,notices:l.notices,comparisonMode:l.comparisonMode,error:null});
    }catch{fail(res,503,'MAP_CATALOG_UNAVAILABLE');}
  });
  router.use('/market-intel/map/admin',async(req,res,next)=>{
    const actor=await session(req,res,true);if(!actor)return;
    if(!deps.administrator){fail(res,503,'MAP_STORE_UNAVAILABLE');return;}
    try{const auth=await deps.administrator.authorize(actor);
      if(!auth.ok){fail(res,auth.status,auth.code);return;}res.locals.actor=actor;next();
    }catch{fail(res,503,'MAP_STORE_UNAVAILABLE');}
  });
  router.get('/market-intel/map/admin/member',async(req,res)=>{
    const q=targetQuery.safeParse(req.query);if(!q.success){fail(res,400,'INVALID_APPROVAL');return;}
    try{const r=await deps.administrator!.inspect(res.locals.actor,q.data.subject);
      if(!r.ok){fail(res,r.status,r.code);return;}
      res.json({contractVersion:'map-approval-review-1',requestId:res.locals.requestId,member:r.inspection});
    }catch{fail(res,503,'MAP_STORE_UNAVAILABLE');}
  });
  router.post('/market-intel/map/admin/changes',(req,res,next)=>{
    if(!deps.adminOrigin||req.headers.origin!==deps.adminOrigin){fail(res,403,'ORIGIN_DENIED');return;}
    if(!req.is('application/json')){fail(res,415,'JSON_REQUIRED');return;}
    next();
  },json({limit:'8kb',strict:true,inflate:false}),async(req,res)=>{
    const body=changeBody.safeParse(req.body);
    if(!body.success||Object.keys(req.query).length){fail(res,400,'INVALID_APPROVAL');return;}
    try{const actor:MapSession=res.locals.actor;
      const result=await deps.administrator!.change(actor,{...body.data,issuer:actor.issuer});
      if(!result.ok){fail(res,result.status,result.code);return;}
      res.json({contractVersion:'map-approval-review-1',requestId:res.locals.requestId,revision:result.revision,
        reconciliation:'reload_member_and_audit'});
    }catch{fail(res,503,'MAP_STORE_UNAVAILABLE');}
  });
  router.use((error:unknown,req:Request,res:Response,next:(err?:unknown)=>void)=>{
    const status=(error as {status?:number})?.status;
    fail(res,status===413?413:status===415?415:status===400?400:503,
      status===413?'BODY_TOO_LARGE':status===400||status===415?'INVALID_APPROVAL':'MAP_UNAVAILABLE');
  });
  return router;
}
