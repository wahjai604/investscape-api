/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Confidential single-use redemption client.
 *
 * Receiver prompt §2: the InvestScape SERVER — never the browser — POSTs
 * `{ launchSessionId, code }` to Relationship OS
 * `/v1/investscape/launch-sessions/redeem` with HMAC service headers.
 *
 * THE CRITICAL RULE: "Use a short request timeout and NO AUTOMATIC RETRY after
 * an ambiguous network outcome because redemption is single-use. If the outcome
 * is uncertain, reconcile using a new server-owned operation record rather than
 * replaying blindly."
 *
 * A retry here would burn the client's only code. So a timeout or transport
 * failure returns `ambiguous`, carrying an operationId for reconciliation. It
 * never loops, and it never re-sends.
 */

import { signRequest } from "../service-auth/hmac.ts";
import { type LaunchContext, enforceScopeRedaction, parseLaunchContext } from "./contracts.ts";
import { type MappedFailure, mapRedemptionFailure } from "./errors.ts";

export const REDEMPTION_PATH = "/v1/investscape/launch-sessions/redeem";

/** The service name Relationship OS expects, per its own test fixture. */
export const INVESTSCAPE_SERVICE_NAME = "investscape";

export const DEFAULT_TIMEOUT_MS = 5000;

export interface RedemptionConfig {
  /** e.g. https://relationship-os.example. No trailing slash. */
  readonly baseUrl: string;
  readonly keyId: string;
  /** From server secret storage only. Never a request value, never logged. */
  readonly secret: string;
  readonly timeoutMs?: number;
  readonly serviceName?: string;
}

export type RedemptionOutcome =
  | { readonly kind: "success"; readonly context: LaunchContext }
  | { readonly kind: "failure"; readonly failure: MappedFailure; readonly code?: string }
  /**
   * The request may or may not have consumed the code. MUST NOT be retried
   * automatically; a human/reconciler resolves it via `operationId`.
   */
  | { readonly kind: "ambiguous"; readonly operationId: string; readonly reason: string }
  /** Misconfiguration — no endpoint or no secret. Fails closed, never fabricates. */
  | { readonly kind: "unconfigured" };

export interface RedemptionDependencies {
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
  /** Generates the reconciliation operation ID. */
  readonly newOperationId: () => string;
}

function isConfigured(config: Partial<RedemptionConfig> | null): config is RedemptionConfig {
  return Boolean(
    config &&
      typeof config.baseUrl === "string" && config.baseUrl.length > 0 &&
      typeof config.keyId === "string" && config.keyId.length > 0 &&
      typeof config.secret === "string" && config.secret.length > 0,
  );
}

/**
 * Redeems a one-time launch code.
 *
 * `code` is used to build the request body and is never returned, stored,
 * logged, or attached to any outcome — including the error outcomes.
 */
export async function redeemLaunchSession(
  input: { readonly launchSessionId: string; readonly code: string },
  config: Partial<RedemptionConfig> | null,
  deps: RedemptionDependencies,
): Promise<RedemptionOutcome> {
  if (!isConfigured(config)) {
    return { kind: "unconfigured" };
  }

  // Require HTTPS for anything that is not localhost. The launch code is a
  // bearer secret in the body; plaintext transport would expose it.
  let url: URL;
  try {
    url = new URL(REDEMPTION_PATH, config.baseUrl);
  } catch {
    return { kind: "unconfigured" };
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocal) {
    return { kind: "unconfigured" };
  }

  // Exact bytes signed must be the exact bytes sent.
  const rawBody = JSON.stringify({
    launchSessionId: input.launchSessionId,
    code: input.code,
  });

  const headers = {
    "content-type": "application/json",
    ...signRequest({
      serviceName: config.serviceName ?? INVESTSCAPE_SERVICE_NAME,
      keyId: config.keyId,
      secret: config.secret,
      method: "POST",
      path: REDEMPTION_PATH,
      rawBody,
      now: deps.now,
    }),
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await deps.fetch(url.toString(), {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    });
  } catch (error) {
    // Timeout or transport failure. The server may have consumed the session.
    // Deliberately NOT retried.
    return {
      kind: "ambiguous",
      operationId: deps.newOperationId(),
      reason: error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "transport_failure",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = (await response.json()) as { code?: unknown; error?: { code?: unknown } };
      const candidate = body?.code ?? body?.error?.code;
      if (typeof candidate === "string") code = candidate;
    } catch {
      // A non-JSON error body is not itself an error; status drives the mapping.
    }
    return {
      kind: "failure",
      failure: mapRedemptionFailure(response.status, code),
      code,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // 200 with an unreadable body: the session was probably consumed, so this
    // is ambiguous rather than a clean failure.
    return {
      kind: "ambiguous",
      operationId: deps.newOperationId(),
      reason: "unreadable_success_body",
    };
  }

  const parsed = parseLaunchContext(payload);
  if (!parsed.ok) {
    // A 200 we cannot validate is a contract breach. Fail closed — never
    // partially initialise from an unvalidated body.
    return {
      kind: "ambiguous",
      operationId: deps.newOperationId(),
      reason: `schema_mismatch:${parsed.issues.slice(0, 3).join(";")}`,
    };
  }

  // CONFIRMED DEFECT (2026-09-02 architecture review, P0): the producer does
  // not condition listPrice/currency/address on permittedScopes/redactedScopes
  // before sending them. We do not trust the wire's own labelling — enforce
  // our local scope->field allow-list unconditionally, on every redemption,
  // not as an opt-in step a caller could forget.
  const { context: redacted } = enforceScopeRedaction(parsed.value);
  return { kind: "success", context: redacted };
}
