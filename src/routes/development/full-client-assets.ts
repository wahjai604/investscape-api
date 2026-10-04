import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const FULL_CLIENT_ASSET_PATH = '/development/assets/full-client-1/investscape-full-client.full-client-1.target-0.10.0-p2-6b.js';
export const FULL_CLIENT_ASSET_SHA256 = '8abbad1340077073ab4b31f3a9a4e10ee7c7a8b6aa9ea55e52beec21540b4f26';
/** Public helper only. No credential, calculation or arbitrary directory serving. */
export function fullClientAssetsRouter(load = () => readFileSync(new URL('../../../public/development/full-client-1/investscape-full-client.full-client-1.target-0.10.0-p2-6b.js', import.meta.url))) {
 const router = Router();
 router.get(FULL_CLIENT_ASSET_PATH, (_req,res) => {
  let bytes: Buffer;
  try { bytes=load(); if(createHash('sha256').update(bytes).digest('hex')!==FULL_CLIENT_ASSET_SHA256)throw new Error('asset drift'); }
  catch { res.set('Cache-Control','no-store').status(503).json({error:{message:'Full client asset unavailable'}});return; }
  res.set({'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin','ETag':`"sha256-${FULL_CLIENT_ASSET_SHA256}"`}).send(bytes);
 });
 return router;
}
