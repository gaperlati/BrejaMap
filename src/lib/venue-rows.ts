/**
 * Supabase row types and their mapping to the client-facing Venue shape.
 * Free of Next.js imports so it can be unit-tested with plain Node.
 */

import type { Venue, BeerPrice, BeerType, OpeningHours } from "@/types";

export type VenueRow = {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  has_happy_hour: boolean;
  happy_hour_details: string | null;
  photo_url: string | null;
  created_at: string;
  user_added: boolean;
  source: "user" | "google" | "osm";
  /** Added by 004_auth_rate_limits_and_moderation.sql (absent on older databases). */
  prices_unverified?: boolean;
  needs_review?: boolean;
  created_by?: string | null;
  last_edited_by?: string | null;
  last_edited_at?: string | null;
  /** Added by 005_price_freshness_and_venue_tags.sql (null = unknown). */
  transmits_football?: boolean | null;
  accepts_reservations?: boolean | null;
  has_outdoor_area?: boolean | null;
  opening_hours?: OpeningHours | null;
};

export type BeerPriceRow = {
  id: string;
  venue_id: string;
  type: string;
  label: string;
  price_brl: number;
  volume_ml: number | null;
  created_at: string;
  /** Added by 005_price_freshness_and_venue_tags.sql. */
  updated_at?: string | null;
};

/** Rating aggregate for one venue (from public.venue_rating_summaries). */
export type RatingSummary = { avg: number; count: number };

/** Maps a row for the client. Author ids and moderation state are never exposed. */
export function rowToVenue(row: VenueRow, prices: BeerPriceRow[], rating?: RatingSummary): Venue {
  const beerPrices: BeerPrice[] = prices
    .filter((p) => p.venue_id === row.id)
    .map((p) => ({
      id: p.id,
      ...(p.updated_at ? { updatedAt: p.updated_at } : {}),
      type: p.type as BeerType,
      label: p.label,
      priceBRL: Number(p.price_brl),
      volumeMl: p.volume_ml ?? undefined,
    }));
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    lat: row.lat,
    lng: row.lng,
    beerPrices,
    hasHappyHour: row.has_happy_hour,
    happyHourDetails: row.happy_hour_details ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    createdAt: row.created_at,
    userAdded: row.user_added,
    pricesUnverified: row.prices_unverified === true,
    fromOsm: row.source === "osm",
    fromGoogle: row.source === "google",
    ...(row.transmits_football != null ? { transmitsFootball: row.transmits_football } : {}),
    ...(row.accepts_reservations != null ? { acceptsReservations: row.accepts_reservations } : {}),
    ...(row.has_outdoor_area != null ? { hasOutdoorArea: row.has_outdoor_area } : {}),
    ...(row.opening_hours ? { openingHours: row.opening_hours } : {}),
    ...(rating && rating.count > 0 ? { ratingAvg: rating.avg, ratingCount: rating.count } : {}),
  };
}
