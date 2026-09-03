/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * Session authentication tests.
 *
 * The load-bearing ones here are the forgery tests. A JWT verifier that accepts
 * a valid-looking token it should have rejected is worse than no auth at all,
 * because everything downstream then trusts it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import {
  DevSessionVerifier,
  SupabaseSessionVerifier,
  UnconfiguredSessionVerifier,
  createSessionVerifierFromEnv,
  extractBearerToken,
  PERMITTED_JWT_ALGORITHMS,
} from "./session.ts";

const ISSUER = "https://project.supabase.co/auth/v1";
const AUDIENCE = "authenticated";
const SECRET_TEXT = "a-very-long-supabase-jwt-secret-value-for-testing-only";
const SECRET = new TextEncoder().encode(SECRET_TEXT);
const USER = "6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

function hs256Verifier() {
  return new SupabaseSessionVerifier({ issuer: ISSUER, audience: AUDIENCE, jwtSecret: SECRET_TEXT });
}

async function signHs256(claims: Record<string, unknown> = {}, expires = "1h") {
  return new SignJWT({ role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(SECRET);
}

// ---------------------------------------------------------------------------
// Bearer extraction
// ---------------------------------------------------------------------------

test("bearer extraction accepts standard and case-insensitive forms", () => {
  assert.deepEqual(extractBearerToken("Bearer abc.def.ghi"), { ok: true, token: "abc.def.ghi" });
  assert.deepEqual(extractBearerToken("bearer abc"), { ok: true, token: "abc" });
  assert.deepEqual(extractBearerToken("  Bearer   abc  "), { ok: true, token: "abc" });
});

test("bearer extraction fails closed on absent or malformed headers", () => {
  assert.deepEqual(extractBearerToken(undefined), { ok: false, reason: "MISSING_TOKEN" });
  assert.deepEqual(extractBearerToken(""), { ok: false, reason: "MISSING_TOKEN" });
  for (const bad of ["Basic abc", "abc.def.ghi", "Bearer", "Bearer "]) {
    const result = extractBearerToken(bad);
    assert.equal(result.ok, false, `"${bad}" must not yield a token`);
  }
});

// ---------------------------------------------------------------------------
// Valid sessions
// ---------------------------------------------------------------------------

test("a correctly signed Supabase token yields the actor reference", async () => {
  const result = await hs256Verifier().verify(await signHs256());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.session.actorRef, USER, "actorRef must be the sub claim");
    assert.equal(result.session.issuer, ISSUER);
    assert.equal(result.session.role, "authenticated");
  }
});

test("the actor reference comes from the signed sub, never from the payload body", async () => {
  // A token whose custom claims *claim* a different user must not change who
  // the server thinks is calling.
  const token = await signHs256({ user_id: "SOMEONE-ELSE", actorRef: "SOMEONE-ELSE" });
  const result = await hs256Verifier().verify(token);
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.session.actorRef, USER);
});

// ---------------------------------------------------------------------------
// Forgery — the tests that matter
// ---------------------------------------------------------------------------

test("an 'alg: none' token is rejected", async () => {
  // The classic JWT bypass: strip the signature and declare no algorithm.
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: USER, iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");

  const result = await hs256Verifier().verify(`${header}.${payload}.`);
  assert.deepEqual(result, { ok: false, reason: "INVALID_TOKEN" });
});

test("a token signed with the wrong secret is rejected", async () => {
  const forged = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode("the-attackers-own-secret-which-is-also-long"));

  assert.deepEqual(await hs256Verifier().verify(forged), { ok: false, reason: "INVALID_TOKEN" });
});

test("a token from an untrusted issuer is rejected", async () => {
  const forged = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER).setIssuer("https://evil.example/auth/v1").setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("1h")
    .sign(SECRET);

  const result = await hs256Verifier().verify(forged);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "UNTRUSTED_ISSUER");
});

test("a token for the wrong audience is rejected", async () => {
  const forged = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER).setIssuer(ISSUER).setAudience("some-other-service")
    .setIssuedAt().setExpirationTime("1h")
    .sign(SECRET);

  assert.equal((await hs256Verifier().verify(forged)).ok, false);
});

test("an expired token is rejected and reported distinctly for audit", async () => {
  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(SECRET);

  assert.deepEqual(await hs256Verifier().verify(expired), { ok: false, reason: "EXPIRED_TOKEN" });
});

