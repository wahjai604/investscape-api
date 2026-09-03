/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Maps Relationship OS redemption failures onto safe browser-facing states.
 *
 * Receiver prompt §4. Two rules drive the shape of this file:
 *
 *  1. "Do not reveal whether a wrong code or unknown session caused a 404."
 *     A wrong code and an unknown session MUST be indistinguishable to the
 *     browser. Both map to `invalid`, with identical copy.
 *
 *  2. "Do not offer a browser retry that resends a consumed code."
 *     Only genuinely retry-safe outcomes carry `retryable: true`. Redemption is
 *     single-use, so a consumed/expired/revoked session is terminal.
 *
 * The client-facing state names deliberately match ROS_LAUNCH's existing seven
 * render states in investscape-v2-remastered.html, so the shipped browser
 * scaffold can consume this without inventing new UI.
 */

/** The seven states the browser landing route can render. */
export type LaunchClientState =
  | "loading"
  | "invalid"
  | "expired"
  | "consumed"
  | "unavailable"
  | "error"
  | "success";

/** Relationship OS error codes, per receiver prompt §4. */
export const RELATIONSHIP_OS_ERROR_CODES = [
  "LAUNCH_REQUEST_MALFORMED",
  "SERVICE_AUTH_FAILED",
  "LAUNCH_SESSION_REVOKED",
  "LAUNCH_SESSION_NOT_FOUND",
  "LAUNCH_SESSION_ALREADY_CONSUMED",
  "LAUNCH_SESSION_EXPIRED",
] as const;

export type RelationshipOsErrorCode = (typeof RELATIONSHIP_OS_ERROR_CODES)[number];

export interface MappedFailure {
  readonly state: LaunchClientState;
  /** Safe to show a user. Contains no security detail. */
  readonly message: string;
  /** Whether the browser may offer a retry. Never true for a consumed code. */
  readonly retryable: boolean;
  /** Raise a server-side security alert (receiver prompt §7). Never shown. */
  readonly alert: boolean;
}

const INVALID_LINK: MappedFailure = {
  state: "invalid",
  message:
    "This link is not valid. Start the analysis again from Relationship OS.",
  retryable: false,
  alert: false,
};

/**
 * Status + code -> client state.
 *
 * Status is authoritative; the code refines the message only where it does not
 * disclose anything. 400 and 404 collapse to the SAME MappedFailure object so
 * the two cannot be distinguished by message, retryability, or object identity.
 */
export function mapRedemptionFailure(
  httpStatus: number,
  code?: string,
): MappedFailure {
  switch (httpStatus) {
    case 400:
      // LAUNCH_REQUEST_MALFORMED — deliberately identical to 404.
      return INVALID_LINK;

    case 401:
    case 403:
      if (code === "LAUNCH_SESSION_REVOKED") {
        return {
          state: "unavailable",
          message:
            "This analysis is no longer available. Contact your Relationship OS professional if you need access.",
          retryable: false,
          alert: false,
        };
      }
      // SERVICE_AUTH_FAILED: our credentials are wrong or rotated. The user can
      // do nothing about it, so show a neutral state and alert the operator.
      return {
        state: "unavailable",
        message:
          "The Relationship OS connection is temporarily unavailable. No analysis session was opened.",
        retryable: false,
        alert: true,
      };

    case 404:
      // LAUNCH_SESSION_NOT_FOUND — wrong code and unknown session both land
      // here and are indistinguishable by design.
      return INVALID_LINK;

    case 409:
      return {
        state: "consumed",
        message:
          "This link has already been used. Start a new analysis from Relationship OS to continue.",
        retryable: false,
        alert: false,
      };

    case 410:
      return {
        state: "expired",
        message:
          "This link has expired. Return to Relationship OS and choose “Open in InvestScape” again.",
        retryable: false,
        alert: false,
      };

    default:
      if (httpStatus >= 500) {
        // A server-side fault on their end. The code was not necessarily
        // consumed, but we still must not auto-resend it — see
        // `RedemptionOutcome.ambiguous` for the reconciliation path.
        return {
          state: "error",
          message:
            "Could not open the session. No analysis was created.",
          retryable: false,
          alert: true,
        };
      }
      return INVALID_LINK;
  }
}

/** True for codes this build understands. Unknown codes fail closed. */
export function isKnownRelationshipOsErrorCode(
  code: string,
): code is RelationshipOsErrorCode {
  return (RELATIONSHIP_OS_ERROR_CODES as readonly string[]).includes(code);
}
