/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Event digests, contract v0.3 r3 §3.2.1.
 *
 *   eventDigest          = hex(SHA-256(JCS(digestInput)))
 *   versionContentDigest = hex(SHA-256(JCS(versionContentInput)))
 *
 * `eventDigest` binds EVERY envelope member except itself — including
 * `eventId`, `occurredAt` and `correlationId` — and identifies one
 * transmission. `versionContentDigest` is derived by the receiver only and
 * binds exactly the authoritative content of one aggregate version; it leaves
 * out `eventId`, `occurredAt`, `correlationId` and the digest, so the same
 * state change re-emitted under a new `eventId` is recognised as an alias.
 *
 * Transport metadata (the `x-lighthouse-*` headers) is never part of either.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "./jcs.ts";

/** The validated body of an inbound event, minus `eventDigest`. */
export interface EventEnvelope {
  readonly eventId: string;
  readonly schemaVersion: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly targetState: string;
  readonly version: number;
  /** int64 as a decimal string. */
  readonly changeSeq: string;
  /** Informational only — never used for ordering. Digested byte-for-byte. */
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function computeEventDigest(envelope: EventEnvelope): string {
  return sha256Hex(
    canonicalize({
      eventId: envelope.eventId,
      schemaVersion: envelope.schemaVersion,
      aggregateKind: envelope.aggregateKind,
      aggregateId: envelope.aggregateId,
      targetState: envelope.targetState,
      version: envelope.version,
      changeSeq: envelope.changeSeq,
      occurredAt: envelope.occurredAt,
      // Absent is bound as JSON null, so "absent" and "present" differ.
      correlationId: envelope.correlationId ?? null,
      payload: envelope.payload,
    }),
  );
}

export function computeVersionContentDigest(envelope: EventEnvelope): string {
  return sha256Hex(
    canonicalize({
      schemaVersion: envelope.schemaVersion,
      aggregateKind: envelope.aggregateKind,
      aggregateId: envelope.aggregateId,
      version: envelope.version,
      targetState: envelope.targetState,
      changeSeq: envelope.changeSeq,
      payload: envelope.payload,
    }),
  );
}
