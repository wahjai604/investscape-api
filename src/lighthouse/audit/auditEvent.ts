/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Audit events and redacted observability.
 *
 * Invariant 6: every sensitive read and write records the authenticated actor,
 * the data subject, the operating context, the authority/grant relied on, the
 * purpose, the scopes, the outcome, the timestamp and a correlation ID.
 *
 * Invariant 7: logs, analytics and error reports exclude secrets, one-time
 * codes, full launch URLs, unnecessary personal data, raw analyses, payment
 * data and unrestricted payloads.
 *
 * The redaction below is a deny-list plus a shape heuristic. A deny-list alone
 * is not a security boundary — the real control is never putting a secret into
 * an audit record. This is the second line of defence, not the first.
 */

import type { SqlClient } from "../persistence/types.ts";

export type AuditOutcome = "allowed" | "denied" | "error";

/**
 * The authority a sensitive action relied on. Deliberately explicit: invariant 4
 * says authentication, payment, entitlement, representation, consent, delegation
 * and administration are separate authorities and none implies another, so the
 * audit record must say WHICH one was used.
 */
export type AuditAuthorityKind =
  | "none"
  | "self"
  | "sponsored_entitlement"
  | "product_entitlement"
  | "share_grant"
  | "delegation_mandate"
  | "admin_assignment"
  | "service_identity";

export interface AuditAuthority {
  readonly kind: AuditAuthorityKind;
  /** Opaque server-side identifier of the grant. Never a browser-supplied value. */
  readonly grantId?: string;
}

export interface AuditEvent {
  readonly eventType: string;
  readonly occurredAt: string;
  /** Authenticated actor. `null` only for pre-authentication events. */
  readonly actorId: string | null;
  /** Whose data this concerns. For delegated work this is the CLIENT, not the actor. */
  readonly subjectId: string | null;
  readonly operatingContext: string | null;
  readonly authority: AuditAuthority;
  readonly purpose: string | null;
  readonly scopes: readonly string[];
  readonly outcome: AuditOutcome;
  readonly correlationId: string | null;
  /** Bounded, non-sensitive detail. Passed through `redact` before it lands. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

/** Key names that must never be persisted or logged, in any casing. */
const DENIED_KEY_FRAGMENTS = [
  "code", "secret", "signature", "password", "token", "session",
  "authorization", "cookie", "credential", "apikey", "api_key",
  "launchurl", "launch_url", "url", "payment", "card", "iban", "sin", "ssn",
  "rawbody", "raw_body", "payload", "analysis", "worksheet", "prompt",
  "notes", "document", "evidence",
];

export const REDACTED = "[redacted]";

function keyIsDenied(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return DENIED_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment.replace(/[^a-z]/g, "")),
  );
}

/**
 * Values that look like a secret regardless of their key name — long
 * high-entropy strings, and anything carrying a launch code in a URL.
 */
function valueLooksSensitive(value: string): boolean {
  if (/^[A-Za-z0-9_-]{40,}$/.test(value)) return true;
  if (/[?&]code=/i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return false;
}

/**
 * Recursively redacts a value for logging or audit metadata.
 * Depth- and breadth-bounded so a hostile or oversized payload cannot be used
 * to exhaust memory or smuggle data through sheer volume.
 */
export function redact(
  value: unknown,
  depth = 0,
  maxDepth = 6,
  maxKeys = 50,
): unknown {
  if (depth > maxDepth) return REDACTED;

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return valueLooksSensitive(value) ? REDACTED : truncate(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return REDACTED;

  if (Array.isArray(value)) {
    return value.slice(0, maxKeys).map((v) => redact(v, depth + 1, maxDepth, maxKeys));
  }

  if (value instanceof Error) {
    return { name: value.name, message: truncate(value.message) };
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (count >= maxKeys) {
        out["…"] = "[truncated]";
        break;
      }
      out[key] = keyIsDenied(key) ? REDACTED : redact(inner, depth + 1, maxDepth, maxKeys);
      count += 1;
    }
    return out;
  }

  return REDACTED;
}

const MAX_STRING = 256;
function truncate(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
}

/** Applies redaction to an event's metadata before it reaches any sink. */
export function sanitizeEvent(event: AuditEvent): AuditEvent {
  if (!event.metadata) return event;
  return { ...event, metadata: redact(event.metadata) as Record<string, unknown> };
}

/** Collects events in memory. For tests and local development only. */
export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(sanitizeEvent(event));
  }

  /** Serialised view, for asserting that a secret never appears anywhere. */
  serialize(): string {
    return JSON.stringify(this.events);
  }
}

/**
 * Immutable, append-only audit rows.
 *
 * Invariant 9: revocation removes active projections but must NOT erase
 * immutable security/audit provenance. This sink therefore only ever inserts.
 */
export class SqlAuditSink implements AuditSink {
  // NOTE: explicit field + assignment rather than a TypeScript parameter
  // property. Node's strip-only type stripping (`node --test *.ts`) rejects
  // `constructor(private readonly x: T)`. Keep this style throughout so the
  // suite runs without a build step or transpiler dependency.
  readonly #client: SqlClient;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  async record(event: AuditEvent): Promise<void> {
    const safe = sanitizeEvent(event);
    await this.#client.query(
      `insert into lighthouse.audit_events
         (event_type, occurred_at, actor_id, subject_id, operating_context,
          authority_kind, authority_grant_id, purpose, scopes, outcome,
          correlation_id, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        safe.eventType, safe.occurredAt, safe.actorId, safe.subjectId,
        safe.operatingContext, safe.authority.kind, safe.authority.grantId ?? null,
        safe.purpose, safe.scopes, safe.outcome, safe.correlationId,
        JSON.stringify(safe.metadata ?? {}),
      ],
    );
  }
}
