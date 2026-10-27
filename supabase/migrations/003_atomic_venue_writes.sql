-- BrejaMap: atomic venue + beer_prices writes
-- Run after 002_venues_external_id.sql, in Supabase SQL Editor or via supabase db push.
-- Safe to run more than once (create or replace + idempotent grants).
--
-- Why: PATCH /api/venues/[id] used to update the venue, delete its prices and insert the new
-- ones as separate requests, and POST /api/venues inserted the venue and its prices separately.
-- A failure between those steps could leave a venue with its prices deleted (or a new venue
-- with no prices). Each function below runs in a single transaction: either every change is
-- applied or none is. They also return the saved venue and prices, so the API needs only one
-- round-trip.
--
-- Both functions return jsonb shaped as { "venue": <venues row>, "beer_prices": [<rows>] }.
-- p_prices is a jsonb array of { "type", "label", "price_brl", "volume_ml" } objects
-- (already validated by the API; table check constraints still apply).

-- Update happy hour and/or replace all prices of an existing venue.
-- Returns null (and changes nothing) when the venue does not exist, so the API can answer 404.
create or replace function public.update_venue_and_prices(
  p_venue_id uuid,
  p_update_happy_hour boolean default false,
  p_has_happy_hour boolean default false,
  p_happy_hour_details text default null,
  p_replace_prices boolean default false,
  p_prices jsonb default '[]'::jsonb
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

comment on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb) is
  'Atomically updates happy hour and/or replaces all beer prices of a venue. Returns {venue, beer_prices}, or null when the venue does not exist. Used by PATCH /api/venues/[id].';

-- Create a user-added venue together with its initial prices.
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
  p_prices jsonb default '[]'::jsonb
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
    has_happy_hour, happy_hour_details, user_added, source
  )
  values (
    p_name, p_address, p_neighborhood, p_city, p_state, p_lat, p_lng,
    p_has_happy_hour,
    case when p_has_happy_hour then nullif(btrim(p_happy_hour_details), '') else null end,
    true, 'user'
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

comment on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb) is
  'Atomically creates a user-added venue and its initial beer prices. Returns {venue, beer_prices}. Used by POST /api/venues.';

-- Only the server (service role) may call these; the public API routes do the validation.
revoke all on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_venue_and_prices(uuid, boolean, boolean, text, boolean, jsonb)
  to service_role;

revoke all on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_venue_with_prices(text, text, text, text, text, double precision, double precision, boolean, text, jsonb)
  to service_role;
