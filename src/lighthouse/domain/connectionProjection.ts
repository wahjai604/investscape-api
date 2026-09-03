/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 3 + Stage 5 — what a professional / Relationship OS may see about a
 * client's InvestScape workspace.
 *
 * This is the narrowest privacy boundary in the whole integration, so the
 * projection is built by CONSTRUCTION rather than by filtering: the output type
 * has exactly four fields and there is no code path that can add a fifth.
 *
 * Receiver prompt §10:
 *   "Do not expose plan name, price, payment state, renewal date, failed
 *    payments, usage, portfolio size, unshared analysis count, or other
 *    workspace activity. If no disclosure consent exists, display 'InvestScape
 *    account status not shared,' not 'no subscription'."
 *
 * That last sentence matters commercially as well as legally: "no subscription"
 * would let a professional infer a client's payment state from silence.
 */

export const CONNECTION_STATES = [
  "not_connected", "invitation_pending", "connected", "revoked", "unavailable",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const WORKSPACE_AVAILABILITY = ["available", "unavailable", "unknown"] as const;
export type WorkspaceAvailability = (typeof WORKSPACE_AVAILABILITY)[number];

/**
 * Provenance of a result reference the professional can see (Stage 5).
 *
 * `personal` is present in the type ONLY so that the projection builder can
 * explicitly refuse it. A professional's own personal portfolio must never
 * appear in any client-facing projection.
 */
export const RESULT_PROVENANCE = [
  /** Produced under a Stage 1 sponsored launch. */
  "professional_assisted",
  /** Client-owned, explicitly shared back. */
  "client_shared",
  /** Produced inside a delegated mandate. */
  "delegated_client",
  /** The professional's OWN investments. Never projected. */
  "personal",
] as const;
export type ResultProvenance = (typeof RESULT_PROVENANCE)[number];

/** Provenances that may appear in a Relationship OS client projection. */
export const PROJECTABLE_PROVENANCE: ReadonlySet<ResultProvenance> = new Set([
  "professional_assisted", "client_shared", "delegated_client",
]);

/**
 * The COMPLETE professional-visible projection. Four fields, by design.
 *
 * Adding a field here is a contract change requiring both teams' agreement.
 */
export interface ProfessionalConnectionProjection {
  readonly connectionState: ConnectionState;
  /** `unknown` unless the client separately consented to reveal it. */
  readonly workspaceAvailability: WorkspaceAvailability;
  /** Human-readable status. Never implies payment state. */
  readonly statusLabel: string;
  /** Count of results the client actively shares with THIS relationship. */
  readonly sharedResultCount: number;
}

export const STATUS_NOT_SHARED = "InvestScape account status not shared";

export interface ProjectionInput {
  readonly linkState: "none" | "pending" | "active" | "suspended" | "revoked" | "expired";
  /** Separate, explicit consent — NOT implied by the link existing. */
  readonly workspaceDisclosureConsented: boolean;
  /** Only meaningful when disclosure was consented. */
  readonly workspaceIsAvailable?: boolean;
  /** Count of ACTIVE grants to this relationship only. */
  readonly sharedResultCount: number;
  readonly isProjectionEnabled: boolean;
}

/**
 * Builds the professional-visible projection.
 *
 * Note there is no parameter for plan, price, payment state, analysis count or
 * last activity. Those values cannot leak because they are never accepted.
 */
export function buildProfessionalProjection(
  input: ProjectionInput,
): ProfessionalConnectionProjection {
  if (!input.isProjectionEnabled) {
    return {
      connectionState: "unavailable",
      workspaceAvailability: "unknown",
      statusLabel: STATUS_NOT_SHARED,
      sharedResultCount: 0,
    };
  }

  const connectionState = mapLinkState(input.linkState);

  // Availability is disclosed ONLY with separate consent. Without it the answer
  // is "unknown" — never "unavailable", which would imply a fact.
  let workspaceAvailability: WorkspaceAvailability = "unknown";
  if (input.workspaceDisclosureConsented) {
    workspaceAvailability = input.workspaceIsAvailable ? "available" : "unavailable";
  }

  return {
    connectionState,
    workspaceAvailability,
    statusLabel: input.workspaceDisclosureConsented
      ? `InvestScape workspace ${workspaceAvailability}`
      : STATUS_NOT_SHARED,
    // A revoked or absent connection reveals no counts at all.
    sharedResultCount:
      connectionState === "connected" ? Math.max(0, input.sharedResultCount) : 0,
  };
}

function mapLinkState(state: ProjectionInput["linkState"]): ConnectionState {
  switch (state) {
    case "none": return "not_connected";
    case "pending": return "invitation_pending";
    case "active": return "connected";
    case "revoked":
    case "expired": return "revoked";
    case "suspended": return "unavailable";
    default: return "unavailable";
  }
}

export interface ResultReferenceProjection {
  readonly externalAnalysisId: string;
  readonly provenance: Exclude<ResultProvenance, "personal">;
  readonly status: string;
  readonly summary: Readonly<Record<string, string>>;
  readonly sharedAt?: string;
  readonly revokedAt?: string;
  /** Display label distinguishing sponsored from client-shared work. */
  readonly provenanceLabel: string;
}

const PROVENANCE_LABELS: Record<Exclude<ResultProvenance, "personal">, string> = {
  professional_assisted: "Prepared by you in InvestScape",
  client_shared: "Shared by client",
  delegated_client: "Prepared under client mandate",
};

/**
 * Filters candidate results down to those a professional may see.
 *
 * Personal portfolios are dropped unconditionally — the single most important
 * rule in Stage 5, and the reason this returns a new array rather than mutating.
 */
export function projectResultReferences(
  candidates: readonly {
    readonly externalAnalysisId: string;
    readonly provenance: ResultProvenance;
    readonly status: string;
    readonly summary: Readonly<Record<string, string>>;
    readonly sharedAt?: string;
    readonly revokedAt?: string;
    readonly relationshipRef: string;
  }[],
  requestedRelationshipRef: string,
): readonly ResultReferenceProjection[] {
  return candidates
    .filter((c) => PROJECTABLE_PROVENANCE.has(c.provenance))
    .filter((c) => c.relationshipRef === requestedRelationshipRef)
    .map((c) => {
      const provenance = c.provenance as Exclude<ResultProvenance, "personal">;
      return {
        externalAnalysisId: c.externalAnalysisId,
        provenance,
        status: c.status,
        summary: c.summary,
        sharedAt: c.sharedAt,
        revokedAt: c.revokedAt,
        provenanceLabel: PROVENANCE_LABELS[provenance],
      };
    });
}

/**
 * Enumeration guard.
 *
 * Receiver prompt §13: "No links that enumerate or open the client's unshared
 * InvestScape workspace." There is intentionally no "list all analyses for
 * client X" function anywhere in this codebase; this exists so an attempt to
 * add one fails loudly and is caught by a test.
 */
export function enumerateClientAnalyses(): never {
  throw new Error(
    "ENUMERATION_PROHIBITED: a professional may only read analyses explicitly " +
      "shared through an active share grant. Use authorizeSharedRead per analysis.",
  );
}
