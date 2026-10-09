-- REVIEW DDL ONLY. Not a migration or deployment script. No live application is authorized.
-- Test in an empty disposable database as its owner. Deliberately fails on name collisions.
-- Future Supabase application requires separate baseline/owner/role/exposure review.
BEGIN;
CREATE ROLE mi_map_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE mi_map_access_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE mi_map_ingester NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA mi_map_private;
REVOKE ALL ON SCHEMA mi_map_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA mi_map_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA mi_map_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE mi_map_private.access_admin_grants (
  grant_id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  active boolean NOT NULL, expires_at timestamptz NOT NULL,
  bootstrap_evidence text NOT NULL CHECK (length(bootstrap_evidence) BETWEEN 1 AND 500),
  UNIQUE (issuer, subject)
);
-- No runtime may bootstrap, appoint or mutate administrators in this slice.
CREATE TABLE mi_map_private.member_grants (
  issuer text NOT NULL CHECK (issuer ~ '^https://[a-z0-9]+\.supabase\.co/auth/v1$'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  grant_id uuid NOT NULL UNIQUE,
  revision integer NOT NULL CHECK (revision > 0),
  approval_method text NOT NULL CHECK (approval_method = 'manual'),
  approved_at timestamptz NOT NULL, approved_by uuid NOT NULL REFERENCES mi_map_private.access_admin_grants(grant_id),
  active boolean NOT NULL DEFAULT true, revoked boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  CHECK (active <> revoked), CHECK (expires_at > approved_at),
  PRIMARY KEY (issuer, subject)
);
CREATE TABLE mi_map_private.approval_audit (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE,
  actor_grant_id uuid NOT NULL REFERENCES mi_map_private.access_admin_grants(grant_id),
  target_issuer text NOT NULL, target_subject text NOT NULL, action text NOT NULL CHECK (action IN ('approve', 'revoke')),
  before_revision integer NOT NULL, after_revision integer NOT NULL CHECK (after_revision = before_revision + 1),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500), occurred_at timestamptz NOT NULL,
  before_state jsonb, after_state jsonb NOT NULL
);

