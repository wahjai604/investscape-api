/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Production wiring for operating-context resolution (P1 defect 6).
 *
 * `requireOperatingContext` existed but was never mounted, and nothing in
 * production tied a context kind to its feature flag. This module supplies
 * the two dependencies it needs and one guard, and bootstrap.ts mounts them.
 *
 *   isOperatingContextEnabled   context kind -> server-side flag. Unknown and
 *                               `organization` are always off.
 *   createAuthorityLookup       authority rows from lighthouse.context_authorities;
 *                               `personal` is the session's own self-authority.
 *   requirePersonalContext      refuses any resolved context other than the
 *                               caller acting for themselves.
 */

import type { NextFunction, Request, Response } from "express";
import { isFeatureEnabled, type FeatureFlagSource } from "../config/featureFlags.ts";
import type {
  ContextAuthorityRecord,
  OperatingContextKind,
} from "../domain/operatingContext.ts";
import { sqlAuthorityLookup } from "./middleware.ts";

/**
 * Which flag makes each context reachable. A flag never GRANTS a context —
 * `resolveOperatingContext` still requires an authority record — it only
 * decides whether the kind may be resolved at all.
 */
export function isOperatingContextEnabled(
  kind: OperatingContextKind,
  env: FeatureFlagSource = process.env,
): boolean {
  switch (kind) {
    case "personal":
      return true;
    case "professional_assisted":
      return isFeatureEnabled("lighthouse.stage1_launch_receiver", env);
    case "delegated_client":
      return isFeatureEnabled("lighthouse.delegated_portfolio_management", env);
    case "organization":
      return false;
    default:
      return false;
  }
}

type AuthorityLookup = (
  actorRef: string,
  kind: OperatingContextKind,
  relationshipRef?: string,
) => Promise<ContextAuthorityRecord | null>;

/**
 * `personal`: the self-authority. Its only evidence is the verified session
 * (actor == subject, authority kind "self"); there is no third party whose
 * consent a table row would record, so materialising one per user would add
 * a write without adding proof. It is still resolved through
 * `resolveOperatingContext` and audited like every other context.
 *
 * Every other kind: a row in lighthouse.context_authorities, or nothing. In
 * in-memory mode (`client` null) there is no such table and every non-personal
 * lookup fails closed.
 */
export function createAuthorityLookup(
  client: Parameters<typeof sqlAuthorityLookup>[0] | null,
): AuthorityLookup {
  const fromTable = client ? sqlAuthorityLookup(client) : null;
  return async (actorRef, kind, relationshipRef) => {
    if (kind === "personal") {
      return {
        kind: "personal",
        actorId: actorRef,
        subjectId: actorRef,
        authority: { kind: "self" },
        scopes: [],
        status: "active",
      };
    }
    return fromTable ? fromTable(actorRef, kind, relationshipRef) : null;
  };
}

/**
 * For client-owned consent surfaces (linking, disclosure, sharing): the caller
 * must be acting for themselves. A professional_assisted or delegated_client
 * context can never create, list or revoke a client's links or grants.
 */
export function requirePersonalContext(req: Request, res: Response, next: NextFunction): void {
  const context = req.lighthouseContext;
  const session = req.lighthouseSession;
  if (
    !context ||
    !session ||
    context.kind !== "personal" ||
    context.actorId !== session.actorRef ||
    context.subjectId !== session.actorRef
  ) {
    res.status(403).json({ error: { message: "Not permitted in this context" } });
    return;
  }
  next();
}
