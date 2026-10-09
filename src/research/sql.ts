import type { Pool } from 'pg';
import { ResearchError } from './model.ts';
export interface ResearchSql {
  query<T extends Record<string,unknown> = Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[]}>;
}
export interface ResearchDatabase extends ResearchSql {
  transaction<T>(work:(sql:ResearchSql)=>Promise<T>):Promise<T>;
}
/** Credentials, TLS configuration and scoped pools belong to a separately reviewed runtime host. */
export class PgResearchDatabase implements ResearchDatabase {
  private readonly pool:Pool;
  constructor(pool:Pool) {this.pool=pool;}
  async query<T extends Record<string,unknown>>(sql:string,values:unknown[]=[]){return this.pool.query<T>(sql,values);}
  async transaction<T>(work:(sql:ResearchSql)=>Promise<T>){
    const client=await this.pool.connect().catch(()=>{throw new ResearchError('RESEARCH_UNAVAILABLE');});let destroy=false;
    try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){try{await client.query('ROLLBACK');}catch{destroy=true;}
      if(error instanceof ResearchError)throw error;throw new ResearchError('RESEARCH_UNAVAILABLE');}
    finally{try{client.release(destroy);}catch{throw new ResearchError('RESEARCH_UNAVAILABLE');}}
  }
}
