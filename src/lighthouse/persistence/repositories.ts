/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Repository composition root.
 *
 * One place decides whether the Lighthouse integration runs on real Postgres
 * or on the in-memory test doubles — so that decision is reviewable, logged,
 * and cannot be made accidentally in the middle of a request handler.
 *
 * FAIL-CLOSED, and specifically about the WRONG kind of convenience:
 * the dangerous failure here is not "no database, so crash". It is "no
 * database, so quietly use the in-memory store" — which boots cleanly, passes
 * a smoke test, and then loses every launch binding on restart while
 * `InMemoryNonceStore` silently stops protecting against replay across
 * processes. So in-memory requires an EXPLICIT opt-in that is impossible to
 * set by accident, and is refused outright in production.
 */

import { SqlNonceStore, InMemoryNonceStore, type NonceStore } from "../service-auth/nonceStore.ts";
import { SqlAuditSink, InMemoryAuditSink, type AuditSink } from "../audit/auditEvent.ts";
import {
  SqlAnalysisBindingRepository,
  InMemoryAnalysisBindingRepository,
  type AnalysisBindingRepository,
} from "../stage1/analysisBinding.ts";
import {
  SqlLinkRepository,
  InMemoryLinkRepository,
  type LinkRepository,
} from "../stage2/linkRepository.ts";
import {
  SqlWorkspaceDisclosureRepository,
  InMemoryWorkspaceDisclosureRepository,
  type WorkspaceDisclosureRepository,
} from "../stage3/workspaceDisclosureRepository.ts";
import {
  SqlShareGrantRepository,
  InMemoryShareGrantRepository,
  type ShareGrantRepository,
} from "../stage4/shareGrantRepository.ts";
import {
  SqlDelegationMandateRepository,
  InMemoryDelegationMandateRepository,
  type DelegationMandateRepository,
} from "../stage8/delegationRepository.ts";
import {
  SqlAdminAssignmentRepository,
  InMemoryAdminAssignmentRepository,
  type AdminAssignmentRepository,
} from "../stage7/adminAssignmentRepository.ts";
import {
  SqlInboundEventRepository,
  InMemoryInboundEventRepository,
  type InboundEventRepository,
} from "../stage6/inboundEventRepository.ts";
import {
  SqlLifecycleOutboxRepository,
  InMemoryLifecycleOutboxRepository,
  type LifecycleOutboxRepository,
} from "../stage6/lifecycleOutbox.ts";
import type { TransactionalSqlClient } from "./types.ts";

export type PersistenceMode = "postgres" | "in-memory";

export interface LighthouseRepositories {
  readonly mode: PersistenceMode;
  readonly nonces: NonceStore;
  readonly audit: AuditSink;
  readonly bindings: AnalysisBindingRepository;
  readonly links: LinkRepository;
  /** Stage 3: coarse client-workspace availability disclosure consent. */
  readonly workspaceDisclosure: WorkspaceDisclosureRepository;
  /** Stage 4: client-selected analysis share grants. */
  readonly grants: ShareGrantRepository;
  /** Stage 8: delegated client portfolio management mandates (Mode D). */
  readonly mandates: DelegationMandateRepository;
  /** Stage 7: cross-product administration assignments. */
  readonly adminAssignments: AdminAssignmentRepository;
  /** Stage 6: inbound lifecycle event idempotency ledger. */
  readonly inboundEvents: InboundEventRepository;
  /** Stage 6: durable outbox for outbound lifecycle events. */
  readonly lifecycleOutbox: LifecycleOutboxRepository;
  /** Null in in-memory mode. */
  readonly sql: TransactionalSqlClient | null;
}

export interface BuildRepositoriesInput {
  /** A live client, or null when DATABASE_URL is unset. */
  readonly client: TransactionalSqlClient | null;
  /** Only ever true from an explicit local-development environment variable. */
  readonly allowInMemory: boolean;
  /** Refuses in-memory regardless of the flag. */
  readonly isProduction: boolean;
}

export class PersistenceNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceNotConfiguredError";
  }
}

export function buildRepositories(
  input: BuildRepositoriesInput,
): LighthouseRepositories {
  if (input.client) {
    return {
      mode: "postgres",
      sql: input.client,
      nonces: new SqlNonceStore(input.client),
      audit: new SqlAuditSink(input.client),
      bindings: new SqlAnalysisBindingRepository(input.client),
      links: new SqlLinkRepository(input.client),
      workspaceDisclosure: new SqlWorkspaceDisclosureRepository(input.client),
      grants: new SqlShareGrantRepository(input.client),
      mandates: new SqlDelegationMandateRepository(input.client),
      adminAssignments: new SqlAdminAssignmentRepository(input.client),
      inboundEvents: new SqlInboundEventRepository(input.client),
      lifecycleOutbox: new SqlLifecycleOutboxRepository(input.client),
    };
  }

  if (input.isProduction) {
    throw new PersistenceNotConfiguredError(
      "DATABASE_URL is required in production. Refusing to start the Lighthouse " +
        "integration on in-memory persistence: launch bindings would not survive a " +
        "restart and replay protection would not span processes.",
    );
  }

  if (!input.allowInMemory) {
    throw new PersistenceNotConfiguredError(
      "DATABASE_URL is not set. Set it, or set " +
        "LIGHTHOUSE_ALLOW_INMEMORY_PERSISTENCE=true for local development only. " +
        "In-memory persistence is not durable and is not safe across processes.",
    );
  }

  return {
    mode: "in-memory",
    sql: null,
    nonces: new InMemoryNonceStore(),
    audit: new InMemoryAuditSink(),
    bindings: new InMemoryAnalysisBindingRepository(),
    links: new InMemoryLinkRepository(),
    workspaceDisclosure: new InMemoryWorkspaceDisclosureRepository(),
    grants: new InMemoryShareGrantRepository(),
    adminAssignments: new InMemoryAdminAssignmentRepository(),
    mandates: new InMemoryDelegationMandateRepository(),
    inboundEvents: new InMemoryInboundEventRepository(),
    lifecycleOutbox: new InMemoryLifecycleOutboxRepository(),
  };
}

/** Environment-driven convenience wrapper used by the server entry point. */
export function buildRepositoriesFromEnv(
  client: TransactionalSqlClient | null,
  env: NodeJS.ProcessEnv = process.env,
): LighthouseRepositories {
  return buildRepositories({
    client,
    // Only the exact string "true" opts in — same convention as the feature
    // flags, so "1"/"yes"/"on" do not silently enable it.
    allowInMemory: env.LIGHTHOUSE_ALLOW_INMEMORY_PERSISTENCE === "true",
    isProduction: env.NODE_ENV === "production",
  });
}
