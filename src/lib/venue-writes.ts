/**
 * Atomic venue writes through the Postgres functions in
 * supabase/migrations/003_atomic_venue_writes.sql (updated by 004_auth_rate_limits_and_moderation.sql).
 * Free of Next.js imports so it can be unit-tested with a fake client.
 */

import type { BeerPrice, Venue } from "@/types";
import { rowToVenue, type BeerPriceRow, type VenueRow } from "./venue-rows";

/** The slice of the Supabase client used here (lets tests pass a fake). */
export type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type RpcPrice = {
  type: string;
  label: string;
  price_brl: number;
  volume_ml: number | null;
};

export type VenueWriteResult =
  | { ok: true; venue: Venue }
  | { ok: false; reason: "not_found" | "db_error" };

export function toRpcPrices(prices: BeerPrice[]): RpcPrice[] {
  return prices.map((p) => ({
    type: p.type,
    label: p.label,
    price_brl: p.priceBRL,
    volume_ml: p.volumeMl ?? null,
  }));
}

/**
 * Arguments for public.update_venue_and_prices; inputs must already be validated.
 * `editedBy` is the signed-in user's id, or null/omitted for anonymous edits.
 */
export function buildUpdateVenueArgs(
  venueId: string,
  input: { hasHappyHour?: boolean; happyHourDetails: string; beerPrices: BeerPrice[] },
  editedBy: string | null = null
): Record<string, unknown> {
  const updateHappyHour = typeof input.hasHappyHour === "boolean";
  const hasHappyHour = input.hasHappyHour === true;
  return {
    p_venue_id: venueId,
    p_update_happy_hour: updateHappyHour,
    p_has_happy_hour: hasHappyHour,
    p_happy_hour_details: hasHappyHour && input.happyHourDetails ? input.happyHourDetails : null,
    p_replace_prices: input.beerPrices.length > 0,
    p_prices: toRpcPrices(input.beerPrices),
    p_edited_by: editedBy,
  };
}

/**
 * Arguments for public.create_venue_with_prices; inputs must already be validated.
 * `createdBy` is the signed-in user's id (stored in venues.created_by).
 */
export function buildCreateVenueArgs(input: {
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  hasHappyHour: boolean;
  happyHourDetails: string;
  beerPrices: BeerPrice[];
  createdBy: string | null;
}): Record<string, unknown> {
  return {
    p_name: input.name,
    p_address: input.address,
    p_neighborhood: input.neighborhood,
    p_city: input.city,
    p_state: input.state,
    p_lat: input.lat,
    p_lng: input.lng,
    p_has_happy_hour: input.hasHappyHour,
    p_happy_hour_details:
      input.hasHappyHour && input.happyHourDetails ? input.happyHourDetails : null,
    p_prices: toRpcPrices(input.beerPrices),
    p_created_by: input.createdBy,
  };
}

/** Maps the `{ venue, beer_prices }` payload returned by the functions; null when malformed. */
export function parseVenueRpcPayload(data: unknown): Venue | null {
  if (!data || typeof data !== "object") return null;
  const { venue, beer_prices } = data as { venue?: unknown; beer_prices?: unknown };
  if (!venue || typeof venue !== "object" || typeof (venue as VenueRow).id !== "string") {
    return null;
  }
  if (!Array.isArray(beer_prices)) return null;
  return rowToVenue(venue as VenueRow, beer_prices as BeerPriceRow[]);
}

/**
 * Calls one of the atomic write functions. Database errors are logged here and reported only
 * as `db_error`, so routes never forward raw database messages to the client.
 * A null payload means the venue does not exist (nothing was changed).
 */
export async function runVenueWrite(
  client: RpcClient,
  fn: "update_venue_and_prices" | "create_venue_with_prices",
  args: Record<string, unknown>
): Promise<VenueWriteResult> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.rpc(fn, args));
  } catch (e) {
    console.error(`Supabase rpc ${fn} threw:`, e);
    return { ok: false, reason: "db_error" };
  }

  if (error) {
    if ((error as { code?: string }).code === "PGRST202") {
      console.error(
        `Supabase rpc ${fn} not found: run supabase/migrations/003_atomic_venue_writes.sql and 004_auth_rate_limits_and_moderation.sql`
      );
    }
    console.error(`Supabase rpc ${fn} error:`, error);
    return { ok: false, reason: "db_error" };
  }
  if (data == null) return { ok: false, reason: "not_found" };

  const venue = parseVenueRpcPayload(data);
  if (!venue) {
    console.error(`Supabase rpc ${fn} returned an unexpected payload`);
    return { ok: false, reason: "db_error" };
  }
  return { ok: true, venue };
}

export type FlagVenueResult = { ok: true } | { ok: false; reason: "not_found" | "db_error" };

/** Sets venues.needs_review through public.flag_venue_for_review (returns false when missing). */
export async function flagVenueForReview(client: RpcClient, venueId: string): Promise<FlagVenueResult> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.rpc("flag_venue_for_review", { p_venue_id: venueId }));
  } catch (e) {
    console.error("Supabase rpc flag_venue_for_review threw:", e);
    return { ok: false, reason: "db_error" };
  }
  if (error) {
    console.error("Supabase rpc flag_venue_for_review error:", error);
    return { ok: false, reason: "db_error" };
  }
  if (data === true) return { ok: true };
  if (data === false) return { ok: false, reason: "not_found" };
  console.error("Supabase rpc flag_venue_for_review returned an unexpected payload");
  return { ok: false, reason: "db_error" };
}
