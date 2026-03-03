-- BrejaMap: venues and beer_prices tables
-- Run this in Supabase SQL Editor or via supabase db push

-- Venues (bars/pubs)
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  neighborhood text not null default '',
  city text not null default '',
  state text not null default '',
  lat double precision not null,
  lng double precision not null,
  has_happy_hour boolean not null default false,
  happy_hour_details text,
  photo_url text,
  created_at timestamptz not null default now(),
  user_added boolean not null default false,
  source text not null default 'user' check (source in ('user', 'google', 'osm'))
);

-- Beer prices per venue
create table if not exists public.beer_prices (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  type text not null check (type in ('chope', 'long_neck', 'lata', 'garrafa', 'outro')),
  label text not null,
  price_brl numeric(10,2) not null check (price_brl >= 0),
  volume_ml integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_venues_lat_lng on public.venues(lat, lng);
create index if not exists idx_beer_prices_venue_id on public.beer_prices(venue_id);

-- Optional: enable RLS later; for now API uses service role
-- alter table public.venues enable row level security;
-- alter table public.beer_prices enable row level security;
