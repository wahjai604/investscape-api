/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 1 — sign-in handoff for a Relationship OS launch.
 *
 * WHY
 * The launch link lands on /relationship-os/launch (this API's origin). The
 * professional's InvestScape session lives in the app (a different origin),
 * and they may not be signed in at all. Redemption needs BOTH the one-time
 * code and that session. The code must survive a sign-in round trip without
 * being put in persistent browser storage, a URL a server sees, or a log.
 *
 * HOW
 *   1. Landing page -> POST /launch/handoffs {launchSessionId, code}
 *      (no session). The server generates a 256-bit random `handoffToken`,
 *      stores the code ENCRYPTED under a key derived from that token
 *      (HKDF-SHA256 -> AES-256-GCM), stores only SHA-256 of the token for
 *      lookup, and returns the token. TTL 10 minutes, single use.
 *   2. The page navigates to the app's resume URL with the token in the URL
 *      FRAGMENT (#handoff=...). Fragments are never sent to any server, so
 *      the token reaches no request log. The app must hold it only in memory
 *      (or sessionStorage across its own sign-in redirect), and clear the
 *      fragment with history.replaceState on arrival.
 *   3. Signed in, the app -> POST /launch/handoffs/redeem {handoffToken}
 *      with its bearer session. The server claims the handoff atomically
 *      (single use, unexpired), wipes the ciphertext in the same statement,
 *      decrypts the code in memory, and runs the normal redemption, including
 *      the ownership rule in launchOwnership.ts.
 *
 * WHAT A LEAK GIVES AN ATTACKER
 *   - The database alone: ciphertext it cannot decrypt (the key is derived
 *     from a token it does not hold), and nothing at all once claimed/expired.
 *   - The token alone (e.g. from browser history before replaceState): an
 *     attempt to redeem that still requires being signed in as the
 *     professional who is confirmed-linked to the launch's initiator.
 *   - The code itself is never returned to the browser again, never logged,
 *     and never stored in plaintext.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { SqlClient } from "../persistence/types.ts";

export const HANDOFF_TTL_SECONDS = 600;
const KEY_INFO = Buffer.from("investscape.launch-handoff.code-key.v1");
const LOOKUP_PREFIX = "investscape.launch-handoff.lookup.v1:";

export interface SealedHandoff {
  readonly handoffId: string;
  readonly tokenHash: string;
  readonly launchSessionId: string;
  readonly ciphertext: string; // base64
  readonly iv: string; // base64
  readonly authTag: string; // base64
  readonly createdAt: string;
  readonly expiresAt: string;
}

export function generateHandoffToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHandoffToken(token: string): string {
  return createHash("sha256").update(LOOKUP_PREFIX + token).digest("hex");
}

function deriveKey(token: string, handoffId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(token, "utf8"), Buffer.from(handoffId, "utf8"), KEY_INFO, 32));
}

/** AAD binds the ciphertext to its row: it cannot be transplanted to another handoff. */
function aad(handoffId: string, launchSessionId: string): Buffer {
  return Buffer.from(`${handoffId}\n${launchSessionId}`, "utf8");
}

export function sealHandoff(input: {
  readonly handoffId: string;
  readonly token: string;
  readonly launchSessionId: string;
  readonly code: string;
  readonly now: Date;
}): SealedHandoff {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(input.token, input.handoffId), iv);
  cipher.setAAD(aad(input.handoffId, input.launchSessionId));
  const ciphertext = Buffer.concat([cipher.update(input.code, "utf8"), cipher.final()]);
  return {
    handoffId: input.handoffId,
    tokenHash: hashHandoffToken(input.token),
    launchSessionId: input.launchSessionId,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + HANDOFF_TTL_SECONDS * 1000).toISOString(),
  };
}

