/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Replay protection for signed service requests.
 *
 * A valid signature proves authenticity, not freshness. Without a nonce store a
 * captured request can be resent inside the 300-second skew window and will
 * verify perfectly. Invariant 5 requires replay protection, so signature
 * verification and nonce consumption must ALWAYS be used together.
 *
 * The nonce is stored as a SHA-256 hash, matching the Relationship OS producer
 * (`app.service_request_nonces`) — a leaked store then reveals nothing reusable.
 */

import { createHash } from "node:crypto";
import type { SqlClient } from "../persistence/types.ts";

export interface NonceStore {
  /**
   * Records the nonce and returns true if it was previously unseen.
   * Returns false when the nonce has already been consumed (a replay).
   * Must be atomic: two concurrent calls with the same nonce yield exactly
   * one `true`.
   */
  consume(serviceKey: string, keyId: string, nonce: string, issuedAtSeconds: number): Promise<boolean>;
}

export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/** Default retention: the skew window. Older rows can be reaped safely. */
export const NONCE_RETENTION_SECONDS = 300;

/**
 * Postgres-backed store. `insert ... on conflict do nothing` gives us the
 * atomic test-and-set; rowCount === 1 means we won the insert.
 */
export class SqlNonceStore implements NonceStore {
  // Explicit fields, not TS parameter properties — Node's strip-only type
  // stripping rejects those. Same style as SqlAuditSink.
  readonly #client: SqlClient;
  readonly #retentionSeconds: number;

  constructor(client: SqlClient, retentionSeconds: number = NONCE_RETENTION_SECONDS) {
    this.#client = client;
    this.#retentionSeconds = retentionSeconds;
  }

  async consume(
    serviceKey: string,
    keyId: string,
    nonce: string,
    issuedAtSeconds: number,
  ): Promise<boolean> {
    const result = await this.#client.query(
      `insert into lighthouse.service_request_nonces
         (service_key, key_id, nonce_hash, expires_at)
       values ($1, $2, $3, to_timestamp($4) + ($5 || ' seconds')::interval)
       on conflict do nothing
       returning id`,
      [serviceKey, keyId, hashNonce(nonce), issuedAtSeconds, this.#retentionSeconds],
    );
    return result.rowCount === 1;
  }
}

/**
 * In-memory store for tests and local development.
 *
 * NOT safe for multi-process deployment: two API instances would each accept
 * the same nonce once. Production must use `SqlNonceStore`.
 */
export class InMemoryNonceStore implements NonceStore {
  readonly #seen = new Map<string, number>();
  readonly #retentionSeconds: number;

  constructor(retentionSeconds: number = NONCE_RETENTION_SECONDS) {
    this.#retentionSeconds = retentionSeconds;
  }

  async consume(
    serviceKey: string,
    keyId: string,
    nonce: string,
    issuedAtSeconds: number,
  ): Promise<boolean> {
    this.#reap(issuedAtSeconds);
    const key = `${serviceKey}:${keyId}:${hashNonce(nonce)}`;
    if (this.#seen.has(key)) return false;
    this.#seen.set(key, issuedAtSeconds + this.#retentionSeconds);
    return true;
  }

  #reap(nowSeconds: number): void {
    for (const [key, expiresAt] of this.#seen) {
      if (expiresAt <= nowSeconds) this.#seen.delete(key);
    }
  }

  get size(): number {
    return this.#seen.size;
  }
}
