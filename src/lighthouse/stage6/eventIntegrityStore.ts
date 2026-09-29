/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stores for stage6/eventIntegrity.ts: Postgres (migration 0015) and an
 * in-memory equivalent for unit tests and explicit local development.
 *
 * POSTGRES: one real transaction per event. It first takes two
 * transaction-scoped advisory locks — the eventId, then the aggregate — so
 * every arrival of one eventId, and every event for one aggregate, is
 * serialised; then row-locks the aggregate (`for update`) before deciding.
 * Ledger inserts, variant rows, quarantines, the aggregate write and the
 * link → grant cascade all run on that one connection and commit together.
 *
 * IN-MEMORY: a single mutex serialises transactions, and each works on a
 * private copy that replaces the live state only if the callback returns —
 * so a throw part-way leaves nothing behind, as a rollback would. Not
 * equivalent to Postgres across processes; it exists so the rules can be
 * tested without a database.
 */

import type { SqlClient, TransactionalSqlClient } from "../persistence/types.ts";
import { UniqueConstraintViolation } from "../persistence/types.ts";
import {
  aggregateStoreInTransaction,
  AGGREGATE_TABLES,
  loadAggregateForUpdate,
} from "./aggregateStoreAdapters.ts";
import type {
  AggregateState,
  ConflictKind,
  EventIntegrityStore,
  EventIntegrityUnitOfWork,
  EventLedgerRow,
  EventVariantRow,
  QuarantineKind,
  QuarantineResolution,
  QuarantineResolutionStore,
  QuarantineRow,
  RecordedOutcome,
  TransactionScope,
  VariantOutcomeReplacement,
  VersionLedgerRow,
} from "./eventIntegrity.ts";

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const VARIANT_COLUMNS = `event_id, event_digest, role, outcome, resolved_outcome, conflict_kind,
  quarantine_id, alias_of_event_id, aggregate_kind, aggregate_id, version,
  received_count, first_received_at, last_received_at`;

const QUARANTINE_COLUMNS = `quarantine_id, aggregate_kind, aggregate_id, version, kind, state,
  opened_at, resolution, resolved_by, resolved_at`;

function variantFromRow(row: Record<string, unknown>): EventVariantRow {
  return {
    eventId: String(row.event_id),
    eventDigest: String(row.event_digest),
    role: row.role as EventVariantRow["role"],
    outcome: row.outcome as RecordedOutcome,
    resolvedOutcome: (row.resolved_outcome as "superseded" | null) ?? null,
    conflictKind: (row.conflict_kind as ConflictKind | null) ?? null,
    quarantineId: row.quarantine_id ? String(row.quarantine_id) : null,
    aliasOfEventId: row.alias_of_event_id ? String(row.alias_of_event_id) : null,
    aggregateKind: String(row.aggregate_kind),
    aggregateId: String(row.aggregate_id),
    version: Number(row.version),
    receivedCount: Number(row.received_count),
    firstReceivedAt: iso(row.first_received_at),
    lastReceivedAt: iso(row.last_received_at),
  };
}

function quarantineFromRow(row: Record<string, unknown>): QuarantineRow {
  return {
    quarantineId: String(row.quarantine_id),
    aggregateKind: String(row.aggregate_kind),
    aggregateId: String(row.aggregate_id),
    version: Number(row.version),
    kind: row.kind as QuarantineKind,
    state: row.state as QuarantineRow["state"],
    openedAt: iso(row.opened_at),
    resolution: (row.resolution as QuarantineRow["resolution"]) ?? null,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : null,
    resolvedAt: isoOrNull(row.resolved_at),
  };
}

async function advisoryLock(tx: SqlClient, key: string): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

class SqlUnitOfWork implements EventIntegrityUnitOfWork {
  readonly #tx: SqlClient;
  readonly #aggregateKinds: ReadonlySet<string>;
  readonly #lockedAggregates = new Set<string>();

  constructor(tx: SqlClient, aggregateKinds: ReadonlySet<string>) {
    this.#tx = tx;
    this.#aggregateKinds = aggregateKinds;
  }

