/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Migration runner for the `lighthouse` schema.
 *
 * Deliberately small and deliberately boring:
 *   * migrations are plain .sql files, applied in filename order;
 *   * each runs inside a transaction, so a failure leaves no partial schema;
 *   * applied migrations are recorded with a checksum, and a changed checksum
 *     is a hard error rather than a silent re-apply — editing an applied
 *     migration is a mistake we want to hear about, not absorb;
 *   * re-running is a no-op.
 *
 * NOT DESTRUCTIVE. There is no `down`, no drop, and no reset path here. Undoing
 * a migration is a deliberate, human, reviewed act — not a flag on a script.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TransactionalSqlClient } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export interface MigrationRecord {
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationOutcome {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

function checksum(sql: string): string {
  // Normalise line endings so a CRLF checkout doesn't look like a tampered file.
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

/** The ledger table. Created outside the per-migration transaction. */
const LEDGER_DDL = `
create schema if not exists lighthouse;
create table if not exists lighthouse.schema_migrations (
  name        text        primary key,
  checksum    text        not null,
  applied_at  timestamptz not null default now()
);
`;

export async function readMigrationFiles(): Promise<
  readonly { readonly name: string; readonly sql: string }[]
> {
  const entries = await readdir(MIGRATIONS_DIR);
  const names = entries.filter((n) => n.endsWith(".sql")).sort();
  const files = [];
  for (const name of names) {
    files.push({ name, sql: await readFile(join(MIGRATIONS_DIR, name), "utf8") });
  }
  return files;
}

/**
 * Applies every pending migration. Returns what was applied vs already present.
 *
 * @throws if an already-applied migration's contents have changed.
 */
export async function migrate(
  client: TransactionalSqlClient,
): Promise<MigrationOutcome> {
  await client.query(LEDGER_DDL);

  const existing = await client.query<{ name: string; checksum: string }>(
    "select name, checksum from lighthouse.schema_migrations",
  );
  const applied = new Map(existing.rows.map((r) => [r.name, r.checksum]));

  const files = await readMigrationFiles();
  const appliedNow: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sum = checksum(file.sql);
    const previous = applied.get(file.name);

    if (previous !== undefined) {
      if (previous !== sum) {
        throw new Error(
          `Migration ${file.name} has changed since it was applied ` +
            `(recorded ${previous.slice(0, 12)}, file ${sum.slice(0, 12)}). ` +
            `Applied migrations are immutable — add a new migration instead.`,
        );
      }
      skipped.push(file.name);
      continue;
    }

    await client.transaction(async (tx) => {
      await tx.query(file.sql);
      await tx.query(
        "insert into lighthouse.schema_migrations (name, checksum) values ($1, $2)",
        [file.name, sum],
      );
    });
    appliedNow.push(file.name);
  }

  return { applied: appliedNow, skipped };
}
