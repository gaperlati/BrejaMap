/**
 * Server-only helpers shared by the /api/venues routes: row mapping and input validation.
 */

import { NextResponse } from "next/server";
import type { RpcClient } from "@/lib/venue-writes";
import { consumeRateLimits, type RateLimitCheck } from "@/lib/write-guards";

export { type VenueRow, type BeerPriceRow, rowToVenue } from "@/lib/venue-rows";

export { sanitizeBeerPrices, MAX_BEER_PRICES } from "@/lib/price-validation";

export const MAX_HAPPY_HOUR_DETAILS_LEN = 160;
export const MAX_NAME_LEN = 80;
export const MAX_ADDRESS_FIELD_LEN = 200;

/** Largest bbox (in degrees per side) a GET may request; the map only asks at zoom >= 12. */
export const MAX_BOUNDS_SPAN_DEG = 2;
/** Hard cap on venues returned by GET (priced first, then user-added, then nearest). */
export const MAX_VENUES_PER_REQUEST = 500;
/**
 * Rows fetched per priority tier before ranking (Supabase's default PostgREST max-rows is 1000).
 * A tier with more rows than this in the bbox only ranks the newest ones by distance.
 */
export const MAX_VENUE_CANDIDATES_PER_TIER = 1000;

export { isUuid } from "@/lib/ids";

/** Shared with the client so "Adicionar bar" can warn before the server rejects the point. */
export { isInsideSpState } from "@/lib/geo";

/** Trimmed string, or "" when the value is missing / not a string. Truncated to maxLen. */
export function cleanString(value: unknown, maxLen: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

/**
 * Master kill switch: in production every write (create, edit, report) answers 403 unless
 * `USER_EDITS_ENABLED=true`. Unset it to turn all writes off instantly.
 * Returns a 403 response when blocked, or null when writes are allowed.
 */
export function writesBlockedResponse(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.USER_EDITS_ENABLED !== "true") {
    return NextResponse.json({ error: "User edits are disabled in production" }, { status: 403 });
  }
  return null;
}

/** 401 for POST /api/venues without a valid `Authorization: Bearer <access_token>`. */
export function authRequiredResponse(): NextResponse {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

/**
 * Counts the request against the given rate limits. Returns a 429 (with `Retry-After`) when a
 * limit is exhausted, a 500 when the limits can't be checked (fails closed), or null to proceed.
 */
export async function rateLimitedResponse(
  client: RpcClient,
  checks: RateLimitCheck[]
): Promise<NextResponse | null> {
  const result = await consumeRateLimits(client, checks);
  if (result.ok) return null;
  if (result.reason === "limited") {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
    );
  }
  return NextResponse.json({ error: "Failed to check rate limit" }, { status: 500 });
}