CREATE FUNCTION mi_map_private.audit_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, mi_map_private AS $$
DECLARE administrator uuid; time_now timestamptz := clock_timestamp(); previous integer := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MAP_APPROVAL_DELETE_DENIED'; END IF;
  SELECT grant_id INTO administrator FROM mi_map_private.access_admin_grants
    WHERE issuer = current_setting('mi_map.actor_issuer', true)
      AND subject = current_setting('mi_map.actor_subject', true)
      AND active AND expires_at > time_now FOR SHARE;
  IF administrator IS NULL OR NEW.issuer <> current_setting('mi_map.actor_issuer', true)
    OR COALESCE(current_setting('mi_map.actor_expiry', true), '') = ''
    OR to_timestamp(current_setting('mi_map.actor_expiry')::double precision) <= time_now
    THEN RAISE EXCEPTION 'MAP_APPROVAL_AUTHORITY_DENIED'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.issuer <> OLD.issuer OR NEW.subject <> OLD.subject THEN RAISE EXCEPTION 'MAP_APPROVAL_TARGET_IMMUTABLE'; END IF;
    previous := OLD.revision;
  END IF;
  NEW.revision := previous + 1;
  NEW.approval_method := 'manual';
  IF NEW.active AND NOT NEW.revoked THEN
    NEW.approved_at := time_now; NEW.approved_by := administrator;
  ELSIF TG_OP <> 'UPDATE' OR NOT NEW.revoked OR NEW.active THEN
    RAISE EXCEPTION 'MAP_APPROVAL_STATE_DENIED';
  END IF;
  INSERT INTO mi_map_private.approval_audit
    (request_id, actor_grant_id, target_issuer, target_subject, action, before_revision,
      after_revision, reason, occurred_at, before_state, after_state)
    VALUES (current_setting('mi_map.request_id')::uuid, administrator, NEW.issuer, NEW.subject,
      CASE WHEN NEW.revoked THEN 'revoke' ELSE 'approve' END, previous, NEW.revision,
      current_setting('mi_map.reason'), time_now,
      CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER membership_audit BEFORE INSERT OR UPDATE OR DELETE ON mi_map_private.member_grants
  FOR EACH ROW EXECUTE FUNCTION mi_map_private.audit_membership();

CREATE TABLE mi_map_private.source_products (
  product_id text PRIMARY KEY, provider text NOT NULL, canonical_url text NOT NULL CHECK (canonical_url LIKE 'https://%')
);
CREATE TABLE mi_map_private.rights_controls (
  clearance_id text PRIMARY KEY, product_id text NOT NULL REFERENCES mi_map_private.source_products,
  source_revision_id text NOT NULL, boundary_hash text NOT NULL CHECK (boundary_hash ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('cleared', 'restricted', 'unknown')),
  allow_ui boolean NOT NULL DEFAULT false,
  required_agreement text, valid_until timestamptz NOT NULL,
  evidence_ref text NOT NULL CHECK (length(evidence_ref) > 0), notices jsonb NOT NULL CHECK (jsonb_typeof(notices) = 'array'),
  UNIQUE (clearance_id, product_id, source_revision_id, boundary_hash)
);
-- Immutable, bounded aggregate release. Source artifacts and normalized ingestion are separate later work.
CREATE TABLE mi_map_private.catalog_releases (
  release_id text PRIMARY KEY, layer_id text NOT NULL, geography_id text NOT NULL,
  product_id text NOT NULL REFERENCES mi_map_private.source_products, source_revision_id text NOT NULL,
  boundary_version text NOT NULL, boundary_hash text NOT NULL, crosswalk_ref text NOT NULL,
  clearance_id text NOT NULL, qualified boolean NOT NULL,
  observation_count integer NOT NULL CHECK (observation_count BETWEEN 0 AND 250),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'), parser_version text NOT NULL, definition_version text NOT NULL,
  retrieved_at timestamptz NOT NULL, released_at timestamptz, as_of timestamptz NOT NULL,
  UNIQUE (release_id, layer_id, geography_id),
  FOREIGN KEY (clearance_id, product_id, source_revision_id, boundary_hash)
    REFERENCES mi_map_private.rights_controls (clearance_id, product_id, source_revision_id, boundary_hash)
);
CREATE TABLE mi_map_private.observations (
  release_id text NOT NULL REFERENCES mi_map_private.catalog_releases, ordinal integer NOT NULL CHECK (ordinal >= 0),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  PRIMARY KEY (release_id, ordinal)
);
CREATE UNIQUE INDEX observation_identity ON mi_map_private.observations
  (release_id, (observation->>'metricId'), (observation->>'sourceGeographyId'),
    (observation->>'sourceGeographyVintage'), (observation->>'periodStart'),
    (observation->>'periodEnd'), (observation->'dimensions'));
CREATE TABLE mi_map_private.publication_heads (
  layer_id text NOT NULL, geography_id text NOT NULL, release_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('published', 'withdrawn')), generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  PRIMARY KEY (layer_id, geography_id),
  FOREIGN KEY (release_id, layer_id, geography_id)
    REFERENCES mi_map_private.catalog_releases (release_id, layer_id, geography_id)
);

CREATE FUNCTION mi_map_private.deny_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'MAP_IMMUTABLE_RECORD'; END $$;
CREATE TRIGGER approval_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON mi_map_private.approval_audit
  FOR EACH STATEMENT EXECUTE FUNCTION mi_map_private.deny_mutation();
CREATE TRIGGER release_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON mi_map_private.catalog_releases
  FOR EACH STATEMENT EXECUTE FUNCTION mi_map_private.deny_mutation();
