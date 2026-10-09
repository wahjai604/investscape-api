import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { PgMapDatabase } from './sql.ts';

function fixture(fail?:string) {
  const commands:string[]=[], releases:boolean[]=[];
  const client={query:async(text:string)=>{commands.push(text);if(text===fail)throw Error('private driver detail');return {rows:[]};},
    release:(destroy:boolean)=>{releases.push(destroy);if(fail==='release')throw Error('private cleanup detail');}};
  const pool={connect:async()=>client,query:async()=>{throw Error('transaction must use checked-out client');}};
  return {db:new PgMapDatabase(pool as unknown as Pool),commands,releases};
}
test('transaction uses one checked-out client and releases it after commit',async()=>{
  const f=fixture();assert.equal(await f.db.transaction(async sql=>{await sql.query('work');return 7;}),7);
  assert.deepEqual(f.commands,['BEGIN ISOLATION LEVEL READ COMMITTED','work','COMMIT']);assert.deepEqual(f.releases,[false]);
});
test('failed task rolls back and releases exactly once with static error',async()=>{
  const f=fixture('work');await assert.rejects(f.db.transaction(sql=>sql.query('work')),{message:'MAP_STORE_UNAVAILABLE'});
  assert.deepEqual(f.commands,['BEGIN ISOLATION LEVEL READ COMMITTED','work','ROLLBACK']);assert.deepEqual(f.releases,[false]);
});
test('rollback failure destroys the client and never leaks driver error',async()=>{
  const f=fixture('ROLLBACK');await assert.rejects(f.db.transaction(async()=>{throw Error('private operation');}),{message:'MAP_STORE_UNAVAILABLE'});
  assert.deepEqual(f.releases,[true]);assert.equal(f.commands.filter(c=>c==='ROLLBACK').length,1);
});
test('failed commit rolls back; failed release has a static diagnostic',async()=>{
  const f=fixture('COMMIT');await assert.rejects(f.db.transaction(async()=>1),{message:'MAP_STORE_UNAVAILABLE'});
  assert.equal(f.commands.at(-1),'ROLLBACK');assert.deepEqual(f.releases,[false]);
  const cleanup=fixture('release');await assert.rejects(cleanup.db.transaction(async()=>1),{message:'MAP_STORE_UNAVAILABLE'});
  assert.deepEqual(cleanup.releases,[false]);
});
