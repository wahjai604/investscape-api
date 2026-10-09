import { researchDraft,assertPublishable,permittedItem,ResearchError,editorialCommand,
  type EditorialCommand,type ResearchCatalog,type ResearchItem,type ResearchDraft } from './model.ts';
import type { ResearchDatabase,ResearchSql } from './sql.ts';

export interface ResearchQuery {q?:string;geography?:string;topic?:string;offset?:number;limit?:number;}
export interface ResearchReader {
  list(query:ResearchQuery):Promise<ResearchCatalog>;
  detail(id:string,consumer?:'member'|'ai'):Promise<{revision:number;item:ResearchItem|null}>;
}
export interface ResearchEditor {
  change(actor:string,command:EditorialCommand):Promise<{id:string;revision:number;catalogRevision:number;state:string}>;
  inspect(id:string):Promise<Record<string,unknown>|null>;
}
async function dbNow(sql:ResearchSql){
  const row=(await sql.query('SELECT clock_timestamp() AS now')).rows[0];
  const now=new Date(row?.now as string|Date);
  if(!Number.isFinite(now.getTime()))throw new ResearchError('RESEARCH_UNAVAILABLE');return now;
}
/** Dedicated private store proposal. No database discovery, live seed records or public Data API path. */
export class PostgresResearchStore implements ResearchReader,ResearchEditor {
  private readonly db:ResearchDatabase;
  constructor(db:ResearchDatabase){this.db=db;}
  async inspect(id:string){
    const result=await this.db.query(`SELECT i.id,i.revision,r.draft,r.state,r.reviewed_at,
      (SELECT COALESCE(jsonb_agg(a ORDER BY a.catalog_revision),'[]'::jsonb) FROM
        (SELECT catalog_revision,revision,actor,action,reason,occurred_at FROM research_private.audit
          WHERE id=i.id ORDER BY catalog_revision DESC LIMIT 30) a) AS audit
      FROM research_private.items i JOIN research_private.revisions r ON r.id=i.id AND r.revision=i.revision WHERE i.id=$1`,[id]);
    return result.rows[0]??null;
  }
  async change(actor:string,input:EditorialCommand){
    const parsed=editorialCommand.safeParse(input);
    if(!parsed.success||typeof actor!=='string'||!actor||actor.length>256)throw new ResearchError('INVALID_RESEARCH_INPUT');
    const command=parsed.data,id=command.action==='stage'?command.draft.id:command.id;
    return this.db.transaction(async sql=>{
      // Single catalog lock orders every publication/withdrawal and commits audit and pointer together.
      const catalog=(await sql.query('SELECT revision FROM research_private.catalog WHERE singleton=true FOR UPDATE')).rows[0];
      if(!catalog)throw new ResearchError('RESEARCH_UNAVAILABLE');
      const item=(await sql.query('SELECT revision FROM research_private.items WHERE id=$1 FOR UPDATE',[id])).rows[0];
      const revision=Number(item?.revision??0);
      if(revision!==command.expectedRevision)throw new ResearchError('REVISION_CONFLICT');
      const now=await dbNow(sql),catalogRevision=Number(catalog.revision)+1;
      let nextRevision=revision,state:string;
      if(command.action==='stage'){
        nextRevision=revision+1;state='staged';
        await sql.query('INSERT INTO research_private.items(id,revision) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision',[id,nextRevision]);
        await sql.query("INSERT INTO research_private.revisions(id,revision,draft,state) VALUES($1,$2,$3::jsonb,'staged')",[id,nextRevision,JSON.stringify(command.draft)]);
      }else{
        const row=(await sql.query('SELECT draft,state,reviewed_at FROM research_private.revisions WHERE id=$1 AND revision=$2',[id,revision])).rows[0];
        if(!row)throw new ResearchError('EDITORIAL_STATE_CONFLICT');
        const draft=researchDraft.parse(row.draft),reviewedAt=row.reviewed_at ? new Date(row.reviewed_at as string|Date).toISOString():null;
        if(command.action==='approve'){
          if(row.state!=='staged')throw new ResearchError('EDITORIAL_STATE_CONFLICT');
          assertPublishable(draft,now.toISOString(),now);state='approved';
          await sql.query("UPDATE research_private.revisions SET state='approved',reviewed_at=$3 WHERE id=$1 AND revision=$2",[id,revision,now.toISOString()]);
        }else if(command.action==='publish'){
          if(row.state!=='approved')throw new ResearchError('EDITORIAL_STATE_CONFLICT');
          assertPublishable(draft,reviewedAt,now);state='published';
          await sql.query("UPDATE research_private.revisions SET state='published' WHERE id=$1 AND revision=$2",[id,revision]);
          await sql.query(`INSERT INTO research_private.publications(id,revision,item,rights_valid_until,review_due_at)
            VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,
            item=EXCLUDED.item,rights_valid_until=EXCLUDED.rights_valid_until,review_due_at=EXCLUDED.review_due_at`,
            [id,revision,JSON.stringify(permittedItem(draft,revision,reviewedAt!)),draft.rights.validUntil,draft.reviewDueAt]);
        }else{
          if(row.state==='withdrawn')throw new ResearchError('EDITORIAL_STATE_CONFLICT');state='withdrawn';
          // Withdraw the item, including any older active revision while a correction is staged.
          await sql.query("UPDATE research_private.revisions SET state='withdrawn' WHERE id=$1 AND state IN ('staged','approved','published')",[id]);
          await sql.query('DELETE FROM research_private.publications WHERE id=$1',[id]);
        }
      }
      await sql.query('UPDATE research_private.catalog SET revision=$1 WHERE singleton=true',[catalogRevision]);
      await sql.query(`INSERT INTO research_private.audit(catalog_revision,id,revision,actor,action,reason,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[catalogRevision,id,nextRevision,actor,command.action,command.reason,now.toISOString()]);
      return {id,revision:nextRevision,catalogRevision,state};
    });
  }
  private async read(query:ResearchQuery,id:string|null,consumer:'member'|'ai'){
    const limit=query.limit??25,offset=query.offset??0;
    if(!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(offset)||offset<0||offset>10000||
      [query.q,query.geography,query.topic].some(v=>v!==undefined&&(typeof v!=='string'||v.length>120)))
      throw new ResearchError('INVALID_RESEARCH_INPUT');
    // One SQL snapshot: no stale in-process catalog cache, hidden metadata or arbitrary article text.
    const rows=await this.db.query(`SELECT c.revision,COALESCE((SELECT jsonb_agg(p.item ORDER BY p.id) FROM
      (SELECT id,item || jsonb_build_object('readValidUntil',least(rights_valid_until,review_due_at,
        statement_timestamp()+interval '30 seconds')) AS item FROM research_private.publications WHERE rights_valid_until>statement_timestamp()
        AND review_due_at>statement_timestamp() AND ($1::text IS NULL OR id=$1)
        AND ($2::text='' OR strpos(lower(item->>'title'),lower($2))>0 OR strpos(lower(item->>'publisher'),lower($2))>0)
        AND ($3::text IS NULL OR item->'geography' ? $3) AND ($4::text IS NULL OR item->'topics' ? $4)
        AND ($5::boolean=false OR item->'permissionMetadata'->>'aiAllowed'='true')
        ORDER BY id LIMIT $6 OFFSET $7) p),'[]'::jsonb) AS items
      FROM research_private.catalog c WHERE c.singleton=true`,
      [id,query.q??'',query.geography??null,query.topic??null,consumer==='ai',limit+1,offset]);
    const row=rows.rows[0];if(!row||!Array.isArray(row.items))throw new ResearchError('RESEARCH_UNAVAILABLE');
    return {revision:Number(row.revision),items:row.items as ResearchItem[],limit,offset};
  }
  async list(query:ResearchQuery={}):Promise<ResearchCatalog>{
    const result=await this.read(query,null,'member'),items=result.items.slice(0,result.limit);
    return {revision:result.revision,items,coverage:{status:items.length?'available':'no_data'},
      pagination:{limit:result.limit,offset:result.offset,hasMore:result.items.length>result.limit}};
  }
  async detail(id:string,consumer:'member'|'ai'='member'){
    const result=await this.read({limit:1},id,consumer);return {revision:result.revision,item:result.items[0]??null};
  }
}
