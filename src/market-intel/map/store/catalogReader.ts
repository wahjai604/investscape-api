import { z } from 'zod';
import type { MapSession } from '../auth.ts';
import { resolveManualMapAccess } from '../memberAccess.ts';
import { loadManualGrant } from './manualApproval.ts';
import { databaseNow, type MapDatabase, type MapSql } from './sql.ts';

const text = z.string().min(1).max(500);
const date = z.iso.date();
const observationSchema = z.object({
  observationId: text, metricId: text, periodStart: date, periodEnd: date, periodLabel: text,
  unit: text, currency: z.enum(['CAD', 'USD']).nullable(), priceBasis: text.nullable(), universe: text,
  sourceGeographyId: text, sourceGeographyVintage: text,
  dimensions: z.record(z.string().min(1).max(120), text),
  value: z.number().finite().nullable(), status: z.enum(['available', 'suppressed', 'missing']),
  rawValueMarker: text.nullable(), marginOfError: z.number().finite().nonnegative().nullable(),
  rawMoeMarker: text.nullable(), qualityFlags: z.array(text).max(30),
}).superRefine((r, ctx) => {
  if (r.periodEnd < r.periodStart || (r.status === 'available') !== (r.value !== null))
    ctx.addIssue({ code: 'custom', message: 'Invalid observation' });
});
const selectionSchema = z.object({
  layerId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  geographyId: z.enum(['CA-CMA-535', 'CA-CMA-933', 'US-STATE-04', 'US-STATE-48']),
  pinnedReleaseId: text.optional(), pinnedGeneration: z.number().int().positive().max(2147483647).optional(),
}).strict().refine(r => (r.pinnedReleaseId === undefined) === (r.pinnedGeneration === undefined));
export type CatalogSelection = z.infer<typeof selectionSchema>;
export type CatalogObservation = z.infer<typeof observationSchema>;
export interface CatalogLayer {
  contractVersion: 'map-catalog-review-1'; state: 'available' | 'partial' | 'no_data';
  layerId: string; geographyId: string; releaseId: string; generation: number; asOf: string;
  boundaryVersion: string; boundaryHash: string; crosswalkRef: string;
  comparisonMode: 'context_only'; notices: string[];
  source: { productId: string; provider: string; url: string; revisionId: string;
    definitionVersion: string; retrievedAt: string; releasedAt: string | null };
  observations: CatalogObservation[];
}
export type CatalogReadResult = { ok: true; layer: CatalogLayer } |
  { ok: false; status: 400 | 401 | 403 | 409 | 503; code: string };
type Control = Record<string, unknown>;

async function control(sql: MapSql, s: CatalogSelection): Promise<Control | null> {
  const r = await sql.query(`SELECT h.release_id, h.generation, h.state, r.clearance_id,
    c.revision AS rights_revision, c.state AS rights_state, c.allow_ui, c.required_agreement,
    c.valid_until > clock_timestamp() AS rights_current, c.notices,
    r.boundary_version, r.boundary_hash, r.crosswalk_ref, r.observation_count, r.qualified,
    r.as_of, r.product_id, r.source_revision_id, r.definition_version, r.retrieved_at, r.released_at,
    p.provider, p.canonical_url
    FROM mi_map_private.publication_heads h
    JOIN mi_map_private.catalog_releases r ON r.release_id = h.release_id
    JOIN mi_map_private.rights_controls c ON c.clearance_id = r.clearance_id
    JOIN mi_map_private.source_products p ON p.product_id = r.product_id
    WHERE h.layer_id = $1 AND h.geography_id = $2`, [s.layerId, s.geographyId]);
  return r.rows[0] ?? null;
}
function deliverable(c: Control | null): c is Control {
  return !!c && c.state === 'published' && c.qualified === true && c.rights_state === 'cleared' &&
    c.allow_ui === true && c.rights_current === true;
}
function iso(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('MAP_CATALOG_UNAVAILABLE');
  return value.toISOString();
}

