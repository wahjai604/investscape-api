/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Migration CLI:  npm run migrate:lighthouse
 *
 * Reads DATABASE_URL and applies pending `lighthouse` migrations. Refuses to
 * run without an explicit connection string — it never guesses a host.
 *
 * SAFETY: forward-only. There is no down/reset/drop path. Applying a migration
 * whose file has changed since it was applied is a hard error, not a re-apply.
 */

import dotenv from "dotenv";
import { createPgClientFromEnv } from "./pgClient.ts";
import { migrate } from "./migrate.ts";

dotenv.config();

/** Redacts credentials so a connection string can be logged safely. */
function safeTarget(raw: string | undefined): string {
  if (!raw) return "(unset)";
  try {
    const url = new URL(raw.replace(/^postgres(ql)?:\/\//, "https://"));
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

async function main(): Promise<void> {
  const client = createPgClientFromEnv();
  if (!client) {
    console.error(
      "DATABASE_URL is not set. Refusing to guess a database.\n" +
        "Set it in .env (gitignored) or the environment, then re-run.",
    );
    process.exit(1);
  }

  console.log(`[lighthouse] migrating ${safeTarget(process.env.DATABASE_URL)}`);

  try {
    const outcome = await migrate(client);
    for (const name of outcome.skipped) console.log(`  = already applied  ${name}`);
    for (const name of outcome.applied) console.log(`  + applied          ${name}`);
    console.log(
      `[lighthouse] done — ${outcome.applied.length} applied, ${outcome.skipped.length} already present`,
    );
  } catch (error) {
    console.error(
      `[lighthouse] migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await main();
