/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Postgres / Supabase adapter for the `SqlClient` seam.
 *
 * This is the driver the repositories were written against back when
 * `persistence/types.ts` deliberately shipped without one. Nothing in
 * `domain/` or `stage1/` changes to adopt it — that was the point of the seam.
 *
 * SUPABASE NOTES
 *   * Connect with the DIRECT / session-pooler Postgres connection string, not
 *     the browser `anon` key. The anon key must never reach this service; it is
 *     a browser credential and this service is a trusted server.
 *   * Supabase requires TLS. We enable it for every non-local host and refuse
 *     to silently downgrade.
 *   * `lighthouse.*` tables have their `anon`/`authenticated` grants revoked by
 *     migration 0001, so even a leaked anon key cannot read them via PostgREST.
 *
 * FAIL-CLOSED: there is no default connection string. An unconfigured service
 * gets `null` from `createPgClient()` and the caller decides — it never guesses
 * a host, and never quietly falls back to a local database.
 */

import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  type SqlClient,
  type SqlQueryResult,
  type TransactionalSqlClient,
  UniqueConstraintViolation,
} from "./types.ts";

/** Postgres SQLSTATE for unique_violation. */
const SQLSTATE_UNIQUE_VIOLATION = "23505";

/**
 * Translates driver errors into the domain error the repositories already
 * handle, so `createIfAbsent` race handling works identically in-memory and
 * against real Postgres.
 */
function translateError(error: unknown): unknown {
  const code = (error as { code?: unknown })?.code;
  if (code === SQLSTATE_UNIQUE_VIOLATION) {
    const constraint = (error as { constraint?: unknown })?.constraint;
    return new UniqueConstraintViolation(
      typeof constraint === "string" ? constraint : "unknown",
    );
  }
  return error;
}

/**
 * `pg` returns an ARRAY of results when the SQL text contains more than one
 * statement, and a single result object otherwise. Migrations are inherently
 * multi-statement, so normalise to the LAST result — which is what a caller
 * means by "the result" of a script whose final statement is the interesting
 * one (e.g. `... returning`).
 */
function normaliseResult(
  result: unknown,
): { rows: unknown[]; rowCount: number | null } {
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  const rows = (last as { rows?: unknown })?.rows;
  return {
    rows: Array.isArray(rows) ? rows : [],
    rowCount: (last as { rowCount?: number | null })?.rowCount ?? null,
  };
}

/**
 * Supabase's pooler presents a certificate chain that is not in Node's
 * default trusted-CA bundle. We ship the project's CA certificate alongside
 * this file and load it explicitly so verification stays strict
 * (`rejectUnauthorized: true`) instead of being weakened to accept anything.
 *
 * Returns `undefined` when the file is absent (e.g. local Docker Postgres,
 * or CI, where TLS is either skipped for localhost or not yet configured) —
 * callers fall back to Node's default trust store in that case, matching
 * prior behaviour exactly.
 */
let cachedCa: string | undefined | null = null;
function loadSupabaseCa(): string | undefined {
  if (cachedCa !== null) return cachedCa ?? undefined;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    cachedCa = readFileSync(join(here, "supabase-ca.crt"), "utf8");
  } catch {
    cachedCa = undefined;
  }
  return cachedCa ?? undefined;
}

function isLocalHost(connectionString: string): boolean {
  try {
    // Postgres URLs parse as URLs once the scheme is normalised.
    const url = new URL(connectionString.replace(/^postgres(ql)?:\/\//, "https://"));
    return url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "host.docker.internal";
  } catch {
    return false;
  }
}

class PgSqlClient implements SqlClient {
  readonly #run: (sql: string, params: readonly unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;

  constructor(run: (sql: string, params: readonly unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>) {
    this.#run = run;
  }

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<SqlQueryResult<TRow>> {
    try {
      const result = normaliseResult(await this.#run(sql, params));
      return {
        rows: result.rows as readonly TRow[],
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (error) {
      throw translateError(error);
    }
  }
}

export class PgTransactionalClient implements TransactionalSqlClient {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<SqlQueryResult<TRow>> {
    try {
      const result = normaliseResult(await this.#pool.query(sql, params as unknown[]));
      return {
        rows: result.rows as readonly TRow[],
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (error) {
      throw translateError(error);
    }
  }

  /**
   * Real BEGIN/COMMIT/ROLLBACK on a single pinned connection.
   *
   * The Stage 1 requirement "two concurrent landing requests cannot create two
   * analyses" depends on this being a genuine transaction on one connection —
   * a pool-per-statement wrapper would silently break the guarantee while
   * still typechecking.
   */
  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    const connection: PoolClient = await this.#pool.connect();
    const tx = new PgSqlClient((sql, params) =>
      connection.query(sql, params as unknown[]),
    );
    try {
      await connection.query("begin");
      const result = await fn(tx);
      await connection.query("commit");
      return result;
    } catch (error) {
      try {
        await connection.query("rollback");
      } catch {
        // A rollback failure must not mask the original error.
      }
      throw translateError(error);
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export interface PgConfig {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
}

/**
 * Builds a client from an explicit config, or returns `null` when no
 * connection string is configured. Never invents a default host.
 */
export function createPgClient(
  config: Partial<PgConfig> | null | undefined,
): PgTransactionalClient | null {
  const connectionString = config?.connectionString;
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    return null;
  }

  const local = isLocalHost(connectionString);

  const pool = new Pool({
    connectionString,
    max: config?.maxConnections ?? 10,
    connectionTimeoutMillis: config?.connectionTimeoutMs ?? 5000,
    // Supabase and every managed Postgres require TLS. Only a genuinely local
    // host is allowed to skip it; we do not read a "disable TLS" flag from the
    // environment, because that is exactly the switch that gets left on.
    ssl: local ? undefined : { rejectUnauthorized: true, ca: loadSupabaseCa() },
    // Bound every statement so a pathological query cannot pin a connection
    // for the lifetime of the process.
    statement_timeout: config?.statementTimeoutMs ?? 15_000,
  });

  // A pool-level error (e.g. the database dropping an idle connection) is
  // emitted asynchronously and terminates the process if unhandled.
  pool.on("error", (error) => {
    console.error("[lighthouse] postgres pool error:", error.message);
  });

  return new PgTransactionalClient(pool);
}

/** Reads the connection string from the environment. Returns null if absent. */
export function createPgClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PgTransactionalClient | null {
  return createPgClient({ connectionString: env.DATABASE_URL });
}
