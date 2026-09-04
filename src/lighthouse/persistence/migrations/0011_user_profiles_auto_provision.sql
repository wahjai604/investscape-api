-- Migration 0011. Applied 2026-09-04, same day as 0008/0009/0010.
--
-- 0010 created investscape.user_profiles but nothing ever inserts a row into
-- it. A user can sign up through Supabase Auth (a real auth.users row is
-- created by GoTrue) and never get a matching user_profiles row at all,
-- because 0010's RLS on user_profiles requires auth.uid() = owner_id for
-- INSERT — which means the client itself would have to insert its own
-- profile row after signup, and nothing currently does. Any code that
-- assumes a profile row exists for every authenticated user (e.g. a
-- `select first_name from investscape.user_profiles` in a WeWeb screen)
-- would silently see nothing for a freshly signed-up user. This migration
-- closes that gap at the database level, so profile existence does not
-- depend on any particular client remembering to create one.
--
-- Scope, per Eric's explicit decision: the auto-created row sets ONLY
-- owner_id (from NEW.id) and email (from NEW.email). Every other column
-- (first_name, last_name, country) stays NULL, and role keeps 0010's
-- table-level DEFAULT 'Investor' rather than being set here. Supabase Auth's
-- raw_user_meta_data is not populated by anything in this codebase today, so
-- seeding first_name/last_name/country from it would be dead code dressed up
-- as a feature — there is no signup flow yet that puts real values there.
-- Add that mapping in a later migration once a real signup form actually
-- writes to raw_user_meta_data, not before.
--
-- Why SECURITY DEFINER is necessary and safe here:
--   - A trigger function runs with the privileges of whichever role fires
--     it. This trigger fires AFTER INSERT ON auth.users, which happens
--     inside GoTrue's own signup transaction — the calling role has no
--     standing grant to write into investscape.user_profiles (0010 scoped
--     that table's grants to `authenticated`/RLS-checked writes, not to
--     GoTrue's internal role), so a SECURITY INVOKER trigger would fail on
--     every signup.
--   - SECURITY DEFINER makes this function run as its owner (postgres, the
--     role this migration runs as) instead, which can write anywhere. That
--     is only acceptable because the function's entire body is fixed and
--     narrow: it can NEVER be invoked directly by a client (it is not
--     GRANTed EXECUTE to anon/authenticated, and Postgres does not let an
--     ordinary session fire an AFTER INSERT ON auth.users trigger except by
--     actually inserting into auth.users, which only GoTrue/the postgres
--     role can do). It writes exactly one row, with exactly two values, both
--     taken from NEW — the very row auth.users itself just accepted as a
--     genuine new signup. There is no user-suppliable parameter, no dynamic
--     SQL, and no way to point it at a different table or a different
--     owner_id than the row that triggered it.
--   - search_path is pinned explicitly (not inherited from the caller) so a
--     SECURITY DEFINER function can't be tricked by a session-local
--     search_path into resolving investscape.user_profiles to some other
--     object.
--
-- Idempotent by design: ON CONFLICT (owner_id) DO NOTHING. A profile row
-- should never already exist for a brand new auth.users id, but a trigger
-- that could ever raise and abort the signup transaction would be a worse
-- failure mode than a silent no-op, so this never throws on the conflict
-- path.

CREATE OR REPLACE FUNCTION investscape.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = investscape, pg_temp
AS $$
BEGIN
  INSERT INTO investscape.user_profiles (owner_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (owner_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Not GRANTed to anon/authenticated on purpose — this function must only
-- ever run as the trigger's implicit invocation, never be callable directly
-- by a client session.
REVOKE ALL ON FUNCTION investscape.handle_new_auth_user() FROM PUBLIC;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION investscape.handle_new_auth_user();
