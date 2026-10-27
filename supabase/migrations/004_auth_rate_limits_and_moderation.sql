-- BrejaMap: auth, write rate limits and moderation flags
-- Run after 003_atomic_venue_writes.sql, in Supabase SQL Editor or via supabase db push.
-- Safe to run more than once (if not exists / create or replace / idempotent grants).
-- Apply it before setting USER_EDITS_ENABLED=true: without it every write answers 500.
--
-- What it does:
-- 1. Moderation columns on venues: prices_unverified (community-edited prices), needs_review
--    (someone flagged the prices), created_by / last_edited_by / last_edited_at.
-- 2. write_rate_limits + consume_write_rate_limits(): fixed-window counters used by
--    POST /api/venues, PATCH /api/venues/[id] and POST /api/venues/[id]/report.
--    Keys are SHA-256 hashes computed by the API (salted); raw IPs are never stored.
-- 3. create_venue_with_prices gains p_created_by; update_venue_and_prices gains p_edited_by and
--    marks the venue's prices as unverified.
-- 4. flag_venue_for_review(): sets needs_review = true.
-- 5. Row Level Security on every table, with no policies: the browser now gets the public anon
--    key (for login only), so anon/authenticated must not read or write tables directly through
--    PostgREST. All data access goes through the Next.js API, which uses the service role
--    (bypasses RLS).

-- 1. Moderation columns -------------------------------------------------------------------------

alter table public.venues add column if not exists prices_unverified boolean not null default false;
alter table public.venues add column if not exists needs_review boolean not null default false;
alter table public.venues add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.venues add column if not exists last_edited_by uuid references auth.users(id) on delete set null;
alter table public.venues add column if not exists last_edited_at timestamptz;

-- Moderation queue: select * from public.venues where needs_review order by last_edited_at desc;
create index if not exists idx_venues_needs_review on public.venues(needs_review) where needs_review;

-- 2. Rate limits --------------------------------------------------------------------------------

-- One row per (bucket, hashed key). The window restarts when a hit arrives after reset_at.
create table if not exists public.write_rate_limits (
  bucket text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  reset_at timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, key_hash)
);

create index if not exists idx_write_rate_limits_reset_at on public.write_rate_limits(reset_at);

-- p_checks: jsonb array of { "bucket", "key_hash", "max_hits", "window_seconds" }.
-- All checks are evaluated together: if any is exhausted nothing is counted and the result is
-- { "allowed": false, "retry_after_seconds": n }; otherwise every counter is incremented and the
-- result is { "allowed": true, "retry_after_seconds": 0 }.
create or replace function public.consume_write_rate_limits(p_checks jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_check record;
  v_row public.write_rate_limits%rowtype;
  v_retry_after integer := 0;
begin
  if jsonb_typeof(p_checks) is distinct from 'array' or jsonb_array_length(p_checks) = 0 then
    raise exception 'p_checks must be a non-empty json array' using errcode = '22023';
  end if;

  -- Housekeeping: forget windows that ended over a day ago. Skips rows locked by other calls,
  -- so it never waits on (or deadlocks with) a concurrent request.
  delete from public.write_rate_limits w
  using (
    select bucket, key_hash
    from public.write_rate_limits
    where reset_at < v_now - interval '1 day'
    limit 500
    for update skip locked
  ) expired
  where w.bucket = expired.bucket and w.key_hash = expired.key_hash;

  -- Same lock order in every call (bucket, key_hash) to avoid deadlocks.
  for v_check in
    select x.bucket, x.key_hash, x.max_hits, x.window_seconds
    from jsonb_to_recordset(p_checks) as x(bucket text, key_hash text, max_hits integer, window_seconds integer)
    order by x.bucket, x.key_hash
  loop
    if coalesce(v_check.bucket, '') = '' or coalesce(v_check.key_hash, '') = ''
      or coalesce(v_check.max_hits, 0) < 1 or coalesce(v_check.window_seconds, 0) < 1 then
      raise exception 'invalid rate limit check' using errcode = '22023';
    end if;

    -- Creates the counter, or restarts it when its window is over; locks the row either way.
    insert into public.write_rate_limits as w (bucket, key_hash, window_started_at, reset_at, hits)
    values (
      v_check.bucket, v_check.key_hash, v_now,
      v_now + make_interval(secs => v_check.window_seconds), 0
    )
    on conflict (bucket, key_hash) do update
      set window_started_at = excluded.window_started_at,
          reset_at = excluded.reset_at,
          hits = 0
      where w.reset_at <= v_now;

    select * into v_row
    from public.write_rate_limits
    where bucket = v_check.bucket and key_hash = v_check.key_hash
    for update;

    if v_row.hits >= v_check.max_hits then
      v_retry_after := greatest(
        v_retry_after,
        ceil(extract(epoch from v_row.reset_at - v_now))::integer,
        1
      );
    end if;
  end loop;

  if v_retry_after > 0 then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry_after);
  end if;

  update public.write_rate_limits w
  set hits = w.hits + 1
  from jsonb_to_recordset(p_checks) as x(bucket text, key_hash text)
  where w.bucket = x.bucket and w.key_hash = x.key_hash;

  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

comment on function public.consume_write_rate_limits(jsonb) is
  'Atomically checks and counts a set of fixed-window write rate limits. Returns {allowed, retry_after_seconds}. Used by the /api/venues write routes.';

-- 3. Atomic writes with authorship and the unverified flag --------------------------------------