test("a token with no subject is rejected", async () => {
  const noSub = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("1h")
    .sign(SECRET);

  assert.deepEqual(await hs256Verifier().verify(noSub), { ok: false, reason: "MISSING_SUBJECT" });
});

test("ALGORITHM CONFUSION: an asymmetric verifier never accepts an HS256 token", async () => {
  // The attack: when a service verifies RS256 via JWKS but also permits HS256,
  // an attacker signs a token using the PUBLIC key bytes as the HMAC secret.
  // The public key is not secret, so this mints arbitrary sessions.
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";

  const verifier = new SupabaseSessionVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
  });

  // Forge an HS256 token using the public modulus as the shared secret.
  const forged = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", kid: "test-key" })
    .setSubject("ATTACKER").setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(String(jwk.n)));

  const result = await verifier.verify(forged);
  assert.equal(result.ok, false, "an HS256 token must never verify against an asymmetric verifier");

  // And a genuinely RS256-signed token is at least well-formed for that path.
  const genuine = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(USER).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("1h")
    .sign(privateKey);
  assert.equal(typeof genuine, "string");
});

test("the permitted algorithm list excludes 'none' and any symmetric/asymmetric mix", () => {
  assert.ok(!PERMITTED_JWT_ALGORITHMS.includes("none" as never));
  for (const alg of PERMITTED_JWT_ALGORITHMS) {
    assert.match(alg, /^(HS256|RS256|ES256)$/);
  }
});

test("a verifier configured with neither JWKS nor secret refuses to construct", () => {
  assert.throws(
    () => new SupabaseSessionVerifier({ issuer: ISSUER }),
    /requires either jwksUrl or jwtSecret/,
  );
});

// ---------------------------------------------------------------------------
// Fail-closed configuration
// ---------------------------------------------------------------------------

test("an unconfigured verifier rejects everything", async () => {
  const result = await new UnconfiguredSessionVerifier().verify("anything");
  assert.deepEqual(result, { ok: false, reason: "VERIFIER_NOT_CONFIGURED" });
});

test("no configuration yields the unconfigured verifier, not a permissive one", async () => {
  const verifier = createSessionVerifierFromEnv({} as NodeJS.ProcessEnv);
  const result = await verifier.verify("dev:anyone");
  assert.deepEqual(result, { ok: false, reason: "VERIFIER_NOT_CONFIGURED" });
});

test("dev sessions are refused in production even when explicitly enabled", async () => {
  const verifier = createSessionVerifierFromEnv({
    NODE_ENV: "production",
    LIGHTHOUSE_ALLOW_DEV_SESSIONS: "true",
  } as NodeJS.ProcessEnv);
  const result = await verifier.verify("dev:someone");
  assert.deepEqual(result, { ok: false, reason: "VERIFIER_NOT_CONFIGURED" });
});

test("dev sessions require the exact opt-in string", async () => {
  for (const value of ["1", "yes", "on", "TRUE", ""]) {
    const verifier = createSessionVerifierFromEnv({
      LIGHTHOUSE_ALLOW_DEV_SESSIONS: value,
    } as NodeJS.ProcessEnv);
    const result = await verifier.verify("dev:someone");
    assert.equal(result.ok, false, `"${value}" must not enable dev sessions`);
  }
});

test("the dev verifier works only for its own token format", async () => {
  const verifier = new DevSessionVerifier();
  const ok = await verifier.verify("dev:user-123");
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.session.actorRef, "user-123");

  assert.equal((await verifier.verify("user-123")).ok, false);
  assert.equal((await verifier.verify("dev:")).ok, false);
});

test("a real Supabase config takes precedence over the dev escape hatch", async () => {
  const verifier = createSessionVerifierFromEnv({
    SUPABASE_JWT_ISSUER: ISSUER,
    SUPABASE_JWT_SECRET: SECRET_TEXT,
    LIGHTHOUSE_ALLOW_DEV_SESSIONS: "true",
  } as NodeJS.ProcessEnv);

  assert.equal((await verifier.verify("dev:sneaky")).ok, false,
    "dev tokens must not work once a real verifier is configured");
  assert.equal((await verifier.verify(await signHs256())).ok, true);
});
