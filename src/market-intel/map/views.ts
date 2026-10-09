import { randomBytes } from 'node:crypto';
import type { MapSession } from './auth.ts';
import type { PilotGeographyId } from './pilot.ts';

export interface LayerPin { releaseId: string; generation: number; rightsRevision: number;
  boundaryVersion: string; boundaryHash: string; }
export interface MapView { geographyId: PilotGeographyId; issuer: string; subject: string;
  grantId: string; expiresAt: number; layers: Record<string, LayerPin>; }
/** Bounded single-process review cache. IDs reveal no actor or release fields. */
export class MapViewStore {
  private readonly views = new Map<string, MapView>();
  private readonly maxViews: number;
  private readonly now: () => number;
  constructor(options: { maxViews?: number; now?: () => number } = {}) {
    this.maxViews = options.maxViews ?? 1000;
    if (!Number.isSafeInteger(this.maxViews) || this.maxViews < 1 || this.maxViews > 10000)
      throw new Error('INVALID_VIEW_CAPACITY');
    this.now = options.now ?? (() => Date.now() / 1000);
  }
  private prune() { for (const [id, view] of this.views) if (view.expiresAt <= this.now()) this.views.delete(id); }
  create(view: MapView): string {
    this.prune();
    if (!Number.isFinite(view.expiresAt) || view.expiresAt <= this.now() || Object.keys(view.layers).length > 9)
      throw new Error('VIEW_UNAVAILABLE');
    while (this.views.size >= this.maxViews) this.views.delete(this.views.keys().next().value!);
    const id = randomBytes(32).toString('base64url');
    this.views.set(id, structuredClone({ ...view, expiresAt: Math.min(view.expiresAt, this.now() + 300) }));
    return id;
  }
  get(id: string, actor: MapSession, grantId: string): MapView | null {
    this.prune();
    const view = this.views.get(id);
    if (!view || view.issuer !== actor.issuer || view.subject !== actor.subject || view.grantId !== grantId) return null;
    return structuredClone(view);
  }
}
