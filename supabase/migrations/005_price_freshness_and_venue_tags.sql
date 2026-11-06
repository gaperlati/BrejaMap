-- BrejaMap: price freshness, venue attributes (football, reservations, outdoor area, opening
-- hours), favorites and ratings.
-- Run after 004_auth_rate_limits_and_moderation.sql, in Supabase SQL Editor or via supabase db push.
-- Apply it BEFORE deploying the code that uses it (GET /api/venues keeps working without it, but
-- every write answers 500 until the new function signatures exist).
-- Safe to run more than once (if not exists / create or replace / drop if exists / idempotent grants).
--
-- What it does:
-- 1. beer_prices.updated_at: when the price was last entered or confirmed in BrejaMap. Existing
--    rows get their created_at (the only date we know; it is not when the price was observed).
-- 2. Nullable venue attributes (null = unknown): transmits_football, accepts_reservations,
--    has_outdoor_area and opening_hours (jsonb weekly map, validated by the API).
-- 3. update_venue_and_prices / create_venue_with_prices take p_attributes (jsonb): only the keys
--    present are written, a JSON null clears the value. Replacing prices keeps the row (id and
--    updated_at) of every price that did not change, so editing one price does not refresh the
--    freshness of the others. An edit that really changes the prices clears needs_review (the
--    correction answers "Sinalizar preços incorretos"; a later report sets it again). Confirming
--    a price does not clear it.
-- 4. confirm_beer_price(): "Ainda é esse preço? Sim" bumps one price's updated_at.
-- 5. favorites and ratings tables (RLS on, no policies: only the API's service role reaches them)
--    and venue_rating_summaries() for the map.

-- 1. Price freshness ----------------------------------------------------------------------------

alter table public.beer_prices add column if not exists updated_at timestamptz;
update public.beer_prices set updated_at = created_at where updated_at is null;
alter table public.beer_prices alter column updated_at set default now();
alter table public.beer_prices alter column updated_at set not null;

-- 2. Venue attributes ---------------------------------------------------------------------------

alter table public.venues add column if not exists transmits_football boolean;
alter table public.venues add column if not exists accepts_reservations boolean;
alter table public.venues add column if not exists has_outdoor_area boolean;
alter table public.venues add column if not exists opening_hours jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'venues_opening_hours_is_object'
  ) then
    alter table public.venues add constraint venues_opening_hours_is_object
      check (opening_hours is null or jsonb_typeof(opening_hours) = 'object');
  end if;
end;
$$;

-- Writes the attribute keys present in p_attributes (JSON null clears). Returns true when any
-- key was present. Shape of each value is validated by the API; types are re-checked here.
create or replace function public.apply_venue_attributes(p_venue_id uuid, p_attributes jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_attributes is null or p_attributes = '{}'::jsonb then
    return false;
  end if;
  if jsonb_typeof(p_attributes) is distinct from 'object' then
    raise exception 'p_attributes must be a json object' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_attributes) loop
    if v_key in ('transmits_football', 'accepts_reservations', 'has_outdoor_area') then
      if jsonb_typeof(p_attributes -> v_key) not in ('boolean', 'null') then
        raise exception 'invalid venue attribute %', v_key using errcode = '22023';
      end if;
    elsif v_key = 'opening_hours' then
      if jsonb_typeof(p_attributes -> v_key) not in ('object', 'null') then
        raise exception 'invalid venue attribute %', v_key using errcode = '22023';
      end if;
    else
      raise exception 'unknown venue attribute %', v_key using errcode = '22023';
    end if;
  end loop;

  update public.venues
  set
    transmits_football = case when p_attributes ? 'transmits_football'
      then (p_attributes ->> 'transmits_football')::boolean else transmits_football end,
    accepts_reservations = case when p_attributes ? 'accepts_reservations'
      then (p_attributes ->> 'accepts_reservations')::boolean else accepts_reservations end,
    has_outdoor_area = case when p_attributes ? 'has_outdoor_area'
      then (p_attributes ->> 'has_outdoor_area')::boolean else has_outdoor_area end,
    opening_hours = case when p_attributes ? 'opening_hours'
      then nullif(p_attributes -> 'opening_hours', 'null'::jsonb) else opening_hours end
  where id = p_venue_id;

  return true;
