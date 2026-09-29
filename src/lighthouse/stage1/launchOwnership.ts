/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 1 — who owns a launched analysis.
 *
 * THE PROBLEM
 * A launch link is a bearer credential. "Signed in to InvestScape" plus
 * "holding the link" proves only that SOME InvestScape user has the link —
 * not that they are the professional Relationship OS issued it to. A link
 * forwarded, leaked from a log, or opened on a shared machine would otherwise
 * attach a client's relationship-scoped analysis to whoever clicked it.
 *
 * THE BINDING
 * Three facts, each proven by a different party, must line up:
 *   1. Relationship OS says WHO launched: the signed redemption response
 *      (HMAC over the exchange, fetched server-side by InvestScape) names the
 *      initiating person — `initiatingProfessional.relationshipOsPersonRef`
 *      in the PROPOSED launch-context v2.
 *   2. InvestScape says WHO is here: the verified session's `actorRef`.
 *   3. Both products previously agreed these are the same human: an ACTIVE
 *      cross-product link between exactly that RoS person and exactly that
 *      InvestScape actor, created by the dual-confirmation linking flow
 *      (service-signed invitation from RoS + session-authenticated accept in
 *      InvestScape). Never by matching emails.
 * Only when (1) = link.relationshipOsPersonRef AND (2) = link.investscapeUserRef
 * is the launch bound. Anything else is refused and no analysis is created.
 *
 * A v1 context carries no initiator, so it can NEVER be bound. Stage 1 stays
 * disabled until Relationship OS ships v2 (or an agreed equivalent).
 *
 * Also checked BEFORE redemption: an actor with no active link at all cannot
 * be the initiator, so we refuse without spending the one-time code.
 */

import type { CrossProductLink } from "../domain/crossProductLink.ts";
import type { LaunchContext } from "./contracts.ts";

export type LaunchOwnershipDecision =
  | {
      readonly ok: true;
      readonly professionalActorRef: string;
      readonly initiatorPersonRef: string;
      readonly crossProductLinkId: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        /** v1 (or any context) that does not name its initiator. */
        | "INITIATOR_NOT_ASSERTED"
        /** The signed-in user is not the confirmed-linked counterpart of the initiator. */
        | "INITIATOR_NOT_LINKED_TO_ACTOR";
    };

function isActive(link: CrossProductLink): boolean {
  return link.lifecycle.state === "active";
}

/** Cheap pre-redemption gate. False => refuse without consuming the code. */
export function actorCanBeLaunchInitiator(activeLinks: readonly CrossProductLink[]): boolean {
  return activeLinks.some(isActive);
}

export function decideLaunchOwnership(
  context: LaunchContext,
  authenticatedActorRef: string,
  actorLinks: readonly CrossProductLink[],
): LaunchOwnershipDecision {
  if (context.schemaVersion !== "investscape-launch-context.v2") {
    return { ok: false, reason: "INITIATOR_NOT_ASSERTED" };
  }
  const initiator = context.initiatingProfessional.relationshipOsPersonRef;

  const match = actorLinks.find(
    (link) =>
      isActive(link) &&
      link.investscapeUserRef === authenticatedActorRef &&
      link.relationshipOsPersonRef === initiator,
  );
  if (!match) return { ok: false, reason: "INITIATOR_NOT_LINKED_TO_ACTOR" };

  return {
    ok: true,
    professionalActorRef: authenticatedActorRef,
    initiatorPersonRef: initiator,
    crossProductLinkId: match.crossProductLinkId,
  };
}
