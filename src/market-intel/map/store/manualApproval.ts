import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MapSession } from '../auth.ts';
import type { ManualMapAuthority, ManualMapGrant } from '../memberAccess.ts';
import { databaseNow, type MapDatabase, type MapSql } from './sql.ts';

const issuer = z.string().regex(/^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/);
const subject = z.string().min(1).max(256);
const command = z.object({ issuer, subject, expectedRevision: z.number().int().nonnegative().max(2147483646),
  requestId: z.string().uuid(), reason: z.string().trim().min(1).max(500),
  action: z.enum(['approve', 'revoke']), expiresAt: z.number().finite().positive().optional() }).strict();
export type ManualApprovalCommand = z.infer<typeof command>;
export type ApprovalResult = { ok: true; revision: number } |
  { ok: false; status: 400 | 401 | 403 | 409 | 503; code: string };

export async function loadManualGrant(sql: MapSql, session: MapSession): Promise<ManualMapGrant | null> {
  const result = await sql.query(`SELECT grant_id, issuer, subject, approval_method,
    extract(epoch FROM approved_at)::float8 AS approved_at, approved_by, active, revoked,
    extract(epoch FROM expires_at)::float8 AS expires_at
    FROM mi_map_private.member_grants WHERE issuer = $1 AND subject = $2`, [session.issuer, session.subject]);
  const r = result.rows[0];
  if (!r) return null;
  return { grantId: r.grant_id as string, issuer: r.issuer as string, subject: r.subject as string,
    approvalMethod: r.approval_method as 'manual', approvedAt: r.approved_at as number,
    approvedBy: r.approved_by as string, active: r.active as boolean, revoked: r.revoked as boolean,
    expiresAt: r.expires_at as number, capabilities: ['map_read'] };
}

/** Internal methods only. Actor MUST come from server-owned verification, never a request body. */
export class PostgresManualMapStore implements ManualMapAuthority {
  private readonly db: MapDatabase;
  constructor(db: MapDatabase) { this.db = db; }
  resolve(session: MapSession) { return loadManualGrant(this.db, session); }

  async change(actor: MapSession, input: unknown): Promise<ApprovalResult> {
    const parsed = command.safeParse(input);
    if (!parsed.success || !issuer.safeParse(actor.issuer).success || !subject.safeParse(actor.subject).success)
      return { ok: false, status: 400, code: 'INVALID_APPROVAL' };
    if (!Number.isFinite(actor.expiresAt)) return { ok: false, status: 401, code: 'AUTHENTICATION_REQUIRED' };
    const c = parsed.data;
    if (c.issuer !== actor.issuer) return { ok: false, status: 403, code: 'ACCESS_DENIED' };
    try {
      return await this.db.transaction(async sql => {
        const now = await databaseNow(sql);
        if (actor.expiresAt <= now) return { ok: false, status: 401, code: 'AUTHENTICATION_REQUIRED' };
        if ((c.action === 'approve' && (!c.expiresAt || c.expiresAt <= now)) ||
            (c.action === 'revoke' && c.expiresAt !== undefined))
          return { ok: false, status: 400, code: 'INVALID_APPROVAL' };
        // Lock the admin assignment against concurrent revocation during this write.
        const admin = await sql.query(`SELECT grant_id FROM mi_map_private.access_admin_grants
          WHERE issuer = $1 AND subject = $2 AND active AND expires_at > clock_timestamp() FOR SHARE`,
          [actor.issuer, actor.subject]);
        if (!admin.rows.length) return { ok: false, status: 403, code: 'ACCESS_DENIED' };
        // Transaction-local audit context. The SQL trigger independently validates the administrator.
        await sql.query(`SELECT set_config('mi_map.actor_issuer', $1, true),
          set_config('mi_map.actor_subject', $2, true), set_config('mi_map.actor_expiry', $3, true),
          set_config('mi_map.request_id', $4, true), set_config('mi_map.reason', $5, true)`,
          [actor.issuer, actor.subject, String(actor.expiresAt), c.requestId, c.reason]);
        // Prevent two first approvals racing on an absent row. Hash collisions serialize extra work only.
        await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [JSON.stringify([c.issuer, c.subject])]);
        const current = await sql.query(`SELECT revision FROM mi_map_private.member_grants
          WHERE issuer = $1 AND subject = $2 FOR UPDATE`, [c.issuer, c.subject]);
        const revision = current.rows[0]?.revision ?? 0;
        if (revision !== c.expectedRevision || (c.action === 'revoke' && revision === 0))
          return { ok: false, status: 409, code: 'APPROVAL_CHANGED' };
        // No request replay can create a second change; callers must reconcile after a lost response.
        const repeated = await sql.query('SELECT 1 FROM mi_map_private.approval_audit WHERE request_id = $1', [c.requestId]);
        if (repeated.rows.length) return { ok: false, status: 409, code: 'APPROVAL_CHANGED' };
        if (c.action === 'approve') {
          const statement = revision === 0 ? `INSERT INTO mi_map_private.member_grants
            (issuer, subject, grant_id, expires_at) VALUES ($1, $2, $3, to_timestamp($4))` :
            `UPDATE mi_map_private.member_grants SET grant_id = $3, expires_at = to_timestamp($4),
              active = true, revoked = false WHERE issuer = $1 AND subject = $2`;
          await sql.query(statement,
            [c.issuer, c.subject, randomUUID(), c.expiresAt]);
        } else {
          await sql.query(`UPDATE mi_map_private.member_grants SET active = false, revoked = true
            WHERE issuer = $1 AND subject = $2`, [c.issuer, c.subject]);
        }
        const result = await sql.query(`SELECT revision FROM mi_map_private.member_grants
          WHERE issuer = $1 AND subject = $2`, [c.issuer, c.subject]);
        return { ok: true, revision: result.rows[0]!.revision as number };
      });
    } catch { return { ok: false, status: 503, code: 'MAP_STORE_UNAVAILABLE' }; }
  }
}
