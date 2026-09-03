/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * HMAC service authentication for Relationship OS ↔ InvestScape server-to-server
 * calls. Both directions: `signRequest` for outbound (InvestScape → Relationship
 * OS), `verifyRequest` for inbound (Relationship OS → InvestScape).
 *
 * ---------------------------------------------------------------------------
 * CANONICALIZATION — reproduced from the Relationship OS IMPLEMENTATION, not
 * from its prose documentation. The two disagree, and the implementation wins.
 *
 *   Source of truth: relationship-os `packages/service-auth/hmacServiceAuth.ts`
 *                    on branch `origin/feature/investscape-launch-v0.1`
 *
 *   base      = METHOD \n path \n timestamp \n nonce \n sha256(rawBody).hex
 *   signature = HMAC-SHA256(secret, base).hex        (lowercase hex, 64 chars)
 *
 *   Headers (NOTE the `x-lighthouse-` prefix):
 *     x-lighthouse-service     logical service name, compared to an expected value
 *     x-lighthouse-key-id      selects the shared secret
 *     x-lighthouse-timestamp   integer Unix SECONDS
 *     x-lighthouse-nonce       lowercase hex, >= 32 chars
 *     x-lighthouse-signature   lowercase hex, exactly 64 chars
 *
 *   Clock skew tolerance: +/- 300 seconds.
 *   Replay protection:    the nonce must be stored and unique (see nonceStore).
 *
 * ⚠️ CONTRACT DEFECT TO RAISE WITH RELATIONSHIP OS
 * `docs/architecture/INVESTSCAPE_LAUNCH_GATEWAY_V0.1.md` documents these headers
 * as `X-Service-Key-Id`, `X-Service-Timestamp`, `X-Service-Nonce` and
 * `X-Service-Signature`. No such header is read anywhere in the Relationship OS
 * implementation. An implementer following the document produces a request that
 * fails authentication with no diagnostic. We follow the code; the document
 * needs correcting. Until Relationship OS confirms, `SERVICE_HEADER_PREFIX`
 * below is the single place to change if the decision goes the other way.
 * ---------------------------------------------------------------------------
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Change here if Relationship OS standardises on `x-service-` instead. */
export const SERVICE_HEADER_PREFIX = "x-lighthouse-";

export const SERVICE_HEADERS = {
  service: `${SERVICE_HEADER_PREFIX}service`,
  keyId: `${SERVICE_HEADER_PREFIX}key-id`,
  timestamp: `${SERVICE_HEADER_PREFIX}timestamp`,
  nonce: `${SERVICE_HEADER_PREFIX}nonce`,
  signature: `${SERVICE_HEADER_PREFIX}signature`,
} as const;

export const DEFAULT_MAX_SKEW_SECONDS = 300;

const NONCE_PATTERN = /^[0-9a-f]{32,}$/i;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

export interface CanonicalRequest {
  readonly method: string;
  /** Path only — no query string, no origin. Must match what the peer signs. */
  readonly path: string;
  readonly timestamp: string;
  readonly nonce: string;
  /** Exact bytes sent on the wire. Re-serialising JSON breaks the signature. */
  readonly rawBody: string;
}

/** Builds the canonical string that gets signed. Shared by sign and verify. */
export function canonicalString(request: CanonicalRequest): string {
  const bodyHash = createHash("sha256").update(request.rawBody ?? "").digest("hex");
  return [
    request.method.toUpperCase(),
    request.path,
    request.timestamp,
    request.nonce,
    bodyHash,
  ].join("\n");
}

/** 32 bytes -> 64 lowercase hex chars, comfortably above the 32-char minimum. */
export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

export interface SignOptions {
  readonly serviceName: string;
  readonly keyId: string;
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly rawBody: string;
  readonly now?: () => number;
  readonly nonce?: string;
}

export type SignedHeaders = Record<string, string>;

/**
 * Produces the five service headers for an outbound request.
 *
 * The secret is used and discarded. It is never returned, logged, or attached
 * to the result.
 */
