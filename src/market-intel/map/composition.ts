import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import cors from 'cors';
import type { Pool } from 'pg';
import { createMapSessionVerifier, type MapAuthConfig, type MapSessionVerifier } from './auth.ts';
import { PgMapDatabase, type MapDatabase } from './store/sql.ts';
import { PostgresManualMapStore } from './store/manualApproval.ts';
import { PostgresPrivateCatalogReader } from './store/catalogReader.ts';
import { MapViewStore } from './views.ts';
import { createMapPilotRouter } from '../../routes/market-intelligence/mapPilot.ts';

export interface MapCompositionConfig {
  readonly readEnabled: boolean; readonly adminEnabled: boolean;
  readonly auth: MapAuthConfig | null; readonly allowedOrigins: readonly string[];
  readonly adminOrigin: string | null;
}
export interface MapResources {
  readonly reader: MapDatabase; readonly accessWriter: MapDatabase;
  shutdown(): Promise<void>;
}
const httpsOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value ? value : null; }
  catch { return null; }
};
/** Reads only named non-secret map posture settings. Never reads a connection/credential binding. */
export function resolveMapCompositionConfig(env: NodeJS.ProcessEnv): MapCompositionConfig {
  try {
    const issuer = env.MI_MAP_AUTH_ISSUER, audience = env.MI_MAP_AUTH_AUDIENCE;
    const auth = typeof issuer === 'string' && /^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/.test(issuer) &&
      audience === 'authenticated' ? { issuer, audience } : null;
    const entries = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim());
    const allowedOrigins = entries.length <= 16 && entries.every(s => httpsOrigin(s)) ? [...new Set(entries)] : [];
    const adminOrigin = httpsOrigin(env.MI_MAP_ADMIN_ORIGIN);
    return { readEnabled: env.MI_MAP_READ_ENABLED === 'true', adminEnabled: env.MI_MAP_ADMIN_ENABLED === 'true',
      auth, allowedOrigins, adminOrigin };
  } catch { return {readEnabled:false,adminEnabled:false,auth:null,allowedOrigins:[],adminOrigin:null}; }
}
/** Already scoped pools supplied by a future reviewed host. No pool construction or environment discovery. */
export function createMapPoolResources(readerPool: Pool, writerPool: Pool): MapResources {
  if (!readerPool || !writerPool || readerPool === writerPool) throw new Error('MAP_RESOURCES_INVALID');
  let closing: Promise<void> | undefined;
  return { reader: new PgMapDatabase(readerPool), accessWriter: new PgMapDatabase(writerPool), shutdown() {
    closing ??= Promise.allSettled([Promise.resolve().then(() => readerPool.end()),
      Promise.resolve().then(() => writerPool.end())]).then(results => {
      if (results.some(r => r.status === 'rejected')) throw new Error('MAP_SHUTDOWN_FAILED');
    });
    return closing;
  } };
}
/** Mount at /v1 directly after Helmet, BEFORE global CORS/parser/engine guards. Terminal within map scope. */
export function createMapComposition(config: MapCompositionConfig,
  options: { resources?: MapResources | null; verifier?: MapSessionVerifier; now?: () => number;
    requestLimit?: number; adminRequestLimit?: number } = {}) {
  const router = Router(), now = options.now ?? (() => Date.now()/1000);
  const limit = options.requestLimit ?? 120, adminLimit = options.adminRequestLimit ?? 30;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000 || !Number.isSafeInteger(adminLimit) ||
      adminLimit < 1 || adminLimit > limit) throw new Error('MAP_BUDGET_INVALID');
  const origins = new Set(config.allowedOrigins);
  const configured = !!config.auth && origins.size > 0 && origins.size <= 16 && [...origins].every(httpsOrigin);
  const resources = options.resources;
  const resourcesValid = !!resources && resources.reader !== resources.accessWriter;
  const readReady = configured && resourcesValid && config.readEnabled === true;
  const adminReady = configured && resourcesValid && config.adminEnabled === true &&
    !!config.adminOrigin && origins.has(config.adminOrigin) && !!httpsOrigin(config.adminOrigin);
  const authority = resourcesValid ? new PostgresManualMapStore(resources.reader) : null;
  const administrator = resourcesValid ? new PostgresManualMapStore(resources.accessWriter) : null;
  const catalog = resourcesValid ? new PostgresPrivateCatalogReader(resources.reader) : null;
  const verifier = readReady || adminReady ? options.verifier ?? createMapSessionVerifier(config.auth) : null;
  let windowStart = now(), used = 0, adminUsed = 0;
  const fail = (res: import('express').Response, status: number, code: string) =>
    res.status(status).json({error:{code,requestId:res.locals.requestId}});
  router.use((req,res,next) => {
    if (!/^\/market-intel\/map(?:\/|$)/i.test(req.path)) {next('router');return;}
    res.locals.requestId = randomUUID();res.setHeader('Cache-Control','no-store');
    const admin = /^\/market-intel\/map\/admin(?:\/|$)/i.test(req.path);
    if (!(admin ? adminReady : readReady)) {fail(res,503,'MAP_UNAVAILABLE');return;}
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {fail(res,403,'ORIGIN_DENIED');return;}
    const time = now();
    if (time < windowStart || time >= windowStart+60) {windowStart=time;used=0;adminUsed=0;}
    // Bounded process-wide counters, no user/IP keys or trusted proxy assumptions. Includes preflights.
    if (++used > limit || (admin && ++adminUsed > adminLimit)) {
      res.setHeader('Retry-After',String(Math.max(1,Math.ceil(windowStart+60-time))));
      fail(res,429,'MAP_RATE_LIMITED');return;
    }
    next();
  });
  router.use(cors({origin:(origin,cb)=>cb(null,origin !== undefined && origins.has(origin)),
    methods:['GET','POST','OPTIONS'],allowedHeaders:['Authorization','Content-Type','Accept'],maxAge:0}));
  router.use(createMapPilotRouter({enabled:()=>readReady,adminEnabled:()=>adminReady,
    adminOrigin:config.adminOrigin??undefined,verifier,authority,administrator,catalog,views:new MapViewStore({now}),now}));
  router.use((_req,res)=>{fail(res,404,'MAP_ROUTE_NOT_FOUND');});
  let closing: Promise<void> | undefined;
  return {router, status:{read:readReady?'ready':'disabled_or_unconfigured',admin:adminReady?'ready':'disabled_or_unconfigured'},
    shutdown():Promise<void> {
      closing ??= Promise.resolve().then(()=>resources?.shutdown()).then(()=>undefined,
        ()=>{throw new Error('MAP_SHUTDOWN_FAILED');});return closing;
    }};
}
