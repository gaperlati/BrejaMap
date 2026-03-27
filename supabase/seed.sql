-- Seed: insert the mock bars so "Buscar bares" and pan/zoom return data.
-- Run this once in Supabase SQL Editor after 001_venues_and_beer_prices.sql.
-- (If you run it again you'll get duplicate key errors; truncate venues first if you need to re-seed.)

-- 1. Bar do Zé
INSERT INTO public.venues (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, user_added, source)
VALUES (
  'a0000001-0001-4000-8000-000000000001',
  'Bar do Zé',
  'Rua Augusta, 1234 - Consolação',
  'Consolação',
  'São Paulo',
  'SP',
  -23.5505,
  -46.6333,
  true,
  'Seg–Sex 17h–20h: chope R$ 6',
  false,
  'user'
);
INSERT INTO public.beer_prices (venue_id, type, label, price_brl, volume_ml)
VALUES
  ('a0000001-0001-4000-8000-000000000001', 'chope', 'Chope', 8, 300),
  ('a0000001-0001-4000-8000-000000000001', 'long_neck', 'Long neck', 10, 355),
  ('a0000001-0001-4000-8000-000000000001', 'lata', 'Lata', 7, 350);

-- 2. Boteco Vila Madalena
INSERT INTO public.venues (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, user_added, source)
VALUES (
  'a0000001-0001-4000-8000-000000000002',
  'Boteco Vila Madalena',
  'Rua Harmonia, 567',
  'Vila Madalena',
  'São Paulo',
  'SP',
  -23.5489,
  -46.6882,
  true,
  'Ter–Qui 18h–21h: 2 chopes pelo preço de 1',
  false,
  'user'
);
INSERT INTO public.beer_prices (venue_id, type, label, price_brl, volume_ml)
VALUES
  ('a0000001-0001-4000-8000-000000000002', 'chope', 'Chope', 12, 300),
  ('a0000001-0001-4000-8000-000000000002', 'long_neck', 'Long neck', 14, 355);

-- 3. Cervejaria Pinheiros
INSERT INTO public.venues (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, user_added, source)
VALUES (
  'a0000001-0001-4000-8000-000000000003',
  'Cervejaria Pinheiros',
  'Rua dos Pinheiros, 800',
  'Pinheiros',
  'São Paulo',
  'SP',
  -23.5634,
  -46.6932,
  false,
  false,
  'user'
);
INSERT INTO public.beer_prices (venue_id, type, label, price_brl, volume_ml)
VALUES
  ('a0000001-0001-4000-8000-000000000003', 'chope', 'Chope', 9, 300),
  ('a0000001-0001-4000-8000-000000000003', 'lata', 'Lata', 6.5, 350),
  ('a0000001-0001-4000-8000-000000000003', 'garrafa', 'Garrafa 600ml', 15, 600);

-- 4. Bar do Centro
INSERT INTO public.venues (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, user_added, source)
VALUES (
  'a0000001-0001-4000-8000-000000000004',
  'Bar do Centro',
  'Praça da Sé, 100',
  'Sé',
  'São Paulo',
  'SP',
  -23.5504,
  -46.6339,
  true,
  'Todo dia 11h–14h: chope R$ 4,50',
  false,
  'user'
);
INSERT INTO public.beer_prices (venue_id, type, label, price_brl, volume_ml)
VALUES
  ('a0000001-0001-4000-8000-000000000004', 'chope', 'Chope', 5.5, 300),
  ('a0000001-0001-4000-8000-000000000004', 'lata', 'Lata', 5, 350);

-- 5. Bar do Mané
INSERT INTO public.venues (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, user_added, source)
VALUES (
  'a0000001-0001-4000-8000-000000000005',
  'Bar do Mané',
  'Av. Paulista, 500',
  'Bela Vista',
  'São Paulo',
  'SP',
  -23.5615,
  -46.6559,
  false,
  false,
  'user'
);
INSERT INTO public.beer_prices (venue_id, type, label, price_brl, volume_ml)
VALUES
  ('a0000001-0001-4000-8000-000000000005', 'chope', 'Chope', 14, 300),
  ('a0000001-0001-4000-8000-000000000005', 'long_neck', 'Long neck', 18, 355);

-- 6. Bar Central Campinas
INSERT INTO public.venues (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, user_added, source)
VALUES (
  'a0000001-0001-4000-8000-000000000006',
  'Bar Central Campinas',
  'Rua José Paulino, 1000',
  'Centro',
  'Campinas',
  'SP',
  -22.9099,
  -47.0626,
  true,
  'Seg–Sex 18h–20h: chope R$ 5',
  false,
  'user'
);
INSERT INTO public.beer_prices (venue_id, type, label, price_brl, volume_ml)
VALUES
  ('a0000001-0001-4000-8000-000000000006', 'chope', 'Chope', 7.5, 300),
  ('a0000001-0001-4000-8000-000000000006', 'lata', 'Lata', 6, 350);

-- 7. Bar Faria Lima (template) — Av. Brigadeiro Faria Lima, 949
INSERT INTO public.venues (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, user_added, source)
VALUES (
  'a0000001-0001-4000-8000-000000000007',
  'Bar Faria Lima (template)',
  'Av. Brigadeiro Faria Lima, 949',
  'Itaim Bibi',
  'São Paulo',
  'SP',
  -23.5689,
  -46.6895,
  true,
  'Seg–Sex 18h–20h: chope R$ 9',
  false,
  'user'
);
INSERT INTO public.beer_prices (venue_id, type, label, price_brl, volume_ml)
VALUES
  ('a0000001-0001-4000-8000-000000000007', 'chope', 'Chope Heineken', 11.5, 300),
  ('a0000001-0001-4000-8000-000000000007', 'long_neck', 'Long neck Stella', 13, 355),
  ('a0000001-0001-4000-8000-000000000007', 'lata', 'Brahma lata', 8.5, 350);
