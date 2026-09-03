/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 — thin repository over the EXISTING `lighthouse.inbound_events`
 * table (added in migration 0002, unused until now). This is the durable
 * idempotency ledger: `event_id` is bound to a `payload_hash`, so a reused
 * event id carrying different bytes is a detectable conflict rather than a
 * silently-swallowed duplicate.
 */

import type { SqlClient } from "../persistence/types.ts";

export type InboundEventOutcome = "applied" | "duplicate" | "stale" | "rejected" | "conflict";

export interface InboundEventRecord {
  readonly eventId: string;
  readonly schemaVersion: string;
  readonly aggregateId: string;
  readonly aggregateKind: string;
  readonly version: number;
  readonly payloadHash: string;
  readonly outcome: InboundEventOutcome;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly correlationId: string | null;
}

export interface InboundEventRepository {
  findByEventId(eventId: string): Promise<InboundEventRecord | null>;
  /** Inserts a new ledger row. `event_id` is the primary key — never updated. */
  recordOutcome(record: Omit<InboundEventRecord, "receivedAt">, receivedAt: Date): Promise<void>;
}

function rowToRecord(row: Record<string, unknown>): InboundEventRecord {
  return {
    eventId: String(row.event_id),
    schemaVersion: String(row.schema_version),
    aggregateId: String(row.aggregate_id),
    aggregateKind: String(row.aggregate_kind),
    version: Number(row.version),
    payloadHash: String(row.payload_hash),
    outcome: row.outcome as InboundEventOutcome,
    occurredAt: new Date(row.occurred_at as string).toISOString(),
    receivedAt: new Date(row.received_at as string).toISOString(),
    correlationId: row.correlation_id ? String(row.correlation_id) : null,
  };
}

const COLUMNS = `event_id, schema_version, aggregate_id, aggregate_kind, version,
  payload_hash, outcome, occurred_at, received_at, correlation_id`;

export class SqlInboundEventRepository implements InboundEventRepository {
  readonly #client: SqlClient;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  async findByEventId(eventId: string): Promise<InboundEventRecord | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${COLUMNS} from lighthouse.inbound_events where event_id = $1`,
      [eventId],
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async recordOutcome(
    record: Omit<InboundEventRecord, "receivedAt">,
    receivedAt: Date,
  ): Promise<void> {
    await this.#client.query(
      `insert into lighthouse.inbound_events
         (event_id, schema_version, aggregate_id, aggregate_kind, version,
          payload_hash, outcome, occurred_at, received_at, correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (event_id) do nothing`,
      [
        record.eventId,
        record.schemaVersion,
        record.aggregateId,
        record.aggregateKind,
        record.version,
        record.payloadHash,
        record.outcome,
        record.occurredAt,
        receivedAt.toISOString(),
        record.correlationId,
      ],
    );
  }
}

/** In-memory ledger for tests and local development. */
export class InMemoryInboundEventRepository implements InboundEventRepository {
  readonly #byId = new Map<string, InboundEventRecord>();

  async findByEventId(eventId: string): Promise<InboundEventRecord | null> {
    return this.#byId.get(eventId) ?? null;
  }

  async recordOutcome(
    record: Omit<InboundEventRecord, "receivedAt">,
    receivedAt: Date,
  ): Promise<void> {
    if (this.#byId.has(record.eventId)) return; // event_id is the primary key
    this.#byId.set(record.eventId, { ...record, receivedAt: receivedAt.toISOString() });
  }

  get all(): readonly InboundEventRecord[] {
    return [...this.#byId.values()];
  }
}
