/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Server-owned binding between a Relationship OS launch session and exactly one
 * InvestScape analysis.
 *
 * Receiver prompt §5:
 *   - unique binding launchSessionId <-> one analysis
 *   - creation is idempotent on launchSessionId
 *   - persist correlationId, permitted modules/scopes, redacted scopes, type
 *   - DO NOT persist the one-time code
 *   - "two concurrent landing requests cannot create two analyses"
 *
 * Concurrency is handled by a unique constraint on `launch_session_id` plus
 * `on conflict do nothing ... returning`, then re-reading the winner. Two racing
 * requests therefore converge on one analysis; the loser adopts the winner's
 * row rather than creating a second.
 *
 * OWNERSHIP (migration 0013): every binding records the InvestScape
 * professional who owns it, the fixed `professional_assisted` context, the
 * Relationship OS initiator, and the cross-product link that proved the two
 * are the same person (see launchOwnership.ts). A launched analysis is never
 * written to a personal-workspace table.
 */

import type { SqlClient } from "../persistence/types.ts";
import type { KnownModule, LaunchContext } from "./contracts.ts";
import type { LaunchOwnershipDecision } from "./launchOwnership.ts";

/** The only context a launched analysis can belong to. */
export const LAUNCH_OPERATING_CONTEXT = "professional_assisted" as const;
import { partitionModules } from "./contracts.ts";

export interface AnalysisBinding {
  readonly launchSessionId: string;
  readonly analysisId: string;
  readonly analysisType: string;
  readonly permittedModules: readonly KnownModule[];
  readonly permittedScopes: readonly string[];
  readonly redactedScopes: readonly string[];
  readonly correlationId: string;
  readonly propertyRef: string;
  readonly createdAt: string;
  /** The InvestScape actor (professional) who owns this analysis. */
  readonly professionalActorRef: string;
  readonly operatingContext: typeof LAUNCH_OPERATING_CONTEXT;
  /** The Relationship OS person who initiated the launch. */
  readonly initiatorPersonRef: string;
  /** The active link that proved initiator == professionalActorRef. */
  readonly crossProductLinkId: string;
}

export interface BindingCreateResult {
  readonly binding: AnalysisBinding;
  /** False when an existing binding was adopted (idempotent replay or race). */
  readonly created: boolean;
  /** Server-selected modules that InvestScape does not recognise. Alert-worthy. */
  readonly rejectedModules: readonly string[];
}

export interface AnalysisBindingRepository {
  findByLaunchSession(launchSessionId: string): Promise<AnalysisBinding | null>;
  createIfAbsent(binding: AnalysisBinding): Promise<BindingCreateResult>;
}

/**
 * Derives a binding from a validated redemption response.
 *
 * Note what is absent: the one-time code is not a parameter and cannot be
 * persisted through this path even by mistake.
 */
export function bindingFromLaunchContext(
  context: LaunchContext,
  analysisId: string,
  createdAt: string,
  owner: Extract<LaunchOwnershipDecision, { ok: true }>,
): { readonly binding: AnalysisBinding; readonly rejectedModules: readonly string[] } {
  const { permitted, rejected } = partitionModules(context.modules);
  return {
    binding: {
      launchSessionId: context.launchSessionId,
      analysisId,
      analysisType: context.analysisType,
      permittedModules: permitted,
      permittedScopes: context.permittedScopes,
      redactedScopes: context.redactedScopes,
      correlationId: context.correlationId,
      propertyRef: context.context.property.propertyRef,
      createdAt,
      professionalActorRef: owner.professionalActorRef,
      operatingContext: LAUNCH_OPERATING_CONTEXT,
      initiatorPersonRef: owner.initiatorPersonRef,
      crossProductLinkId: owner.crossProductLinkId,
    },
    rejectedModules: rejected,
  };
}

export class SqlAnalysisBindingRepository implements AnalysisBindingRepository {
  readonly #client: SqlClient;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  async findByLaunchSession(launchSessionId: string): Promise<AnalysisBinding | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select launch_session_id, analysis_id, analysis_type, permitted_modules,
              permitted_scopes, redacted_scopes, correlation_id, property_ref, created_at,
              professional_actor_ref, operating_context, initiator_person_ref,
              cross_product_link_id
         from lighthouse.launch_analysis_bindings
        where launch_session_id = $1`,
      [launchSessionId],
    );
    const row = result.rows[0];
    return row ? rowToBinding(row) : null;
  }

  async createIfAbsent(binding: AnalysisBinding): Promise<BindingCreateResult> {
    const inserted = await this.#client.query<Record<string, unknown>>(
      `insert into lighthouse.launch_analysis_bindings
         (launch_session_id, analysis_id, analysis_type, permitted_modules,
          permitted_scopes, redacted_scopes, correlation_id, property_ref, created_at,
          professional_actor_ref, operating_context, initiator_person_ref,
          cross_product_link_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (launch_session_id) do nothing
       returning launch_session_id, analysis_id, analysis_type, permitted_modules,
                 permitted_scopes, redacted_scopes, correlation_id, property_ref, created_at,
                 professional_actor_ref, operating_context, initiator_person_ref,
                 cross_product_link_id`,
      [
        binding.launchSessionId, binding.analysisId, binding.analysisType,
        binding.permittedModules, binding.permittedScopes, binding.redactedScopes,
        binding.correlationId, binding.propertyRef, binding.createdAt,
        binding.professionalActorRef, binding.operatingContext,
        binding.initiatorPersonRef, binding.crossProductLinkId,
      ],
    );

    if (inserted.rowCount === 1 && inserted.rows[0]) {
      return { binding: rowToBinding(inserted.rows[0]), created: true, rejectedModules: [] };
    }

    // Lost the race, or an idempotent replay. Adopt the existing row.
    const existing = await this.findByLaunchSession(binding.launchSessionId);
    if (!existing) {
      throw new Error("BINDING_CONFLICT_WITHOUT_ROW");
    }
    return { binding: existing, created: false, rejectedModules: [] };
  }
}

function rowToBinding(row: Record<string, unknown>): AnalysisBinding {
  return {
    launchSessionId: String(row.launch_session_id),
    analysisId: String(row.analysis_id),
    analysisType: String(row.analysis_type),
    permittedModules: (row.permitted_modules as KnownModule[]) ?? [],
    permittedScopes: (row.permitted_scopes as string[]) ?? [],
    redactedScopes: (row.redacted_scopes as string[]) ?? [],
    correlationId: String(row.correlation_id),
    propertyRef: String(row.property_ref),
    createdAt: String(row.created_at),
    professionalActorRef: String(row.professional_actor_ref),
    operatingContext: LAUNCH_OPERATING_CONTEXT,
    initiatorPersonRef: String(row.initiator_person_ref),
    crossProductLinkId: String(row.cross_product_link_id),
  };
}

/** In-memory repository for tests and local development. */
export class InMemoryAnalysisBindingRepository implements AnalysisBindingRepository {
  readonly #byLaunchSession = new Map<string, AnalysisBinding>();

  async findByLaunchSession(launchSessionId: string): Promise<AnalysisBinding | null> {
    return this.#byLaunchSession.get(launchSessionId) ?? null;
  }

  async createIfAbsent(binding: AnalysisBinding): Promise<BindingCreateResult> {
    const existing = this.#byLaunchSession.get(binding.launchSessionId);
    if (existing) {
      return { binding: existing, created: false, rejectedModules: [] };
    }
    this.#byLaunchSession.set(binding.launchSessionId, binding);
    return { binding, created: true, rejectedModules: [] };
  }

  get size(): number {
    return this.#byLaunchSession.size;
  }
}
