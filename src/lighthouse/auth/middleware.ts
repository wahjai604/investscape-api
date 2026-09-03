/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Express authentication middleware.
 *
 * Two separate concerns, deliberately not merged:
 *
 *   requireSession        — WHO is calling (authentication)
 *   requireOperatingContext — WHOSE portfolio they may act on (authorization)
 *
 * Invariant 4 says these are separate authorities and neither implies the
 * other. Collapsing them into one "auth" middleware is exactly how a valid
 * login silently becomes permission to read someone else's portfolio.
 *
 * Nothing here reads an identifier from the request body. The actor comes from
 * a verified token; the subject comes from a database authority row.
 */

import type { NextFunction, Request, Response } from "express";
import {
  extractBearerToken,
  type AuthenticatedSession,
  type SessionVerifier,
} from "./session.ts";
import {
  resolveOperatingContext,
  type ContextAuthorityRecord,
  type OperatingContextKind,
  type ResolvedOperatingContext,
} from "../domain/operatingContext.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      lighthouseSession?: AuthenticatedSession;
      lighthouseContext?: ResolvedOperatingContext;
    }
  }
}

/** Correlation id for a request. Generated server-side; a client-supplied one is never trusted as authority. */
function correlationIdFor(req: Request): string {
  const supplied = req.header("x-correlation-id");
  // Accept a client hint only if it is bounded and safe to log; otherwise mint one.
  if (supplied && /^[A-Za-z0-9_-]{8,64}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

/**
 * Authentication. 401 on any failure, with a single opaque message.
 *
 * The specific `reason` is deliberately NOT returned to the caller — telling an
 * attacker "expired" vs "bad signature" vs "unknown issuer" is a free oracle.
 * It is attached to the request for server-side audit instead.
 */
export function requireSession(verifier: SessionVerifier) {
  return async function requireSessionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const extracted = extractBearerToken(req.header("authorization"));
    if (!extracted.ok) {
      res.status(401).json({ error: { message: "Authentication required" } });
      return;
    }

    let result;
    try {
      result = await verifier.verify(extracted.token);
    } catch {
      // A verifier throwing (e.g. JWKS fetch failure) must not 500 into a
      // stack trace, and must not be treated as success.
      res.status(401).json({ error: { message: "Authentication required" } });
      return;
    }

    if (!result.ok) {
      console.warn(
        `[lighthouse] auth rejected ${req.method} ${req.path}: ${result.reason}`,
      );
      res.status(401).json({ error: { message: "Authentication required" } });
      return;
    }

    req.lighthouseSession = result.session;
    next();
  };
}

export interface ContextMiddlewareDeps {
  /** Loads an authority row. Must query the DATABASE, never the request. */
  readonly lookupAuthority: (
    actorRef: string,
    kind: OperatingContextKind,
    relationshipRef?: string,
  ) => Promise<ContextAuthorityRecord | null>;
  readonly isContextEnabled: (kind: OperatingContextKind) => boolean;
  readonly now?: () => Date;
}

/**
 * Authorization. Resolves WHOSE portfolio this request may touch.
 *
 * The requested context and relationship arrive as request hints and are
 * treated as hints only — `resolveOperatingContext` requires a matching
 * server-held authority row and fails closed at every branch.
 *
 * Requires `requireSession` to have run first.
 */
export function requireOperatingContext(deps: ContextMiddlewareDeps) {
  return async function requireOperatingContextMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const session = req.lighthouseSession;
    if (!session) {
      // Programming error: middleware mounted in the wrong order. Fail closed.
      res.status(401).json({ error: { message: "Authentication required" } });
      return;
    }

    const resolution = await resolveOperatingContext({
      authenticatedActorId: session.actorRef,
      requestedKind: req.header("x-operating-context") ?? "personal",
      // Which client, for a professional holding several mandates.
      requestedRelationshipRef: req.header("x-relationship-ref") ?? undefined,
      lookupAuthority: deps.lookupAuthority,
      isContextEnabled: deps.isContextEnabled,
      now: deps.now ?? (() => new Date()),
      correlationId: correlationIdFor(req),
    });

    if (!resolution.ok) {
      console.warn(
        `[lighthouse] context denied ${req.method} ${req.path}: ${resolution.reason}`,
      );
      // 403, not 404: the caller IS authenticated, they simply may not act in
      // the context they asked for. A single message for every reason, so the
      // response cannot be used to enumerate which clients exist.
      res.status(403).json({ error: { message: "Not permitted in this context" } });
      return;
    }

    req.lighthouseContext = resolution.context;
    next();
  };
}

/**
 * Reads authority rows from Postgres.
 *
 * The `status = 'active'` filter and the relationship match happen in SQL, so
 * a suspended or wrong-client row is never even loaded into memory — and
 * `resolveOperatingContext` re-checks both anyway.
 */
export function sqlAuthorityLookup(client: {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: readonly T[] }>;
}) {
  return async function lookupAuthority(
    actorRef: string,
    kind: OperatingContextKind,
    relationshipRef?: string,
  ): Promise<ContextAuthorityRecord | null> {
    const result = await client.query<{
      actor_ref: string; subject_ref: string; kind: string;
      authority_kind: string; authority_grant_id: string | null;
      relationship_ref: string | null; scopes: string[]; status: string;
      effective_from: Date | null; expires_at: Date | null;
    }>(
      `select actor_ref, subject_ref, kind, authority_kind, authority_grant_id,
              relationship_ref, scopes, status, effective_from, expires_at
         from lighthouse.context_authorities
        where actor_ref = $1
          and kind = $2
          and ($3::text is null or relationship_ref = $3)
        limit 2`,
      [actorRef, kind, relationshipRef ?? null],
    );

    // More than one match means the caller did not disambiguate. Refuse rather
    // than pick — this is the multi-client ambiguity, caught at the data layer.
    if (result.rows.length !== 1) return null;

    const row = result.rows[0]!;
    return {
      kind: row.kind as OperatingContextKind,
      actorId: row.actor_ref,
      subjectId: row.subject_ref,
      authority: {
        kind: row.authority_kind as ContextAuthorityRecord["authority"]["kind"],
        ...(row.authority_grant_id ? { grantId: row.authority_grant_id } : {}),
      } as ContextAuthorityRecord["authority"],
      scopes: row.scopes ?? [],
      status: row.status as ContextAuthorityRecord["status"],
      ...(row.relationship_ref ? { relationshipRef: row.relationship_ref } : {}),
      ...(row.effective_from ? { effectiveFrom: row.effective_from.toISOString() } : {}),
      ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    };
  };
}
