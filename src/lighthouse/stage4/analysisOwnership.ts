/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 4 — analysis ownership for share-grant creation.
 *
 * A client may only share analyses from THEIR OWN personal workspace. Today
 * that workspace's analyses are `investscape.deals` rows (migration 0008),
 * owned by `owner_id = auth.uid()`, which is the same identity the Lighthouse
 * session layer calls `actorRef`.
 *
 * Deliberately excluded:
 *   - `lighthouse.launch_analysis_bindings` — a launched analysis belongs to
 *     the professional's professional_assisted context, never to the client.
 *   - soft-deleted deals (`deleted_at is not null`).
 *
 * Fails closed: any id that is not UUID-shaped, missing, deleted or owned by
 * someone else makes the WHOLE selection unowned. The caller learns only
 * "not all yours", never which id failed, so it cannot probe foreign ids.
 */

import type { SqlClient } from "../persistence/types.ts";

const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type AnalysisOwnershipCheck = (
  clientUserRef: string,
  analysisIds: readonly string[],
) => Promise<boolean>;

export function sqlAnalysisOwnership(client: SqlClient): AnalysisOwnershipCheck {
  return async (clientUserRef, analysisIds) => {
    const unique = [...new Set(analysisIds)];
    if (unique.length === 0) return false;
    if (!UUID_SHAPE.test(clientUserRef)) return false;
    if (!unique.every((id) => UUID_SHAPE.test(id))) return false;

    const result = await client.query<{ owned: string | number }>(
      `select count(*) as owned
         from investscape.deals
        where id = any($2::uuid[])
          and owner_id = $1::uuid
          and deleted_at is null`,
      [clientUserRef, unique],
    );
    return Number(result.rows[0]?.owned ?? 0) === unique.length;
  };
}

/**
 * In-memory mode has no personal-workspace store, so nothing is provably
 * owned. Fails closed; route tests inject their own check.
 */
export const noAnalysisOwnership: AnalysisOwnershipCheck = async () => false;
