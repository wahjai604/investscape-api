-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0014.
--
-- Stage 1 sign-in handoff (src/lighthouse/stage1/launchHandoff.ts). Holds a
-- Relationship OS one-time launch code across the professional's InvestScape
-- sign-in, for at most 10 minutes, single use.
--
-- The code is NEVER stored in plaintext. code_ciphertext is AES-256-GCM under
-- a key derived (HKDF-SHA256) from a random token that exists only in the
-- browser; this table holds SHA-256 of that token for lookup. A dump of this
-- table cannot recover a code. Ciphertext is nulled when the handoff is
-- claimed or expires; rows are deleted one day after expiry.

create table if not exists lighthouse.launch_handoffs (
  handoff_id             text        primary key,
  token_hash             text        not null unique,
  launch_session_id      uuid        not null,
  code_ciphertext        text,
  code_iv                text,
  code_auth_tag          text,
  created_at             timestamptz not null,
  expires_at             timestamptz not null,
  consumed_at            timestamptz,
  consumed_by_actor_ref  text,

  constraint launch_handoff_ttl_bounded
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint launch_handoff_consumed_has_actor
    check (consumed_at is null or consumed_by_actor_ref is not null),
  -- Once consumed, no ciphertext may remain.
  constraint launch_handoff_consumed_is_wiped
    check (consumed_at is null or code_ciphertext is null),
  constraint launch_handoff_cipher_parts_together
    check ((code_ciphertext is null) = (code_iv is null) and (code_iv is null) = (code_auth_tag is null))
);

create index if not exists idx_launch_handoffs_expiry
  on lighthouse.launch_handoffs (expires_at);

comment on table lighthouse.launch_handoffs is
  'Short-lived, single-use sign-in handoff for Relationship OS launches. Code encrypted under a browser-held token; never plaintext.';

do $$
begin
  alter table lighthouse.launch_handoffs enable row level security;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on lighthouse.launch_handoffs from anon, authenticated;
  else
    raise notice 'Skipping revoke on launch_handoffs: browser roles not present';
  end if;
end $$;