end;
$$;

comment on function public.apply_venue_attributes(uuid, jsonb) is
  'Internal helper of the venue write functions: writes the attribute keys present in p_attributes.';

-- Replaces a venue's prices with p_prices, keeping the existing row (id, created_at, updated_at)
-- of each incoming price identical to a stored one; other stored rows are deleted and new
-- prices are inserted with updated_at = now(). Returns true when any price was added or removed.
-- (Dropped first so the return type can change if an older draft returned void.)
drop function if exists public.replace_venue_prices(uuid, jsonb);
create or replace function public.replace_venue_prices(p_venue_id uuid, p_prices jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_price record;
  v_match uuid;
  v_keep uuid[] := '{}';
  v_changed boolean := false;
begin
  if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) = 0 then
    raise exception 'p_prices must be a non-empty json array' using errcode = '22023';
  end if;

  for v_price in
    select x.type, x.label, x.price_brl, x.volume_ml
    from jsonb_to_recordset(p_prices) as x(type text, label text, price_brl numeric(10,2), volume_ml integer)
  loop
    select bp.id into v_match
    from public.beer_prices bp
    where bp.venue_id = p_venue_id
      and bp.type = v_price.type
      and bp.label = v_price.label
      and bp.price_brl = v_price.price_brl
      and bp.volume_ml is not distinct from v_price.volume_ml
      and not (bp.id = any(v_keep))
    order by bp.created_at, bp.id
    limit 1;

    if v_match is null then
      insert into public.beer_prices (venue_id, type, label, price_brl, volume_ml, updated_at)
      values (p_venue_id, v_price.type, v_price.label, v_price.price_brl, v_price.volume_ml, now())
      returning id into v_match;
      v_changed := true;
    end if;
    v_keep := v_keep || v_match;
  end loop;

  delete from public.beer_prices where venue_id = p_venue_id and not (id = any(v_keep));
  return v_changed or found;
end;
$$;

comment on function public.replace_venue_prices(uuid, jsonb) is
  'Internal helper of update_venue_and_prices: replaces prices while keeping unchanged rows (and their updated_at).';

-- {venue, beer_prices} payload shared by the write functions.
create or replace function public.venue_write_payload(p_venue_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
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
$$;

-- 3. Write functions with attributes ------------------------------------------------------------

-- The signatures change, so the 004 versions are dropped (create or replace cannot add params).
drop function if exists public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb, uuid);
drop function if exists public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb, uuid);

-- Same contract as in 004, plus p_attributes; unchanged prices keep their updated_at.
create or replace function public.update_venue_and_prices(
  p_venue_id uuid,
  p_update_happy_hour boolean default false,
  p_has_happy_hour boolean default false,
  p_happy_hour_details text default null,
  p_replace_prices boolean default false,
  p_prices jsonb default '[]'::jsonb,
  p_edited_by uuid default null,
  p_attributes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_attributes_changed boolean;
  v_prices_changed boolean := false;
  v_happy_hour_changed boolean := false;
begin
  -- Lock the row so concurrent edits of the same venue are serialized.
  perform 1 from public.venues where id = p_venue_id for update;
  if not found then
    return null;
  end if;

  if p_update_happy_hour then
    -- Only a real change counts: resubmitting the same happy hour is not an edit.
    update public.venues v
    set
      has_happy_hour = p_has_happy_hour,
      happy_hour_details = case
        when p_has_happy_hour then nullif(btrim(p_happy_hour_details), '')
        else null
      end
    where v.id = p_venue_id
      and (v.has_happy_hour, v.happy_hour_details) is distinct from (
        p_has_happy_hour,
        case when p_has_happy_hour then nullif(btrim(p_happy_hour_details), '') else null end
      );
    v_happy_hour_changed := found;
  end if;

  if p_replace_prices then
    v_prices_changed := public.replace_venue_prices(p_venue_id, p_prices);
  end if;

  v_attributes_changed := public.apply_venue_attributes(p_venue_id, p_attributes);

  if v_happy_hour_changed or v_prices_changed or v_attributes_changed then
    update public.venues
    set
      prices_unverified = true,
      -- A real correction answers "Sinalizar preços incorretos"; a later report sets it again.
      needs_review = case when v_prices_changed then false else needs_review end,
      last_edited_by = p_edited_by,
      last_edited_at = now()
    where id = p_venue_id;
  end if;

  return public.venue_write_payload(p_venue_id);
end;
$$;

comment on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb, uuid, jsonb) is
  'Atomically updates happy hour, venue attributes and/or replaces the beer prices of a venue (unchanged prices keep updated_at), marking it as community-edited; a real price change clears needs_review. Returns {venue, beer_prices}, or null when the venue does not exist. Used by PATCH /api/venues/[id].';