/** Returns the code, or null if the token does not open this row. Never throws on tamper. */
export function openHandoff(sealed: SealedHandoff, token: string): string | null {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(token, sealed.handoffId),
      Buffer.from(sealed.iv, "base64"),
    );
    decipher.setAAD(aad(sealed.handoffId, sealed.launchSessionId));
    decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export interface LaunchHandoffRepository {
  /** Stores a sealed handoff and purges expired ciphertext. */
  create(sealed: SealedHandoff, now: Date): Promise<void>;
  /**
   * Atomically claims an unconsumed, unexpired handoff by token hash, records
   * who claimed it, and WIPES the ciphertext in the same operation. Returns
   * the sealed values as they were before the wipe, or null.
   */
  claim(tokenHash: string, actorRef: string, now: Date): Promise<SealedHandoff | null>;
}

export class SqlLaunchHandoffRepository implements LaunchHandoffRepository {
  readonly #client: SqlClient;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  async create(sealed: SealedHandoff, now: Date): Promise<void> {
    // Expired ciphertext is useless and is removed first; rows themselves are
    // kept one day for audit correlation, then deleted.
    await this.#client.query(
      `update lighthouse.launch_handoffs
          set code_ciphertext = null, code_iv = null, code_auth_tag = null
        where expires_at <= $1 and code_ciphertext is not null`,
      [now.toISOString()],
    );
    await this.#client.query(
      `delete from lighthouse.launch_handoffs where expires_at < $1::timestamptz - interval '1 day'`,
      [now.toISOString()],
    );
    await this.#client.query(
      `insert into lighthouse.launch_handoffs
         (handoff_id, token_hash, launch_session_id, code_ciphertext, code_iv,
          code_auth_tag, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        sealed.handoffId, sealed.tokenHash, sealed.launchSessionId, sealed.ciphertext,
        sealed.iv, sealed.authTag, sealed.createdAt, sealed.expiresAt,
      ],
    );
  }

  async claim(tokenHash: string, actorRef: string, now: Date): Promise<SealedHandoff | null> {
    // One statement: lock the row, capture the ciphertext, then null it.
    // RETURNING reads `prior`, the pre-update snapshot.
    const result = await this.#client.query<Record<string, unknown>>(
      `update lighthouse.launch_handoffs h
          set consumed_at = $2, consumed_by_actor_ref = $3,
              code_ciphertext = null, code_iv = null, code_auth_tag = null
         from (select handoff_id, launch_session_id, code_ciphertext, code_iv,
                      code_auth_tag, created_at, expires_at
                 from lighthouse.launch_handoffs
                where token_hash = $1
                  and consumed_at is null
                  and expires_at > $2
                  and code_ciphertext is not null
                for update) prior
        where h.handoff_id = prior.handoff_id
        returning prior.handoff_id, prior.launch_session_id, prior.code_ciphertext,
                  prior.code_iv, prior.code_auth_tag, prior.created_at, prior.expires_at`,
      [tokenHash, now.toISOString(), actorRef],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      handoffId: String(row.handoff_id),
      tokenHash,
      launchSessionId: String(row.launch_session_id),
      ciphertext: String(row.code_ciphertext),
      iv: String(row.code_iv),
      authTag: String(row.code_auth_tag),
      createdAt: new Date(row.created_at as string).toISOString(),
      expiresAt: new Date(row.expires_at as string).toISOString(),
    };
  }
}

/** Tests and explicit local development only; single process. */
export class InMemoryLaunchHandoffRepository implements LaunchHandoffRepository {
  readonly #byHash = new Map<string, { sealed: SealedHandoff | null; meta: SealedHandoff; consumedBy: string | null }>();

  async create(sealed: SealedHandoff): Promise<void> {
    this.#byHash.set(sealed.tokenHash, { sealed, meta: sealed, consumedBy: null });
  }

  async claim(tokenHash: string, actorRef: string, now: Date): Promise<SealedHandoff | null> {
    const entry = this.#byHash.get(tokenHash);
    if (!entry || entry.consumedBy !== null || entry.sealed === null) return null;
    if (new Date(entry.meta.expiresAt) <= now) return null;
    const sealed = entry.sealed;
    entry.sealed = null; // wipe on claim
    entry.consumedBy = actorRef;
    return sealed;
  }

  /** Test hook: is any ciphertext still held for this token? */
  holdsCiphertext(tokenHash: string): boolean {
    return this.#byHash.get(tokenHash)?.sealed != null;
  }
}
