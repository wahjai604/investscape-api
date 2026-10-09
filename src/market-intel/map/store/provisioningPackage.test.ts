import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const folder = new URL('../../../../docs/review/map-provisioning/', import.meta.url);
const sql = await readFile(new URL('001-private-map.review.sql', folder), 'utf8');
const manifest = JSON.parse(await readFile(new URL('package.json', folder), 'utf8'));
async function fixture() {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE ROLE authenticator;
      CREATE SCHEMA unrelated; CREATE TABLE unrelated.marker (id integer);
      INSERT INTO unrelated.marker VALUES (1);
      SET mi_map.provisioning_receipt='synthetic-review-only';`);
    return pg;
}
async function denied(pg: PGlite, query: string, pattern: RegExp) {
    await assert.rejects(pg.exec(query), pattern);
    await pg.exec('ROLLBACK; RESET ROLE;');
}

test('review manifest pins exact candidate bytes and unchanged source draft', async () => {
    assert.equal(createHash('sha256').update(sql).digest('hex'), manifest.candidateSha256);
    const source = await readFile(new URL('../../../../docs/review/map-store-schema.sql', import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(source).digest('hex'), manifest.sourceDraftSha256);
    assert.equal(manifest.status, 'review-only-not-applied');
});

test('exact candidate assigns explicit private owner and separate disabled runtime principals', async () => {
    const pg = await fixture();
    try {
        await pg.exec(sql);
        const roles = await pg.query<{rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean}>(
          "SELECT rolname,rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname LIKE 'mi_map_%'");
        assert.equal(roles.rows.length, 6);
        assert(roles.rows.every(r=>!r.rolcanlogin && !r.rolsuper && !r.rolbypassrls));
        const objects = await pg.query<{owner: string; relrowsecurity: boolean; relforcerowsecurity: boolean}>(
          "SELECT pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND c.relkind='r'");
        assert.equal(objects.rows.length,9);
        assert(objects.rows.every(r=>r.owner==='mi_map_owner' && r.relrowsecurity && r.relforcerowsecurity));
        const members = await pg.query<{role: string; member: string; admin_option: boolean; inherit_option: boolean; set_option: boolean}>(
          "SELECT r.rolname AS role,m.rolname AS member,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE m.rolname IN ('mi_map_reader_login','mi_map_access_login')");
        assert.equal(members.rows.length,2);
        assert(members.rows.every(r=>!r.admin_option && r.inherit_option && !r.set_option));
        assert.deepEqual(members.rows.map(r=>[r.member,r.role]).sort(),[
          ['mi_map_access_login','mi_map_access_writer'],['mi_map_reader_login','mi_map_reader']]);
        await pg.exec('SET ROLE mi_map_owner');
        const receipt = await pg.query<{version: string; receipt_ref: string}>('SELECT version,receipt_ref FROM mi_map_private.schema_receipts');
        assert.deepEqual(receipt.rows,[{version:'map-private-v1',receipt_ref:'synthetic-review-only'}]);
        await denied(pg,'DELETE FROM mi_map_private.schema_receipts',/MAP_IMMUTABLE_RECORD/);
        assert.deepEqual((await pg.query('SELECT * FROM unrelated.marker')).rows,[{id:1}]);
        for (const role of ['mi_map_reader_login','mi_map_access_login','anon','authenticated','service_role','authenticator']) {
            await pg.exec(`SET ROLE ${role}`);
            await denied(pg,'SELECT * FROM mi_map_private.schema_receipts',/permission denied/);
        }
        await pg.exec('SET ROLE mi_map_reader_login');
        assert.deepEqual((await pg.query('SELECT * FROM mi_map_private.member_grants')).rows,[]);
        await denied(pg,'SELECT * FROM mi_map_private.approval_audit',/permission denied/);
        await pg.exec('SET ROLE mi_map_access_login');
        assert.deepEqual((await pg.query('SELECT * FROM mi_map_private.approval_audit')).rows,[]);
        await denied(pg,'SELECT * FROM mi_map_private.source_products',/permission denied/);
    } finally { await pg.close(); }
});

test('operator-name fixture variant works with non-superuser CREATEROLE authority', async () => {
    const pg = await fixture();
    try {
        // PGlite's bootstrap postgres cannot lose SUPERUSER. Substitute only the fixed operator name.
        await pg.exec(`CREATE ROLE fixture_operator CREATEROLE BYPASSRLS;
          DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO fixture_operator',current_database()); END $$;
          SET ROLE fixture_operator;`);
        await pg.exec(sql.replace(/\bpostgres\b/g,'fixture_operator'));
        const role = await pg.query<{rolsuper: boolean; rolcreaterole: boolean}>(
          "SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname='fixture_operator'");
        assert.deepEqual(role.rows,[{rolsuper:false,rolcreaterole:true}]);
        assert.equal((await pg.query("SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname='mi_map_private'")).rows[0].n,1);
    } finally { await pg.close(); }
});

test('receipt guard rolls back all DDL without a supplied review reference', async () => {
    const pg = await fixture();
    try {
        await pg.exec('RESET mi_map.provisioning_receipt');
        await denied(pg,sql,/MAP_PROVISIONING_RECEIPT_REQUIRED/);
        assert.equal((await pg.query("SELECT count(*)::integer AS n FROM pg_roles WHERE rolname LIKE 'mi_map_%'")).rows[0].n,0);
    } finally { await pg.close(); }
});

test('name collision and repeated application leave existing objects intact', async () => {
    const pg = await fixture();
    try {
        await pg.exec('CREATE ROLE mi_map_reader');
        await denied(pg,sql,/MAP_PROVISIONING_NAME_COLLISION/);
        assert.equal((await pg.query("SELECT count(*)::integer AS n FROM pg_roles WHERE rolname LIKE 'mi_map_%'")).rows[0].n,1);
        await pg.exec('DROP ROLE mi_map_reader'); // Disposable fixture only; candidate never drops/reuses roles.
        await pg.exec(sql);
        await denied(pg,sql,/MAP_PROVISIONING_NAME_COLLISION/);
        await pg.exec('SET ROLE mi_map_owner');
        assert.equal((await pg.query('SELECT count(*)::integer AS n FROM mi_map_private.schema_receipts')).rows[0].n,1);
    } finally { await pg.close(); }
});

test('explicit final revokes defeat synthetic global table/function exposure defaults', async () => {
    const pg = await fixture();
    try {
        // Adversarial fixture variant only: deliberately inject defaults for the new owner.
        const hostile = sql.replace('SET LOCAL ROLE mi_map_owner;', `SET LOCAL ROLE mi_map_owner;
          ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
          ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC,anon,authenticated,service_role;`);
        await pg.exec(hostile);
        for(const role of ['anon','authenticated','service_role','authenticator']) {
            const result = await pg.query<{accessible: boolean}>(
              "SELECT bool_or(has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS accessible FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mi_map_private' AND c.relkind='r'",[role]);
            assert.equal(result.rows[0].accessible,false);
        }
        // Defaults are deliberately left unchanged; every future create needs its own revokes.
        assert((await pg.query('SELECT * FROM pg_default_acl WHERE defaclnamespace=0')).rows.length>0);
    } finally { await pg.close(); }
});