-- Same contract as in 004, plus p_attributes.
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
  p_created_by uuid default null,
  p_attributes jsonb default '{}'::jsonb
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

  perform public.apply_venue_attributes(v_venue_id, p_attributes);

  return public.venue_write_payload(v_venue_id);
end;
$$;

comment on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb, uuid, jsonb) is
  'Atomically creates a user-added venue (with its creator, attributes and initial beer prices). Returns {venue, beer_prices}. Used by POST /api/venues.';

-- 4. Price confirmation -------------------------------------------------------------------------

-- "Ainda é esse preço? Sim": bumps updated_at of one price of the venue. Returns null when the
-- venue or the price does not exist (e.g. the price was edited meanwhile and got a new id), so a
-- stale page can never confirm a price it did not show.
create or replace function public.confirm_beer_price(p_venue_id uuid, p_price_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.venues where id = p_venue_id for update;
  if not found then
    return null;
  end if;

  update public.beer_prices set updated_at = now()
  where id = p_price_id and venue_id = p_venue_id;
  if not found then
    return null;
  end if;

  return public.venue_write_payload(p_venue_id);
end;
$$;

comment on function public.confirm_beer_price(uuid, uuid) is
  'Marks one beer price as still valid (updated_at = now()). Returns {venue, beer_prices}, or null when the venue/price pair does not exist. Used by POST /api/venues/[id]/confirm.';

-- 5. Favorites and ratings ----------------------------------------------------------------------

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

create table if not exists public.ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

create index if not exists idx_favorites_venue_id on public.favorites(venue_id);
create index if not exists idx_ratings_venue_id on public.ratings(venue_id);

-- Average (1 decimal) and count of ratings per venue, for the given venues only.
create or replace function public.venue_rating_summaries(p_venue_ids uuid[])
returns table (venue_id uuid, rating_avg numeric, rating_count integer)
language sql
stable
set search_path = ''
as $$
  select r.venue_id, round(avg(r.score)::numeric, 1), count(*)::integer
  from public.ratings r
  where r.venue_id = any(p_venue_ids)
  group by r.venue_id;
$$;

comment on function public.venue_rating_summaries(uuid[]) is
  'Rating average and count per venue. Used by GET /api/venues and the rating routes.';

-- RLS on with no policies (same model as 004): only the API's service role reads/writes them.
alter table public.favorites enable row level security;
alter table public.ratings enable row level security;
revoke all on table public.favorites from anon, authenticated;
revoke all on table public.ratings from anon, authenticated;

-- Only the server (service role) may call these functions.
revoke all on function public.apply_venue_attributes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_venue_attributes(uuid, jsonb) to service_role;

revoke all on function public.replace_venue_prices(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_venue_prices(uuid, jsonb) to service_role;

revoke all on function public.venue_write_payload(uuid) from public, anon, authenticated;
grant execute on function public.venue_write_payload(uuid) to service_role;

revoke all on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb, uuid, jsonb)
  to service_role;

revoke all on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb, uuid, jsonb)
  to service_role;

revoke all on function public.confirm_beer_price(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_beer_price(uuid, uuid) to service_role;

revoke all on function public.venue_rating_summaries(uuid[]) from public, anon, authenticated;
grant execute on function public.venue_rating_summaries(uuid[]) to service_role;
