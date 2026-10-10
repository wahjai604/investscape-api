import type {ResearchSql} from './sql.ts';
import type {ResearchSession} from './auth.ts';
import type {ResearchAuthority} from './router.ts';
export const researchUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fresh minimal server projection. No subscription, occupational role, profile metadata or map grant lookup. */
export class PostgresResearchAuthority implements ResearchAuthority {
  private readonly db:ResearchSql;private readonly issuer:string;private readonly now:()=>number;
  constructor(db:ResearchSql,issuer:string,now=()=>Date.now()/1000){
    if(!/^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/.test(issuer))throw Error('RESEARCH_UNAVAILABLE');
    this.db=db;this.issuer=issuer;this.now=now;
  }
  async resolve(session:ResearchSession){
    if(session.issuer!==this.issuer||!researchUuid.test(session.subject)||!researchUuid.test(session.sessionId)||
      !Number.isFinite(session.expiresAt)||session.expiresAt<=this.now())return {member:false,editor:false};
    try{
      const r=await this.db.query('SELECT ready,member,editor FROM research_private.resolve_access($1,$2::uuid,$3::uuid)',
        [session.issuer,session.subject,session.sessionId]);
      const row=r.rows[0];
      if(r.rows.length!==1||row?.ready!==true||typeof row.member!=='boolean'||typeof row.editor!=='boolean')throw Error('RESEARCH_UNAVAILABLE');
      if(session.expiresAt<=this.now())return {member:false,editor:false};
      return {member:row.member,editor:row.member&&row.editor};
    }catch{throw Error('RESEARCH_UNAVAILABLE');}
  }
}