CREATE TRIGGER observation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON mi_map_private.observations
  FOR EACH STATEMENT EXECUTE FUNCTION mi_map_private.deny_mutation();

CREATE FUNCTION mi_map_private.bump_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.layer_id <> OLD.layer_id OR NEW.geography_id <> OLD.geography_id THEN RAISE EXCEPTION 'MAP_HEAD_KEY_IMMUTABLE'; END IF;
  NEW.generation := OLD.generation + 1; RETURN NEW;
END $$;
CREATE TRIGGER head_generation BEFORE UPDATE ON mi_map_private.publication_heads
  FOR EACH ROW EXECUTE FUNCTION mi_map_private.bump_head();
CREATE FUNCTION mi_map_private.bump_rights() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.clearance_id <> OLD.clearance_id OR NEW.product_id <> OLD.product_id OR
    NEW.source_revision_id <> OLD.source_revision_id OR NEW.boundary_hash <> OLD.boundary_hash
    THEN RAISE EXCEPTION 'MAP_RIGHTS_SCOPE_IMMUTABLE'; END IF;
  NEW.revision := OLD.revision + 1; RETURN NEW;
END $$;
CREATE TRIGGER rights_revision BEFORE UPDATE ON mi_map_private.rights_controls
  FOR EACH ROW EXECUTE FUNCTION mi_map_private.bump_rights();

-- Coordinate candidate appends with promotion on the same immutable parent row.
CREATE FUNCTION mi_map_private.guard_observation_append() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, mi_map_private AS $$
BEGIN
  PERFORM release_id FROM mi_map_private.catalog_releases WHERE release_id = NEW.release_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM mi_map_private.publication_heads WHERE release_id = NEW.release_id)
    THEN RAISE EXCEPTION 'MAP_RELEASE_CLOSED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_append BEFORE INSERT ON mi_map_private.observations
  FOR EACH ROW EXECUTE FUNCTION mi_map_private.guard_observation_append();
CREATE FUNCTION mi_map_private.guard_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, mi_map_private AS $$
DECLARE expected integer; qualified_release boolean; observed integer;
BEGIN
  SELECT observation_count, qualified INTO expected, qualified_release FROM mi_map_private.catalog_releases
    WHERE release_id = NEW.release_id FOR UPDATE;
  IF NEW.state = 'published' THEN
    SELECT count(*) INTO observed FROM mi_map_private.observations WHERE release_id = NEW.release_id;
    IF qualified_release IS DISTINCT FROM true OR expected IS DISTINCT FROM observed
      THEN RAISE EXCEPTION 'MAP_RELEASE_INCOMPLETE'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_complete BEFORE INSERT OR UPDATE ON mi_map_private.publication_heads
  FOR EACH ROW EXECUTE FUNCTION mi_map_private.guard_publication();
CREATE TRIGGER publication_history BEFORE DELETE OR TRUNCATE ON mi_map_private.publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION mi_map_private.deny_mutation();

GRANT USAGE ON SCHEMA mi_map_private TO mi_map_reader, mi_map_access_writer, mi_map_ingester;
GRANT SELECT ON mi_map_private.member_grants TO mi_map_reader, mi_map_access_writer;
GRANT SELECT ON mi_map_private.access_admin_grants, mi_map_private.approval_audit TO mi_map_access_writer;
-- SELECT FOR SHARE requires UPDATE privilege on at least one column; RLS denies actual admin UPDATE.
GRANT UPDATE (active) ON mi_map_private.access_admin_grants TO mi_map_access_writer;
GRANT INSERT, UPDATE ON mi_map_private.member_grants TO mi_map_access_writer;
GRANT INSERT ON mi_map_private.approval_audit TO mi_map_access_writer;
GRANT SELECT ON mi_map_private.source_products, mi_map_private.rights_controls,
  mi_map_private.publication_heads, mi_map_private.catalog_releases, mi_map_private.observations TO mi_map_reader;
