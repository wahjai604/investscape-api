/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Minimal SQL client seam.
 *
 * WHY AN INTERFACE INSTEAD OF A DRIVER: investscape-api currently has no
 * database dependency at all. Introducing `pg` / `@supabase/supabase-js` is a
 * real architectural commitment that deserves its own decision and review, so
 * this layer defines the shape the repositories need and nothing more. Tests
 * run against `InMemorySqlClient`; a Supabase/Postgres adapter can be dropped in
 * later without touching domain code.
 *
 * The signature deliberately mirrors relationship-os `packages/postgres-adapters`
 * so the two products' repository code stays readable side by side.
 */

export interface SqlQueryResult<TRow = Record<string, unknown>> {
  readonly rows: readonly TRow[];
  readonly rowCount: number;
}

export interface SqlClient {
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<TRow>>;
}

/**
 * A transactional seam. Stage 1's "two concurrent landing requests must not
 * create two analyses" requirement needs real atomicity; the Postgres adapter
 * must implement this with an actual transaction, not a best-effort wrapper.
 */
export interface TransactionalSqlClient extends SqlClient {
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}

/** Thrown when a repository detects a violated uniqueness guarantee. */
export class UniqueConstraintViolation extends Error {
  readonly constraint: string;

  constructor(constraint: string) {
    super(`Unique constraint violated: ${constraint}`);
    this.name = "UniqueConstraintViolation";
    this.constraint = constraint;
  }
}