/** Internal UI aggregate reader only; no network/geometry delivery or route registration. */
export class PostgresPrivateCatalogReader {
  private readonly db: MapDatabase;
  constructor(db: MapDatabase) { this.db = db; }
  async readLayer(session: MapSession, input: unknown): Promise<CatalogReadResult> {
    const parsed = selectionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, status: 400, code: 'INVALID_SELECTION' };
    const s = parsed.data;
    try {
      return await this.db.transaction(async sql => {
        const authority = { resolve: (actor: MapSession) => loadManualGrant(sql, actor) };
        const access = await resolveManualMapAccess(session, authority, await databaseNow(sql));
        if (!access.ok) return access;
        const initial = await control(sql, s);
        if (!deliverable(initial)) return { ok: false, status: 503, code: 'LAYER_UNAVAILABLE' };
        if (initial.required_agreement !== null)
          return { ok: false, status: 403, code: 'TERMS_REQUIRED' };
        if (s.pinnedReleaseId !== undefined &&
            (s.pinnedReleaseId !== initial.release_id || s.pinnedGeneration !== initial.generation))
          return { ok: false, status: 409, code: 'RELEASE_CHANGED' };
        if (!Number.isSafeInteger(initial.observation_count) || Number(initial.observation_count) > 250 ||
            Number(initial.observation_count) < 0) throw new Error('MAP_CATALOG_UNAVAILABLE');
        const rows = await sql.query(`SELECT observation FROM mi_map_private.observations
          WHERE release_id = $1 ORDER BY ordinal LIMIT 251`, [initial.release_id]);
        if (rows.rows.length !== initial.observation_count) throw new Error('MAP_CATALOG_UNAVAILABLE');
        const observations = rows.rows.map(row => observationSchema.parse(row.observation));
        if (new Set(observations.map(row => row.observationId)).size !== observations.length)
          throw new Error('MAP_CATALOG_UNAVAILABLE');
        const current = await control(sql, s);
        const member = await resolveManualMapAccess(session, authority, await databaseNow(sql));
        if (!member.ok) return member;
        if (member.grant.grantId !== access.grant.grantId) return { ok: false, status: 409, code: 'ACCESS_CHANGED' };
        if (!deliverable(current)) return { ok: false, status: 503, code: 'LAYER_UNAVAILABLE' };
        if (current.required_agreement !== null) return { ok: false, status: 403, code: 'TERMS_REQUIRED' };
        if (['release_id', 'generation', 'clearance_id', 'rights_revision', 'boundary_version', 'boundary_hash',
            'crosswalk_ref'].some(key => current[key] !== initial[key]))
          return { ok: false, status: 409, code: 'RELEASE_CHANGED' };
        // Whitelist public aggregate fields. Internal audit, actor and clearance evidence never escape.
        return { ok: true, layer: {
          contractVersion: 'map-catalog-review-1', layerId: s.layerId, geographyId: s.geographyId,
          state: !observations.length ? 'no_data' : observations.some(r => r.status !== 'available') ? 'partial' : 'available',
          releaseId: text.parse(initial.release_id), generation: z.number().int().positive().parse(initial.generation),
          asOf: iso(initial.as_of), boundaryVersion: text.parse(initial.boundary_version),
          boundaryHash: z.string().regex(/^[a-f0-9]{64}$/).parse(initial.boundary_hash), crosswalkRef: text.parse(initial.crosswalk_ref),
          comparisonMode: 'context_only', notices: z.array(text).min(1).max(20).parse(current.notices),
          source: { productId: text.parse(initial.product_id), provider: text.parse(initial.provider),
            url: z.url().refine(url => url.startsWith('https://')).parse(initial.canonical_url),
            revisionId: text.parse(initial.source_revision_id), definitionVersion: text.parse(initial.definition_version),
            retrievedAt: iso(initial.retrieved_at), releasedAt: initial.released_at === null ? null : iso(initial.released_at) },
          observations,
        } };
      });
    } catch { return { ok: false, status: 503, code: 'MAP_CATALOG_UNAVAILABLE' }; }
  }
}
