-- BrejaMap: stable external identity for imported venues (e.g. OpenStreetMap)
-- Run after 001_venues_and_beer_prices.sql, in Supabase SQL Editor or via supabase db push.
-- Safe to run more than once.

-- Nullable: existing rows and user-added venues keep external_id = null.
-- Imported rows use a typed id such as 'osm-node-123', 'osm-way-123' or 'osm-relation-123'.
alter table public.venues add column if not exists external_id text;

-- Unique (nulls are distinct, so any number of rows may have null).
-- The import script relies on it for INSERT ... ON CONFLICT (external_id) DO NOTHING,
-- which makes repeated or concurrent imports idempotent.
create unique index if not exists venues_external_id_key on public.venues(external_id);
