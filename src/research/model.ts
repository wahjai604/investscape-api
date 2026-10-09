import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
export const itemId = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const date = z.iso.datetime().nullable();
// A source may specify a calendar day without a publication instant or timezone.
const publicationDate = z.union([z.iso.date(),z.iso.datetime()]).nullable();
const url = z.url().max(2048).refine(value => {
  const u = new URL(value);
  return u.protocol === 'https:' && !u.username && !u.password && !u.hash;
});
export const researchDraft = z.object({
  id: itemId, title: text(240), publisher: text(160), canonicalUrl: url,
  geography: z.array(text(80)).min(1).max(16), topics: z.array(text(60)).min(1).max(16),
  publishedAt: publicationDate, retrievedAt: date,
  attribution: text(1000), summary: text(4000).nullable(),
  rights: z.object({ mode: z.enum(['unknown','withheld','link_only','summary']),
    evidenceReference: text(1000).nullable(), checkedAt: date, validUntil: date,
    aiAllowed: z.boolean(), note: text(1000) }).strict(),
  reviewDueAt: date,
}).strict().superRefine((value, ctx) => {
  if (value.rights.mode !== 'summary' && value.summary !== null)
    ctx.addIssue({code:'custom',path:['summary'],message:'Summary requires summary rights'});
});
export type ResearchDraft = z.infer<typeof researchDraft>;
export type EditorialState = 'staged' | 'approved' | 'published' | 'withdrawn';
export interface ResearchItem {
  id: string; revision: number; title: string; publisher: string; canonicalUrl: string;
  geography: string[]; topics: string[]; publishedAt: string | null; retrievedAt: string | null;
  reviewedAt: string; reviewDueAt: string; freshness: 'reviewed' | 'review_due';
  attribution: string; contentMode: 'link_only' | 'summary'; summary: string | null;
  readValidUntil:string;
  permissionMetadata: { audience: 'member'; aiAllowed: boolean; fullTextAllowed: false };
}
export class ResearchError extends Error {
  readonly code: 'INVALID_RESEARCH_INPUT' | 'REVISION_CONFLICT' | 'EDITORIAL_STATE_CONFLICT' | 'RIGHTS_NOT_CLEARED' | 'RESEARCH_UNAVAILABLE';
  constructor(code:ResearchError['code']) { super(code);this.code=code; }
}
export function assertPublishable(draft: ResearchDraft, reviewedAt: string | null, now: Date) {
  const r = draft.rights, time = now.getTime();
  if (!['link_only','summary'].includes(r.mode) || !r.evidenceReference || !r.checkedAt ||
    Date.parse(r.checkedAt) > time || !r.validUntil || Date.parse(r.validUntil) <= time ||
    !reviewedAt || Date.parse(reviewedAt) > time || !draft.reviewDueAt || Date.parse(draft.reviewDueAt) <= time ||
    (r.mode === 'summary' && !draft.summary) ||
    (draft.retrievedAt !== null && Date.parse(draft.retrievedAt) > time) ||
    (draft.publishedAt !== null && Date.parse(draft.publishedAt) > time)) throw new ResearchError('RIGHTS_NOT_CLEARED');
}
export function permittedItem(draft: ResearchDraft, revision: number, reviewedAt: string): ResearchItem {
  return { id:draft.id, revision, title:draft.title, publisher:draft.publisher,
    canonicalUrl:draft.canonicalUrl, geography:[...draft.geography], topics:[...draft.topics],
    publishedAt:draft.publishedAt, retrievedAt:draft.retrievedAt, reviewedAt,
    reviewDueAt:draft.reviewDueAt!, freshness:'reviewed', attribution:draft.attribution,
    contentMode:draft.rights.mode as 'link_only'|'summary',
    summary:draft.rights.mode === 'summary' ? draft.summary : null,
    readValidUntil:new Date(Math.min(Date.parse(draft.rights.validUntil!),Date.parse(draft.reviewDueAt!))).toISOString(),
    permissionMetadata:{audience:'member',aiAllowed:draft.rights.aiAllowed,fullTextAllowed:false} };
}
export const editorialCommand = z.discriminatedUnion('action', [
  z.object({action:z.literal('stage'),expectedRevision:z.number().int().min(0).max(2147483646),
    reason:text(500),draft:researchDraft}).strict(),
  z.object({action:z.enum(['approve','publish','withdraw']),id:itemId,
    expectedRevision:z.number().int().min(1).max(2147483646),reason:text(500)}).strict(),
]);
export type EditorialCommand = z.infer<typeof editorialCommand>;
export interface ResearchCatalog {
  revision: number; items: ResearchItem[];
  coverage: {status:'available'|'no_data'}; pagination:{offset:number;limit:number;hasMore:boolean};
}
