import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface MapSession { readonly issuer: string; readonly subject: string; readonly expiresAt: number; }
export type MapAuthResult = { readonly ok: true; readonly session: MapSession } |
  { readonly ok: false; readonly status: 401 | 503; readonly code: 'AUTHENTICATION_REQUIRED' | 'MAP_UNAVAILABLE' };
export interface MapSessionVerifier { verify(authorization: string | undefined): Promise<MapAuthResult>; }
export interface MapAuthConfig { readonly issuer: string; readonly audience: string; }
const denied = (): MapAuthResult => ({ ok: false, status: 401, code: 'AUTHENTICATION_REQUIRED' });
const unavailable = (): MapAuthResult => ({ ok: false, status: 503, code: 'MAP_UNAVAILABLE' });

/** Unmounted map-only verifier. No environment reads, shared-secret or dev fallback. */
export function createMapSessionVerifier(config: MapAuthConfig | null,
  options: { keyResolver?: JWTVerifyGetKey; now?: () => number } = {}): MapSessionVerifier {
  const now = options.now ?? (() => Date.now() / 1000);
  let key: JWTVerifyGetKey | undefined;
  let valid = false;
  try {
    if (config && /^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/.test(config.issuer) &&
        config.audience === 'authenticated') {
      key = options.keyResolver ?? createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`));
      valid = true;
    }
  } catch { valid = false; }
  return { async verify(authorization) {
    if (!valid || !key || !config) return unavailable();
    if (!authorization || authorization.length > 16384 || !/^Bearer +[^\s]+$/i.test(authorization)) return denied();
    try {
      const { payload } = await jwtVerify(authorization.replace(/^Bearer +/i, ''), key, {
        issuer: config.issuer, audience: config.audience, algorithms: ['ES256', 'RS256'],
        requiredClaims: ['iss', 'aud', 'sub', 'exp'], currentDate: new Date(now() * 1000), clockTolerance: 0,
      });
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 ||
          !Number.isFinite(payload.exp) || payload.exp! <= now() || payload.role !== 'authenticated' ||
          payload.is_anonymous !== false) return denied();
      return { ok: true, session: { issuer: config.issuer, subject: payload.sub, expiresAt: payload.exp! } };
    } catch (error) {
      // Verification failures are opaque; key-provider outages are service failures.
      if (error instanceof errors.JOSEError && error.code !== 'ERR_JWKS_TIMEOUT') return denied();
      return unavailable();
    }
  } };
}
