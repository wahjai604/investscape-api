import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { MapSession, MapSessionVerifier } from '../../market-intel/map/auth.ts';
import { resolveManualMapAccess, type ManualMapAuthority } from '../../market-intel/map/memberAccess.ts';

export interface MapManifestQuery { readonly geographyId: string; readonly geographyLevel: 'metro' | 'province_state'; }
export interface MapManifestResult {
  readonly contractVersion: 'map-manifest-review-1'; readonly geographyId: string;
  readonly state: 'unavailable'; readonly reason: 'CATALOG_NOT_CONFIGURED';
}
export interface MapManifestReader { read(query: MapManifestQuery): Promise<MapManifestResult>; }
export interface MapRouteDeps { enabled?: () => boolean; verifier: MapSessionVerifier | null;
  authority: ManualMapAuthority | null; reader: MapManifestReader | null; now?: () => number; }
const levels: Record<string, MapManifestQuery['geographyLevel']> = {
  'CA-CMA-535': 'metro', 'CA-CMA-933': 'metro', 'US-STATE-04': 'province_state', 'US-STATE-48': 'province_state',
};
function parseSelection(query: Record<string, unknown>): MapManifestQuery | null {
  if (Object.keys(query).some(k=>!['geographyId', 'geographyLevel'].includes(k))) return null;
  if (typeof query.geographyId !== 'string' || typeof query.geographyLevel !== 'string' ||
      !Object.prototype.hasOwnProperty.call(levels, query.geographyId) ||
      levels[query.geographyId] !== query.geographyLevel) return null;
  return { geographyId: query.geographyId, geographyLevel: levels[query.geographyId]! };
}

/** Factory only: not imported by startup or existing router; default is disabled. */
export function createMapRouter(deps: MapRouteDeps): Router {
  const router = Router(); const now = deps.now ?? (()=>Date.now()/1000);
  router.get('/market-intel/map/views', async (req, res) => {
    const requestId = randomUUID(); res.setHeader('Cache-Control', 'no-store');
    const fail = (status: number, code: string) => { res.status(status).json({ error: { code, requestId } }); };
    if (!deps.enabled?.() || !deps.verifier) { fail(503, 'MAP_UNAVAILABLE'); return; }
    let auth;
    try { auth = await deps.verifier.verify(req.headers.authorization); }
    catch { fail(503, 'MAP_UNAVAILABLE'); return; }
    if (!auth.ok) { fail(auth.status, auth.code); return; }
    const session: MapSession = auth.session;
    const access = await resolveManualMapAccess(session, deps.authority, now());
    if (!access.ok) { fail(access.status, access.code); return; }
    const selection = parseSelection(req.query);
    if (!selection) { fail(400, 'INVALID_SELECTION'); return; }
    if (!deps.reader) { fail(503, 'MAP_CATALOG_UNAVAILABLE'); return; }
    let manifest;
    try { manifest = await deps.reader.read(selection); }
    catch { fail(503, 'MAP_CATALOG_UNAVAILABLE'); return; }
    // Fresh manual authority check after work; never return a revoked grant's result.
    const current = await resolveManualMapAccess(session, deps.authority, now());
    if (!current.ok) { fail(current.status, current.code); return; }
    if (current.grant.grantId !== access.grant.grantId) { fail(409, 'ACCESS_CHANGED'); return; }
    // This slice intentionally admits only an unavailable manifest placeholder.
    if (!manifest || typeof manifest !== 'object' ||
        manifest.contractVersion !== 'map-manifest-review-1' || manifest.geographyId !== selection.geographyId ||
        manifest.state !== 'unavailable' || manifest.reason !== 'CATALOG_NOT_CONFIGURED') {
      fail(503, 'MAP_CATALOG_UNAVAILABLE'); return;
    }
    res.json({ contractVersion: manifest.contractVersion, requestId, geographyId: selection.geographyId,
      geographyLevel: selection.geographyLevel, state: manifest.state, reason: manifest.reason });
  });
  return router;
}
