/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Allow-listed payload schemas for inbound lifecycle events (contract v0.3 r3
 * §3.1: `payload` is "the schema-named body").
 *
 * A signature and a matching eventDigest prove who sent the bytes, not that
 * the bytes make sense. This registry is the second half of rule 1: the named
 * schema must be one InvestScape accepts, the payload must match it exactly
 * (strict, no extra members), and everything the payload says about the
 * aggregate must agree with the envelope. Anything else is rejected BEFORE a
 * ledger row or state write exists.
 *
 * PROVISIONAL. The payload bodies below are InvestScape's proposal; the
 * contract names the schemas but does not yet fix their members. Adding a
 * schema means adding an entry here, never loosening validation.
 */

import { z } from "zod";
import { LINK_STATES } from "../contracts/crossProduct.ts";
import type { EventEnvelope } from "./eventDigest.ts";
import type { AggregateKind } from "./lifecycleDispatcher.ts";

const opaqueId = z.string().min(1).max(256);
const reason = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);
const aggregateVersion = z.number().int().min(1).max(2_147_483_647);

interface RegisteredSchema {
  readonly aggregateKind: AggregateKind;
  readonly payload: z.ZodType<Record<string, unknown>>;
  /** Payload members that must equal envelope members. */
  readonly bindings: {
    readonly aggregateId: string;
    readonly targetState: string;
    readonly version: string;
  };
}

const linkChangedPayload = z
  .object({
    crossProductLinkId: opaqueId,
    state: z.enum(LINK_STATES),
    linkVersion: aggregateVersion,
    reason: reason.optional(),
  })
  .strict();

const shareGrantChangedPayload = z
  .object({
    shareGrantId: opaqueId,
    state: z.enum(["active", "expired", "revoked", "tombstoned"]),
    grantVersion: aggregateVersion,
    reason: reason.optional(),
  })
  .strict();

export const INBOUND_EVENT_SCHEMAS: Readonly<Record<string, RegisteredSchema>> = {
  "investscape.link.changed.v1": {
    aggregateKind: "link",
    payload: linkChangedPayload,
    bindings: { aggregateId: "crossProductLinkId", targetState: "state", version: "linkVersion" },
  },
  "investscape.share-grant.changed.v1": {
    aggregateKind: "share_grant",
    payload: shareGrantChangedPayload,
    bindings: { aggregateId: "shareGrantId", targetState: "state", version: "grantVersion" },
  },
};

export type SchemaValidationFailure =
  | "UNKNOWN_SCHEMA"
  | "SCHEMA_AGGREGATE_KIND_MISMATCH"
  | "PAYLOAD_INVALID"
  | "PAYLOAD_AGGREGATE_ID_MISMATCH"
  | "PAYLOAD_TARGET_STATE_MISMATCH"
  | "PAYLOAD_VERSION_MISMATCH";

export type SchemaValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SchemaValidationFailure };

export function validateEventPayload(envelope: EventEnvelope): SchemaValidation {
  // Own-property lookup: "__proto__" or "toString" must not resolve to anything.
  const entry = Object.prototype.hasOwnProperty.call(INBOUND_EVENT_SCHEMAS, envelope.schemaVersion)
    ? INBOUND_EVENT_SCHEMAS[envelope.schemaVersion]
    : undefined;
  if (!entry) return { ok: false, reason: "UNKNOWN_SCHEMA" };
  if (entry.aggregateKind !== envelope.aggregateKind) return { ok: false, reason: "SCHEMA_AGGREGATE_KIND_MISMATCH" };

  const parsed = entry.payload.safeParse(envelope.payload);
  if (!parsed.success) return { ok: false, reason: "PAYLOAD_INVALID" };
  const payload = parsed.data;

  if (payload[entry.bindings.aggregateId] !== envelope.aggregateId) {
    return { ok: false, reason: "PAYLOAD_AGGREGATE_ID_MISMATCH" };
  }
  if (payload[entry.bindings.targetState] !== envelope.targetState) {
    return { ok: false, reason: "PAYLOAD_TARGET_STATE_MISMATCH" };
  }
  if (payload[entry.bindings.version] !== envelope.version) {
    return { ok: false, reason: "PAYLOAD_VERSION_MISMATCH" };
  }
  return { ok: true };
}
