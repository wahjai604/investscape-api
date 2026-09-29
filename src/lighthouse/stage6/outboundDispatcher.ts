/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 — outbound lifecycle event sweep.
 *
 * THIS IS A SWEEP FUNCTION, CALLED PERIODICALLY. It is not a long-running
 * worker loop and does not start a `setInterval` itself — that decision
 * belongs to the caller (bootstrap.ts / a real deploy's scheduled job), not to
 * library code. See the comment in bootstrap.ts for the judgment call recorded
 * there about how this gets invoked in this codebase today.
 *
 * Signing reuses `signRequest` from service-auth/hmac.ts — the exact approach
 * `redemptionClient.ts` uses for its outbound call. No new signing scheme.
 */

import { signRequest } from "../service-auth/hmac.ts";
import {
  applyDeliveryOutcome,
  classifyResponse,
  submittedIdentity,
  type LifecycleOutboxRepository,
} from "./lifecycleOutbox.ts";

/** Path Relationship OS exposes for inbound lifecycle events from InvestScape. */
export const LIFECYCLE_EVENT_PATH = "/v1/investscape/lifecycle-events";

export const OUTBOUND_SERVICE_NAME = "investscape";
export const DEFAULT_TIMEOUT_MS = 5000;

export interface OutboundServiceConfig {
  /** e.g. https://relationship-os.example. No trailing slash. */
  readonly baseUrl: string;
  readonly keyId: string;
  readonly secret: string;
}

export interface DispatchOutboxDependencies {
  readonly repository: LifecycleOutboxRepository;
  /** Null when the outbound service is not configured — the sweep is then a no-op. */
  readonly config: OutboundServiceConfig | null;
  readonly fetch: typeof globalThis.fetch;
  readonly limit?: number;
  readonly timeoutMs?: number;
}

export interface DispatchSweepResult {
  readonly processed: number;
  readonly acknowledged: number;
  readonly retried: number;
  readonly failedPermanent: number;
  /** Kept durably, neither failed nor delivered (§3.4 "Sender"). */
  readonly awaitingReconciliation: number;
  readonly inQuarantine: number;
  /** Terminal, logged as not delivered. */
  readonly superseded: number;
}

/**
 * Sends every due (`pending`, `next_attempt_at <= now`) outbox entry once.
 * Never re-serialises a payload — the exact bytes stored at enqueue time are
 * the exact bytes signed and sent, on every attempt.
 */
export async function dispatchPendingOutboxEntries(
  now: Date,
  deps: DispatchOutboxDependencies,
): Promise<DispatchSweepResult> {
  if (!deps.config) {
    return {
      processed: 0, acknowledged: 0, retried: 0, failedPermanent: 0,
      awaitingReconciliation: 0, inQuarantine: 0, superseded: 0,
    };
  }
  const config = deps.config;

  const due = await deps.repository.dueEntries(now, deps.limit ?? 25);

  let acknowledged = 0;
  let retried = 0;
  let failedPermanent = 0;
  let awaitingReconciliation = 0;
  let inQuarantine = 0;
  let superseded = 0;

  for (const entry of due) {
    // No ack could ever be matched to bytes whose identity is unreadable, so
    // such an entry is not sent at all.
    const submitted = submittedIdentity(entry);
    if (!submitted) {
      await deps.repository.update(
        applyDeliveryOutcome(entry, { kind: "permanent", reason: "submitted_event_unreadable" }, now),
      );
      failedPermanent += 1;
      continue;
    }

    const url = new URL(LIFECYCLE_EVENT_PATH, config.baseUrl);
    const headers = {
      "content-type": "application/json",
      ...signRequest({
        serviceName: OUTBOUND_SERVICE_NAME,
        keyId: config.keyId,
        secret: config.secret,
        method: "POST",
        path: LIFECYCLE_EVENT_PATH,
        rawBody: entry.payload,
        now: () => Math.floor(now.getTime() / 1000),
      }),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let outcome: ReturnType<typeof classifyResponse> | { kind: "retryable"; reason: string };
    try {
      const response = await deps.fetch(url.toString(), {
        method: "POST",
        headers,
        body: entry.payload,
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = JSON.parse(await response.text());
      } catch {
        body = undefined; // no event-ack body: never an acknowledgement
      }
      outcome = classifyResponse(response.status, body, submitted);
    } catch (error) {
      outcome = {
        kind: "retryable",
        reason: error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "transport_failure",
      };
    } finally {
      clearTimeout(timeout);
    }

    const updated = applyDeliveryOutcome(entry, outcome, now);
    await deps.repository.update(updated);

    if (updated.state === "acknowledged") acknowledged += 1;
    else if (updated.state === "failed_permanent") failedPermanent += 1;
    else if (updated.state === "awaiting_reconciliation") awaitingReconciliation += 1;
    else if (updated.state === "in_quarantine") inQuarantine += 1;
    else if (updated.state === "superseded") superseded += 1;
    else retried += 1;
  }

  return {
    processed: due.length, acknowledged, retried, failedPermanent,
    awaitingReconciliation, inQuarantine, superseded,
  };
}
