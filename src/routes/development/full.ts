import { Router } from "express";
import { requireSession } from "../../lighthouse/auth/middleware.ts";
import { SupabaseSessionVerifier, type SessionVerifier } from "../../lighthouse/auth/session.ts";
import { calculateFull, ENGINE_MANIFEST, verifyRuntimeArtifacts } from "../../development/engineManifest.ts";
import { encode } from "../../development/transport.ts";

export const FULL_ROUTE_FLAG = "INVESTSCAPE_FF_NATIVE_FULL";
export interface FullRouteDeps {
  enabled: () => boolean;
  verifier: SessionVerifier | null;
  artifactsVerified: boolean;
  calculate: (request: unknown) => Record<string, unknown>;
}
function transportRequest(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !["contractVersion", "mode", "inputRevision", "inputs"].includes(k))) return false;
  if (r.contractVersion !== "full-adapter-1" || r.mode !== "full" || !Number.isSafeInteger(r.inputRevision) || (r.inputRevision as number) < 0) return false;
  if (r.inputs === null || typeof r.inputs !== "object" || Array.isArray(r.inputs)) return false;
  const inputs = r.inputs as Record<string, unknown>;
  if (Object.keys(inputs).length > 64) return false;
  return Object.entries(inputs).every(([k, v]) => k.length <= 80 && !["__proto__", "constructor", "prototype"].includes(k)
    && (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 256)));
}

export function createFullRouter(deps: FullRouteDeps): Router {
  const router = Router();
  router.post("/development/full/calculate", (req, res, next) => {
    // Independent gate: never change older engine/Lighthouse rollout posture.
    if (!deps.enabled() || !deps.verifier || !deps.artifactsVerified) { res.status(503).json({ error: { message: "Full calculation unavailable" } }); return; }
    return requireSession(deps.verifier)(req, res, next);
  }, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // JWT verification does not itself require an exp claim. This endpoint does.
    if (!req.lighthouseSession || !Number.isFinite(req.lighthouseSession.expiresAt) || req.lighthouseSession.expiresAt <= Date.now() / 1000) {
      res.status(401).json({ error: { message: "Authentication required" } }); return;
    }
    if (!transportRequest(req.body)) { res.status(400).json({ error: { message: "Invalid Full transport request" } }); return; }
    try {
      const result = deps.calculate(req.body);
      const encodedResult = encode(result);
      res.json({ transportVersion: "full-api-transport-1", encodedResult, deploymentIdentity: ENGINE_MANIFEST });
    } catch {
      // Never expose engine exceptions, financial inputs or unencodable raw output.
      res.status(500).json({ error: { message: "Full calculation could not be delivered" } });
    }
  });
  return router;
}
export function fullRouterFromEnv(env: NodeJS.ProcessEnv = process.env): Router {
  let verifier: SessionVerifier | null = null;
  // Asymmetric verifier only. Dev tokens/shared-secret fallback are not used here.
  if (env.SUPABASE_JWT_ISSUER && env.SUPABASE_JWKS_URL) {
    try { verifier = new SupabaseSessionVerifier({ issuer: env.SUPABASE_JWT_ISSUER, jwksUrl: env.SUPABASE_JWKS_URL, audience: env.SUPABASE_JWT_AUDIENCE ?? "authenticated" }); } catch { verifier = null; }
  }
  return createFullRouter({ enabled: () => env[FULL_ROUTE_FLAG] === "true", verifier, artifactsVerified: verifyRuntimeArtifacts(), calculate: calculateFull });
}