  async lockAggregate(aggregateKind: string, aggregateId: string): Promise<void> {
    const key = `${aggregateKind}:${aggregateId}`;
    if (this.#lockedAggregates.has(key)) return;
    await advisoryLock(this.#tx, `lighthouse.aggregate:${key}`);
    this.#lockedAggregates.add(key);
  }

  async findVariant(eventId: string, eventDigest: string): Promise<EventVariantRow | null> {
    const result = await this.#tx.query<Record<string, unknown>>(
      `select ${VARIANT_COLUMNS} from lighthouse.event_variants
        where event_id = $1 and event_digest = $2`,
      [eventId, eventDigest],
    );
    return result.rows[0] ? variantFromRow(result.rows[0]) : null;
  }

  async findEventLedger(eventId: string): Promise<EventLedgerRow | null> {
    const result = await this.#tx.query<Record<string, unknown>>(
      `select event_id, accepted_event_digest, aggregate_kind, aggregate_id, version, first_received_at
         from lighthouse.event_ledger where event_id = $1`,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      eventId: String(row.event_id),
      acceptedEventDigest: String(row.accepted_event_digest),
      aggregateKind: String(row.aggregate_kind),
      aggregateId: String(row.aggregate_id),
      version: Number(row.version),
      firstReceivedAt: iso(row.first_received_at),
    };
  }

