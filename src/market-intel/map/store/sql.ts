import type { Pool } from 'pg';

export interface MapSql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}
export interface MapDatabase extends MapSql {
  transaction<T>(work: (sql: MapSql) => Promise<T>): Promise<T>;
}

/** Inject an independently scoped pool. Never discovers credentials or opens a default database. */
export class PgMapDatabase implements MapDatabase {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }
  async transaction<T>(work: (sql: MapSql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroy = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch {
      try { await client.query('ROLLBACK'); } catch { destroy = true; }
      // Do not propagate a driver's diagnostics, query values or connection details.
      throw new Error('MAP_STORE_UNAVAILABLE');
    } finally {
      try { client.release(destroy); } catch { throw new Error('MAP_STORE_UNAVAILABLE'); }
    }
  }
}

export async function databaseNow(sql: MapSql): Promise<number> {
  const result = await sql.query('SELECT extract(epoch FROM clock_timestamp())::float8 AS seconds');
  const seconds = result.rows[0]?.seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new Error('MAP_STORE_UNAVAILABLE');
  return seconds;
}
