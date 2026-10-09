import type { MapSession } from './auth.ts';

export interface ManualMapGrant {
  readonly grantId: string; readonly issuer: string; readonly subject: string;
  readonly approvalMethod: 'manual'; readonly approvedAt: number; readonly approvedBy: string;
  readonly active: boolean; readonly revoked: boolean; readonly expiresAt: number;
  readonly capabilities: readonly string[];
}
/** Server-controlled authority. No implementation or real assignments are supplied. */
export interface ManualMapAuthority { resolve(session: MapSession): Promise<ManualMapGrant | null>; }
export type MemberAccessResult = { readonly ok: true; readonly grant: ManualMapGrant } |
  { readonly ok: false; readonly status: 401 | 403 | 503;
    readonly code: 'AUTHENTICATION_REQUIRED' | 'ACCESS_DENIED' | 'MAP_UNAVAILABLE' };

export async function resolveManualMapAccess(session: MapSession, authority: ManualMapAuthority | null,
  now = Date.now() / 1000): Promise<MemberAccessResult> {
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now)
    return { ok: false, status: 401, code: 'AUTHENTICATION_REQUIRED' };
  if (!authority) return { ok: false, status: 503, code: 'MAP_UNAVAILABLE' };
  let grant: ManualMapGrant | null;
  try { grant = await authority.resolve(session); }
  catch { return { ok: false, status: 503, code: 'MAP_UNAVAILABLE' }; }
  if (!grant || grant.issuer !== session.issuer || grant.subject !== session.subject ||
      grant.approvalMethod !== 'manual' || !grant.grantId || !grant.approvedBy ||
      !Number.isFinite(grant.approvedAt) || grant.approvedAt > now || grant.approvedAt < 0 ||
      grant.active !== true || grant.revoked !== false || !Number.isFinite(grant.expiresAt) ||
      grant.expiresAt <= now || !Array.isArray(grant.capabilities) || !grant.capabilities.includes('map_read'))
    return { ok: false, status: 403, code: 'ACCESS_DENIED' };
  return { ok: true, grant };
}