  async insertEventLedger(row: EventLedgerRow): Promise<void> {
    // No `on conflict`: a race must surface as UniqueConstraintViolation so
    // the whole transaction rolls back and is re-evaluated.
    await this.#tx.query(
      `insert into lighthouse.event_ledger
         (event_id, accepted_event_digest, aggregate_kind, aggregate_id, version, first_received_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [row.eventId, row.acceptedEventDigest, row.aggregateKind, row.aggregateId, row.version, row.firstReceivedAt],
    );
  }

  async insertVariant(row: EventVariantRow): Promise<void> {
    await this.#tx.query(
      `insert into lighthouse.event_variants (${VARIANT_COLUMNS})
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        row.eventId, row.eventDigest, row.role, row.outcome, row.resolvedOutcome, row.conflictKind,
        row.quarantineId, row.aliasOfEventId, row.aggregateKind, row.aggregateId, row.version,
        row.receivedCount, row.firstReceivedAt, row.lastReceivedAt,
      ],
    );
  }

  async touchVariant(eventId: string, eventDigest: string, at: string): Promise<void> {
    await this.#tx.query(
      `update lighthouse.event_variants
          set received_count = received_count + 1, last_received_at = $3
        where event_id = $1 and event_digest = $2`,
      [eventId, eventDigest, at],
    );
  }

  async replaceBlockedVariantOutcome(
    eventId: string,
    eventDigest: string,
    replacement: VariantOutcomeReplacement,
    at: string,
  ): Promise<void> {
    const result = await this.#tx.query(
      `update lighthouse.event_variants
          set outcome = $3, conflict_kind = $4, quarantine_id = $5, alias_of_event_id = $6,
              received_count = received_count + 1, last_received_at = $7
        where event_id = $1 and event_digest = $2 and outcome = 'blocked'`,
      [eventId, eventDigest, replacement.outcome, replacement.conflictKind,
        replacement.quarantineId, replacement.aliasOfEventId, at],
    );
    if (result.rowCount !== 1) {
      throw new Error("blocked variant changed underneath its re-evaluation");
    }
  }

  async findVersionLedger(aggregateKind: string, aggregateId: string, version: number): Promise<VersionLedgerRow | null> {
    const result = await this.#tx.query<Record<string, unknown>>(
      `select aggregate_kind, aggregate_id, version, version_content_digest, first_event_id, recorded_at
         from lighthouse.version_ledger
        where aggregate_kind = $1 and aggregate_id = $2 and version = $3`,
      [aggregateKind, aggregateId, version],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      aggregateKind: String(row.aggregate_kind),
      aggregateId: String(row.aggregate_id),
      version: Number(row.version),
      versionContentDigest: String(row.version_content_digest),
      firstEventId: String(row.first_event_id),
      recordedAt: iso(row.recorded_at),
    };
  }

  async insertVersionLedger(row: VersionLedgerRow): Promise<void> {
    await this.#tx.query(
      `insert into lighthouse.version_ledger
         (aggregate_kind, aggregate_id, version, version_content_digest, first_event_id, recorded_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [row.aggregateKind, row.aggregateId, row.version, row.versionContentDigest, row.firstEventId, row.recordedAt],
    );
  }

  async findOpenQuarantine(aggregateKind: string, aggregateId: string): Promise<QuarantineRow | null> {
    const result = await this.#tx.query<Record<string, unknown>>(
      `select ${QUARANTINE_COLUMNS} from lighthouse.event_quarantines
        where aggregate_kind = $1 and aggregate_id = $2 and state = 'open'`,
      [aggregateKind, aggregateId],
    );
    return result.rows[0] ? quarantineFromRow(result.rows[0]) : null;
  }

  async getQuarantine(quarantineId: string): Promise<QuarantineRow | null> {
    const result = await this.#tx.query<Record<string, unknown>>(
      `select ${QUARANTINE_COLUMNS} from lighthouse.event_quarantines where quarantine_id = $1`,
      [quarantineId],
    );
    return result.rows[0] ? quarantineFromRow(result.rows[0]) : null;
  }

  async insertQuarantine(row: QuarantineRow): Promise<void> {
    await this.#tx.query(
      `insert into lighthouse.event_quarantines
         (quarantine_id, aggregate_kind, aggregate_id, version, kind, state, opened_at)
       values ($1,$2,$3,$4,$5,'open',$6)`,
      [row.quarantineId, row.aggregateKind, row.aggregateId, row.version, row.kind, row.openedAt],
    );
  }

  hasAggregateStore(aggregateKind: string): boolean {
    return this.#aggregateKinds.has(aggregateKind) && aggregateKind in AGGREGATE_TABLES;
  }

  async loadAggregateForUpdate(aggregateKind: string, aggregateId: string): Promise<AggregateState | null> {
    if (!this.hasAggregateStore(aggregateKind)) return null;
    return loadAggregateForUpdate(this.#tx, aggregateKind, aggregateId);
  }

  async peekAggregate(aggregateKind: string, aggregateId: string): Promise<AggregateState | null> {
    if (!this.hasAggregateStore(aggregateKind)) return null;
    const store = aggregateStoreInTransaction(this.#tx, aggregateKind);
    return store ? store.loadState(aggregateId) : null;
  }

  async saveAggregate(aggregateKind: string, aggregateId: string, state: AggregateState): Promise<void> {
    const store = aggregateStoreInTransaction(this.#tx, aggregateKind);
    if (!store) throw new Error(`no aggregate store for ${aggregateKind}`);
    await store.saveState(aggregateId, state);
  }
}

export interface SqlEventIntegrityStoreOptions {
  /** Aggregate kinds whose local table this deployment accepts events for. */
  readonly aggregateKinds: readonly string[];
}

export class SqlEventIntegrityStore implements EventIntegrityStore, QuarantineResolutionStore {
  readonly #client: TransactionalSqlClient;
  readonly #aggregateKinds: ReadonlySet<string>;

  constructor(client: TransactionalSqlClient, options: SqlEventIntegrityStoreOptions) {
    this.#client = client;
    this.#aggregateKinds = new Set(options.aggregateKinds);
  }

  async transaction<T>(scope: TransactionScope, fn: (uow: EventIntegrityUnitOfWork) => Promise<T>): Promise<T> {
    return this.#client.transaction(async (tx) => {
      // Order is fixed: eventId, then aggregate. See module doc.
      await advisoryLock(tx, `lighthouse.event:${scope.eventId}`);
      const uow = new SqlUnitOfWork(tx, this.#aggregateKinds);
      await uow.lockAggregate(scope.aggregateKind, scope.aggregateId);
      return fn(uow);
    });
  }

  async isAggregateBlocked(aggregateKind: string, aggregateId: string): Promise<boolean> {
    const result = await this.#client.query(
      `select 1 from lighthouse.event_quarantines
        where aggregate_kind = $1 and aggregate_id = $2 and state = 'open'`,
      [aggregateKind, aggregateId],
    );
    return result.rowCount > 0;
  }

  async resolveQuarantine(resolution: QuarantineResolution): Promise<boolean> {
    return this.#client.transaction(async (tx) => {
      const found = await tx.query<{ aggregate_kind: string; aggregate_id: string }>(
        `select aggregate_kind, aggregate_id from lighthouse.event_quarantines
          where quarantine_id = $1 and state = 'open'`,
        [resolution.quarantineId],
      );
      const row = found.rows[0];
      if (!row) return false;
      // Same lock the event path takes, so resolution never interleaves
      // with an event evaluating this aggregate.
      await advisoryLock(tx, `lighthouse.aggregate:${row.aggregate_kind}:${row.aggregate_id}`);
      const updated = await tx.query(
        `update lighthouse.event_quarantines
            set state = 'resolved', resolution = $2, resolved_by = $3, resolved_at = $4
          where quarantine_id = $1 and state = 'open'`,
        [resolution.quarantineId, resolution.resolution, resolution.resolvedBy, resolution.resolvedAt],
      );
      if (updated.rowCount !== 1) return false;
      await tx.query(
        `update lighthouse.event_variants
            set resolved_outcome = 'superseded'
          where quarantine_id = $1
            and outcome in ('conflict','rejected_transition')
            and resolved_outcome is null`,
        [resolution.quarantineId],
      );
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

interface MemoryState {
  ledger: Map<string, EventLedgerRow>;
  variants: Map<string, EventVariantRow>;
  versions: Map<string, VersionLedgerRow>;
  quarantines: Map<string, QuarantineRow>;
  aggregates: Map<string, AggregateState>;
}

const variantKey = (eventId: string, digest: string) => `${eventId}\u0000${digest}`;
const aggregateKey = (kind: string, id: string) => `${kind}\u0000${id}`;
const versionKey = (kind: string, id: string, version: number) => `${kind}\u0000${id}\u0000${version}`;

function cloneState(state: MemoryState): MemoryState {
  return {
    ledger: new Map(state.ledger),
    variants: new Map(state.variants),
    versions: new Map(state.versions),
    quarantines: new Map(state.quarantines),
    aggregates: new Map(state.aggregates),
  };
}

export interface InMemoryEventIntegrityStoreOptions {
  readonly aggregateKinds: readonly string[];
  /**
   * Runs inside the transaction after an aggregate write — the in-memory
   * stand-in for dependent effects like the link → grant cascade. A throw
   * rolls the whole transaction back.
   */
  readonly onSaveAggregate?: (aggregateKind: string, aggregateId: string, state: AggregateState) => void;
}

export class InMemoryEventIntegrityStore implements EventIntegrityStore, QuarantineResolutionStore {
  #state: MemoryState = {
    ledger: new Map(), variants: new Map(), versions: new Map(),
    quarantines: new Map(), aggregates: new Map(),
  };
  #queue: Promise<unknown> = Promise.resolve();
  readonly #aggregateKinds: ReadonlySet<string>;
  readonly #onSaveAggregate: InMemoryEventIntegrityStoreOptions["onSaveAggregate"];

  constructor(options: InMemoryEventIntegrityStoreOptions) {
    this.#aggregateKinds = new Set(options.aggregateKinds);
    this.#onSaveAggregate = options.onSaveAggregate;
  }

  #serialise<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  transaction<T>(_scope: TransactionScope, fn: (uow: EventIntegrityUnitOfWork) => Promise<T>): Promise<T> {
    return this.#serialise(async () => {
      const working = cloneState(this.#state);
      const result = await fn(this.#unitOfWork(working));
      this.#state = working; // commit only when fn returned
      return result;
    });
  }

  #unitOfWork(s: MemoryState): EventIntegrityUnitOfWork {
    const kinds = this.#aggregateKinds;
    const onSave = this.#onSaveAggregate;
    return {
      lockAggregate: async () => {},
      findVariant: async (eventId, digest) => s.variants.get(variantKey(eventId, digest)) ?? null,
      findEventLedger: async (eventId) => s.ledger.get(eventId) ?? null,
      insertEventLedger: async (row) => {
        if (s.ledger.has(row.eventId)) throw new UniqueConstraintViolation("event_ledger_pkey");
        s.ledger.set(row.eventId, row);
      },
      insertVariant: async (row) => {
        const key = variantKey(row.eventId, row.eventDigest);
        if (s.variants.has(key)) throw new UniqueConstraintViolation("event_variants_pkey");
        s.variants.set(key, row);
      },
      touchVariant: async (eventId, digest, at) => {
        const key = variantKey(eventId, digest);
        const row = s.variants.get(key);
        if (row) s.variants.set(key, { ...row, receivedCount: row.receivedCount + 1, lastReceivedAt: at });
      },
      replaceBlockedVariantOutcome: async (eventId, digest, replacement, at) => {
        const key = variantKey(eventId, digest);
        const row = s.variants.get(key);
        if (!row || row.outcome !== "blocked") {
          throw new Error("blocked variant changed underneath its re-evaluation");
        }
        s.variants.set(key, { ...row, ...replacement, receivedCount: row.receivedCount + 1, lastReceivedAt: at });
      },
      findVersionLedger: async (kind, id, version) => s.versions.get(versionKey(kind, id, version)) ?? null,
      insertVersionLedger: async (row) => {
        const key = versionKey(row.aggregateKind, row.aggregateId, row.version);
        if (s.versions.has(key)) throw new UniqueConstraintViolation("version_ledger_pkey");
        s.versions.set(key, row);
      },
      findOpenQuarantine: async (kind, id) =>
        [...s.quarantines.values()].find(
          (q) => q.aggregateKind === kind && q.aggregateId === id && q.state === "open",
        ) ?? null,
      getQuarantine: async (id) => s.quarantines.get(id) ?? null,
      insertQuarantine: async (row) => {
        const clash = [...s.quarantines.values()].some(
          (q) => q.aggregateKind === row.aggregateKind && q.aggregateId === row.aggregateId && q.state === "open",
        );
        if (clash || s.quarantines.has(row.quarantineId)) {
          throw new UniqueConstraintViolation("uq_event_quarantines_one_open_per_aggregate");
        }
        s.quarantines.set(row.quarantineId, row);
      },
      hasAggregateStore: (kind) => kinds.has(kind),
      loadAggregateForUpdate: async (kind, id) =>
        kinds.has(kind) ? s.aggregates.get(aggregateKey(kind, id)) ?? null : null,
      peekAggregate: async (kind, id) =>
        kinds.has(kind) ? s.aggregates.get(aggregateKey(kind, id)) ?? null : null,
      saveAggregate: async (kind, id, state) => {
        if (!s.aggregates.has(aggregateKey(kind, id))) throw new Error("aggregate not found");
        s.aggregates.set(aggregateKey(kind, id), state);
        onSave?.(kind, id, state);
      },
    };
  }

  async isAggregateBlocked(aggregateKind: string, aggregateId: string): Promise<boolean> {
    return this.isAggregateBlockedSync(aggregateKind, aggregateId);
  }

  /** Synchronous form for in-memory repositories' fail-closed reads. */
  isAggregateBlockedSync(aggregateKind: string, aggregateId: string): boolean {
    return [...this.#state.quarantines.values()].some(
      (q) => q.aggregateKind === aggregateKind && q.aggregateId === aggregateId && q.state === "open",
    );
  }

  async resolveQuarantine(resolution: QuarantineResolution): Promise<boolean> {
    return this.#serialise(async () => {
      const s = cloneState(this.#state);
      const q = s.quarantines.get(resolution.quarantineId);
      if (!q || q.state !== "open") return false;
      s.quarantines.set(q.quarantineId, {
        ...q,
        state: "resolved",
        resolution: resolution.resolution,
        resolvedBy: resolution.resolvedBy,
        resolvedAt: resolution.resolvedAt,
      });
      for (const [key, v] of s.variants) {
        if (v.quarantineId === q.quarantineId &&
            (v.outcome === "conflict" || v.outcome === "rejected_transition") &&
            v.resolvedOutcome === null) {
          s.variants.set(key, { ...v, resolvedOutcome: "superseded" });
        }
      }
      this.#state = s;
      return true;
    });
  }

  // --- test / local-development helpers ---

  seedAggregate(aggregateKind: string, aggregateId: string, state: AggregateState): void {
    this.#state.aggregates.set(aggregateKey(aggregateKind, aggregateId), state);
  }

  aggregate(aggregateKind: string, aggregateId: string): AggregateState | null {
    return this.#state.aggregates.get(aggregateKey(aggregateKind, aggregateId)) ?? null;
  }

  variantsFor(eventId: string): readonly EventVariantRow[] {
    return [...this.#state.variants.values()].filter((v) => v.eventId === eventId);
  }

  ledgerEntry(eventId: string): EventLedgerRow | null {
    return this.#state.ledger.get(eventId) ?? null;
  }

  versionEntry(aggregateKind: string, aggregateId: string, version: number): VersionLedgerRow | null {
    return this.#state.versions.get(versionKey(aggregateKind, aggregateId, version)) ?? null;
  }

  quarantine(quarantineId: string): QuarantineRow | null {
    return this.#state.quarantines.get(quarantineId) ?? null;
  }

  get counts(): { ledger: number; variants: number; versions: number; quarantines: number } {
    return {
      ledger: this.#state.ledger.size,
      variants: this.#state.variants.size,
      versions: this.#state.versions.size,
      quarantines: this.#state.quarantines.size,
    };
  }
}