GRANT INSERT ON mi_map_private.catalog_releases, mi_map_private.observations TO mi_map_ingester;
GRANT SELECT ON mi_map_private.catalog_releases, mi_map_private.publication_heads TO mi_map_ingester;
GRANT UPDATE (qualified) ON mi_map_private.catalog_releases TO mi_map_ingester;

-- RLS is additional protection. No browser/service role receives USAGE, table or function grants.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['access_admin_grants','member_grants','approval_audit','source_products',
    'rights_controls','catalog_releases','observations','publication_heads'] LOOP
    EXECUTE format('ALTER TABLE mi_map_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE mi_map_private.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
CREATE POLICY admin_lookup ON mi_map_private.access_admin_grants FOR SELECT TO mi_map_access_writer USING (true);
CREATE POLICY admin_lock ON mi_map_private.access_admin_grants FOR UPDATE TO mi_map_access_writer
  USING (true) WITH CHECK (false);
CREATE POLICY member_lookup ON mi_map_private.member_grants FOR SELECT TO mi_map_reader, mi_map_access_writer USING (true);
CREATE POLICY member_insert ON mi_map_private.member_grants FOR INSERT TO mi_map_access_writer WITH CHECK (true);
CREATE POLICY member_update ON mi_map_private.member_grants FOR UPDATE TO mi_map_access_writer USING (true) WITH CHECK (true);
CREATE POLICY audit_lookup ON mi_map_private.approval_audit FOR SELECT TO mi_map_access_writer USING (true);
CREATE POLICY audit_append ON mi_map_private.approval_audit FOR INSERT TO mi_map_access_writer
  WITH CHECK (pg_trigger_depth() = 1);
CREATE POLICY product_lookup ON mi_map_private.source_products FOR SELECT TO mi_map_reader USING (true);
CREATE POLICY rights_lookup ON mi_map_private.rights_controls FOR SELECT TO mi_map_reader USING (true);
CREATE POLICY head_lookup ON mi_map_private.publication_heads FOR SELECT TO mi_map_reader USING (true);
CREATE POLICY ingest_head_lookup ON mi_map_private.publication_heads FOR SELECT TO mi_map_ingester USING (true);
CREATE POLICY ingest_release_lookup ON mi_map_private.catalog_releases FOR SELECT TO mi_map_ingester USING (true);
CREATE POLICY ingest_release_lock ON mi_map_private.catalog_releases FOR UPDATE TO mi_map_ingester
  USING (true) WITH CHECK (false);
CREATE POLICY approved_release ON mi_map_private.catalog_releases FOR SELECT TO mi_map_reader USING (
  qualified AND EXISTS (SELECT 1 FROM mi_map_private.publication_heads h
    JOIN mi_map_private.rights_controls r ON r.clearance_id = catalog_releases.clearance_id
    WHERE h.release_id = catalog_releases.release_id AND h.state = 'published'
      AND r.state = 'cleared' AND r.allow_ui AND r.valid_until > clock_timestamp())
);
CREATE POLICY approved_observation ON mi_map_private.observations FOR SELECT TO mi_map_reader USING (
  EXISTS (SELECT 1 FROM mi_map_private.catalog_releases r WHERE r.release_id = observations.release_id)
);
CREATE POLICY candidate_insert ON mi_map_private.catalog_releases FOR INSERT TO mi_map_ingester WITH CHECK (true);
CREATE POLICY observation_insert ON mi_map_private.observations FOR INSERT TO mi_map_ingester WITH CHECK (true);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mi_map_private FROM PUBLIC;
-- Supabase owner defaults may grant browser/service roles explicitly. PUBLIC revocation is insufficient.
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA mi_map_private FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA mi_map_private FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mi_map_private FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA mi_map_private REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA mi_map_private REVOKE EXECUTE ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- Schema-scoped defaults cannot cancel global defaults. Repeat explicit revokes for future objects;
-- audit owner/global defaults and role memberships separately before any live application.
COMMIT;