export function signRequest(options: SignOptions): SignedHeaders {
  const timestamp = String(
    options.now ? options.now() : Math.floor(Date.now() / 1000),
  );
  const nonce = options.nonce ?? generateNonce();

  const signature = createHmac("sha256", options.secret)
    .update(
      canonicalString({
        method: options.method,
        path: options.path,
        timestamp,
        nonce,
        rawBody: options.rawBody,
      }),
    )
    .digest("hex");

  return {
    [SERVICE_HEADERS.service]: options.serviceName,
    [SERVICE_HEADERS.keyId]: options.keyId,
    [SERVICE_HEADERS.timestamp]: timestamp,
    [SERVICE_HEADERS.nonce]: nonce,
    [SERVICE_HEADERS.signature]: signature,
  };
}

export type VerifyFailureReason =
  | "MISSING_HEADERS"
  | "SERVICE_MISMATCH"
  | "UNKNOWN_KEY_ID"
  | "MALFORMED_TIMESTAMP"
  | "TIMESTAMP_OUT_OF_RANGE"
  | "MALFORMED_NONCE"
  | "MALFORMED_SIGNATURE"
  | "SIGNATURE_MISMATCH";

export type VerifyResult =
  | { readonly ok: true; readonly keyId: string; readonly nonce: string; readonly timestamp: number }
  | { readonly ok: false; readonly reason: VerifyFailureReason };

export interface VerifyOptions {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly method: string;
  readonly path: string;
  readonly rawBody: string;
  readonly expectedService: string;
  /** keyId -> shared secret. Loaded from server secret storage, never from a request. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly maxSkewSeconds?: number;
  readonly now?: () => number;
}

function headerValue(
  headers: VerifyOptions["headers"],
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.length === 1 ? raw[0] : undefined;
  return typeof raw === "string" ? raw : undefined;
}

/**
 * Verifies an inbound signed request.
 *
 * Fails closed at every step. The caller must ALSO record the returned nonce in
 * a durable store and reject a repeat — signature validity alone does not stop
 * replay. See `nonceStore.ts`.
 */
export function verifyRequest(options: VerifyOptions): VerifyResult {
  const service = headerValue(options.headers, SERVICE_HEADERS.service);
  const keyId = headerValue(options.headers, SERVICE_HEADERS.keyId);
  const timestamp = headerValue(options.headers, SERVICE_HEADERS.timestamp);
  const nonce = headerValue(options.headers, SERVICE_HEADERS.nonce);
  const signature = headerValue(options.headers, SERVICE_HEADERS.signature);

  if (!service || !keyId || !timestamp || !nonce || !signature) {
    return { ok: false, reason: "MISSING_HEADERS" };
  }
  if (service !== options.expectedService) {
    return { ok: false, reason: "SERVICE_MISMATCH" };
  }

  const secret = options.secrets[keyId];
  // Deliberately indistinguishable from a signature mismatch to the caller;
  // the distinction is kept only for server-side alerting.
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, reason: "UNKNOWN_KEY_ID" };
  }

  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds)) {
    return { ok: false, reason: "MALFORMED_TIMESTAMP" };
  }

  const now = options.now ? options.now() : Math.floor(Date.now() / 1000);
  const skew = options.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  if (Math.abs(now - seconds) > skew) {
    return { ok: false, reason: "TIMESTAMP_OUT_OF_RANGE" };
  }

  if (!NONCE_PATTERN.test(nonce)) {
    return { ok: false, reason: "MALFORMED_NONCE" };
  }
  if (!SIGNATURE_PATTERN.test(signature)) {
    return { ok: false, reason: "MALFORMED_SIGNATURE" };
  }

  const expected = Buffer.from(
    createHmac("sha256", secret)
      .update(
        canonicalString({
          method: options.method,
          path: options.path,
          timestamp,
          nonce,
          rawBody: options.rawBody,
        }),
      )
      .digest("hex"),
    "hex",
  );
  const supplied = Buffer.from(signature, "hex");

  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, reason: "SIGNATURE_MISMATCH" };
  }

  return { ok: true, keyId, nonce, timestamp: seconds };
}
