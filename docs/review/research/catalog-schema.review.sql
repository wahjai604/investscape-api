-- Review proposal ONLY. Not selected/applied to Supabase or a Railway database.
-- Run only against an empty disposable database for offline acceptance.
BEGIN;
CREATE ROLE research_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE research_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE research_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE SCHEMA research_private AUTHORIZATION research_owner;
REVOKE ALL ON SCHEMA research_private FROM PUBLIC;
GRANT USAGE ON SCHEMA research_private TO research_reader,research_writer;
CREATE TABLE research_private.catalog(singleton boolean PRIMARY KEY CHECK(singleton),revision integer NOT NULL CHECK(revision>=0));
INSERT INTO research_private.catalog VALUES(true,0);
CREATE TABLE research_private.items(id text PRIMARY KEY,revision integer NOT NULL CHECK(revision>0));
CREATE TABLE research_private.revisions(id text REFERENCES research_private.items(id),revision integer NOT NULL,
  draft jsonb NOT NULL,state text NOT NULL CHECK(state IN('staged','approved','published','withdrawn')),
  reviewed_at timestamptz,PRIMARY KEY(id,revision));
CREATE TABLE research_private.publications(id text PRIMARY KEY,revision integer NOT NULL,item jsonb NOT NULL,
  rights_valid_until timestamptz NOT NULL,review_due_at timestamptz NOT NULL,
  FOREIGN KEY(id,revision) REFERENCES research_private.revisions(id,revision));
CREATE TABLE research_private.audit(catalog_revision integer PRIMARY KEY,id text NOT NULL,revision integer NOT NULL,
  actor text NOT NULL,action text NOT NULL CHECK(action IN('stage','approve','publish','withdraw')),
  reason text NOT NULL,occurred_at timestamptz NOT NULL,FOREIGN KEY(id,revision) REFERENCES research_private.revisions(id,revision));
REVOKE ALL ON ALL TABLES IN SCHEMA research_private FROM PUBLIC;
ALTER TABLE research_private.catalog OWNER TO research_owner;
ALTER TABLE research_private.items OWNER TO research_owner;
ALTER TABLE research_private.revisions OWNER TO research_owner;
ALTER TABLE research_private.publications OWNER TO research_owner;
ALTER TABLE research_private.audit OWNER TO research_owner;
DO $$ DECLARE gateway text; BEGIN
  FOR gateway IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA research_private FROM %I',gateway);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA research_private FROM %I',gateway);
  END LOOP;
END $$;
ALTER TABLE research_private.catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.items FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.publications FORCE ROW LEVEL SECURITY;
ALTER TABLE research_private.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_private.audit FORCE ROW LEVEL SECURITY;
GRANT SELECT ON research_private.catalog,research_private.publications TO research_reader;
CREATE POLICY catalog_read ON research_private.catalog FOR SELECT TO research_reader USING(true);
CREATE POLICY publications_read ON research_private.publications FOR SELECT TO research_reader
  USING(rights_valid_until>statement_timestamp() AND review_due_at>statement_timestamp());
GRANT SELECT,UPDATE ON research_private.catalog TO research_writer;
GRANT SELECT,INSERT,UPDATE ON research_private.items,research_private.revisions TO research_writer;
GRANT SELECT,INSERT,UPDATE,DELETE ON research_private.publications TO research_writer;
GRANT SELECT,INSERT ON research_private.audit TO research_writer;
CREATE POLICY catalog_write ON research_private.catalog TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY items_write ON research_private.items TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY revisions_write ON research_private.revisions TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY publications_write ON research_private.publications TO research_writer USING(true) WITH CHECK(true);
CREATE POLICY audit_read ON research_private.audit FOR SELECT TO research_writer USING(true);
CREATE POLICY audit_append ON research_private.audit FOR INSERT TO research_writer WITH CHECK(true);
-- Audit has no UPDATE/DELETE grant. Readers cannot inspect drafts, evidence, reviewer subjects or audit.
-- Before any live provisioning, separately verify default ACLs, inherited roles, owner memberships and exposed schemas.
COMMIT;