-- The signatures change, so the 003 versions are dropped (create or replace cannot add params).
drop function if exists public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb);
drop function if exists public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb);

-- Same contract as in 003, plus: any change marks the prices as unverified (community edit) and
-- records who edited (null for anonymous edits) and when.
create or replace function public.update_venue_and_prices(
  p_venue_id uuid,
  p_update_happy_hour boolean default false,
  p_has_happy_hour boolean default false,
  p_happy_hour_details text default null,
  p_replace_prices boolean default false,
  p_prices jsonb default '[]'::jsonb,
  p_edited_by uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  -- Lock the row so concurrent edits of the same venue are serialized.
  perform 1 from public.venues where id = p_venue_id for update;
  if not found then
    return null;
  end if;

  if p_replace_prices then
    if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) = 0 then
      raise exception 'p_prices must be a non-empty json array' using errcode = '22023';
    end if;
  end if;

  if p_update_happy_hour then
    update public.venues
    set
      has_happy_hour = p_has_happy_hour,
      happy_hour_details = case
        when p_has_happy_hour then nullif(btrim(p_happy_hour_details), '')
        else null
      end
    where id = p_venue_id;
  end if;

  if p_replace_prices then
    delete from public.beer_prices where venue_id = p_venue_id;

    insert into public.beer_prices (venue_id, type, label, price_brl, volume_ml)
    select p_venue_id, x.type, x.label, x.price_brl, x.volume_ml
    from jsonb_to_recordset(p_prices) as x(type text, label text, price_brl numeric(10,2), volume_ml integer);
  end if;

  if p_update_happy_hour or p_replace_prices then
    update public.venues
    set
      prices_unverified = true,
      last_edited_by = p_edited_by,
      last_edited_at = now()
    where id = p_venue_id;
  end if;

  return jsonb_build_object(
    'venue', (select to_jsonb(v) from public.venues v where v.id = p_venue_id),
    'beer_prices', coalesce(
      (
        select jsonb_agg(to_jsonb(bp) order by bp.created_at, bp.id)
        from public.beer_prices bp
        where bp.venue_id = p_venue_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

comment on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb, uuid) is
  'Atomically updates happy hour and/or replaces all beer prices of a venue, marking its prices as unverified. Returns {venue, beer_prices}, or null when the venue does not exist. Used by PATCH /api/venues/[id].';

-- Same contract as in 003, plus the creator's auth user id.
create or replace function public.create_venue_with_prices(
  p_name text,
  p_address text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_lat double precision,
  p_lng double precision,
  p_has_happy_hour boolean default false,
  p_happy_hour_details text default null,
  p_prices jsonb default '[]'::jsonb,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_venue_id uuid;
begin
  if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) = 0 then
    raise exception 'p_prices must be a non-empty json array' using errcode = '22023';
  end if;

  insert into public.venues (
    name, address, neighborhood, city, state, lat, lng,
    has_happy_hour, happy_hour_details, user_added, source,
    prices_unverified, created_by, last_edited_by, last_edited_at
  )
  values (
    p_name, p_address, p_neighborhood, p_city, p_state, p_lat, p_lng,
    p_has_happy_hour,
    case when p_has_happy_hour then nullif(btrim(p_happy_hour_details), '') else null end,
    true, 'user',
    true, p_created_by, p_created_by, now()
  )
  returning id into v_venue_id;

  insert into public.beer_prices (venue_id, type, label, price_brl, volume_ml)
  select v_venue_id, x.type, x.label, x.price_brl, x.volume_ml
  from jsonb_to_recordset(p_prices) as x(type text, label text, price_brl numeric(10,2), volume_ml integer);

  return jsonb_build_object(
    'venue', (select to_jsonb(v) from public.venues v where v.id = v_venue_id),
    'beer_prices', coalesce(
      (
        select jsonb_agg(to_jsonb(bp) order by bp.created_at, bp.id)
        from public.beer_prices bp
        where bp.venue_id = v_venue_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

comment on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb, uuid) is
  'Atomically creates a user-added venue (with its creator) and its initial beer prices. Returns {venue, beer_prices}. Used by POST /api/venues.';

-- 4. Reports ------------------------------------------------------------------------------------

-- Returns false when the venue does not exist.
create or replace function public.flag_venue_for_review(p_venue_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.venues set needs_review = true where id = p_venue_id;
  return found;
end;
$$;

comment on function public.flag_venue_for_review(uuid) is
  'Marks a venue''s prices for moderator review. Used by POST /api/venues/[id]/report.';

-- Only the server (service role) may call these functions.
revoke all on function public.consume_write_rate_limits(jsonb) from public, anon, authenticated;
grant execute on function public.consume_write_rate_limits(jsonb) to service_role;

revoke all on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb, uuid)
  to service_role;

revoke all on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb, uuid)
  to service_role;

revoke all on function public.flag_venue_for_review(uuid) from public, anon, authenticated;
grant execute on function public.flag_venue_for_review(uuid) to service_role;

-- 5. Row Level Security -------------------------------------------------------------------------

-- No policies on purpose: with RLS on and no policy, anon/authenticated can neither read nor
-- write. The service role used by the API bypasses RLS. The revokes also cover TRUNCATE,
-- which RLS does not govern.
alter table public.venues enable row level security;
alter table public.beer_prices enable row level security;
alter table public.write_rate_limits enable row level security;

revoke all on table public.venues from anon, authenticated;
revoke all on table public.beer_prices from anon, authenticated;
revoke all on table public.write_rate_limits from anon, authenticated;
