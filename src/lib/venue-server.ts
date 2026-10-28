/**
 * Server-only helpers shared by the /api/venues routes: row mapping and input validation.
 */

import { NextResponse } from "next/server";
import type { BeerPrice, BeerType } from "@/types";
import type { RpcClient } from "@/lib/venue-writes";
import { consumeRateLimits, type RateLimitCheck } from "@/lib/write-guards";

export { type VenueRow, type BeerPriceRow, rowToVenue } from "@/lib/venue-rows";

const ALLOWED_BEER_TYPES: BeerType[] = ["chope", "long_neck", "lata", "garrafa", "outro"];
export const MAX_BEER_PRICES = 20;
export const MAX_HAPPY_HOUR_DETAILS_LEN = 160;
export const MAX_NAME_LEN = 80;
export const MAX_ADDRESS_FIELD_LEN = 200;
/** No beer in a bar costs more than this; anything above is a typo or abuse. */
const MAX_PRICE_BRL = 500;
const MAX_VOLUME_ML = 5000;

/**
 * Generous bounding box around São Paulo state. Writes outside it are rejected:
 * the app only targets SP, and it blocks junk coordinates (0,0 etc.).
 */
const SP_STATE_BOUNDS = { south: -25.5, north: -19.5, west: -53.3, east: -44.0 };

/** Largest bbox (in degrees per side) a GET may request; the map only asks at zoom >= 12. */
export const MAX_BOUNDS_SPAN_DEG = 2;
/** Hard cap on venues returned by GET (priced first, then user-added, then nearest). */
export const MAX_VENUES_PER_REQUEST = 500;
/**
 * Rows fetched per priority tier before ranking (Supabase's default PostgREST max-rows is 1000).
 * A tier with more rows than this in the bbox only ranks the newest ones by distance.
 */
export const MAX_VENUE_CANDIDATES_PER_TIER = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isInsideSpState(lat: number, lng: number): boolean {
  return (
    lat >= SP_STATE_BOUNDS.south &&
    lat <= SP_STATE_BOUNDS.north &&
    lng >= SP_STATE_BOUNDS.west &&
    lng <= SP_STATE_BOUNDS.east
  );
}

/** Trimmed string, or "" when the value is missing / not a string. Truncated to maxLen. */
export function cleanString(value: unknown, maxLen: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

/** Keeps only well-formed prices; returns [] when nothing valid was sent. */
export function sanitizeBeerPrices(input: unknown): BeerPrice[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_BEER_PRICES).flatMap((p): BeerPrice[] => {
    if (!p || typeof p !== "object") return [];
    const raw = p as Record<string, unknown>;
    const type = raw.type as BeerType;
    if (!ALLOWED_BEER_TYPES.includes(type)) return [];
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const priceBRL = Number(raw.priceBRL);
    const volumeMl = raw.volumeMl == null ? undefined : Number(raw.volumeMl);

    if (label.length < 1 || label.length > 60) return [];
    if (!Number.isFinite(priceBRL) || priceBRL <= 0 || priceBRL > MAX_PRICE_BRL) return [];
    if (volumeMl != null && (!Number.isFinite(volumeMl) || volumeMl <= 0 || volumeMl > MAX_VOLUME_ML)) {
      return [];
    }
    return [{ type, label, priceBRL: Math.round(priceBRL * 100) / 100, ...(volumeMl != null ? { volumeMl } : {}) }];
  });
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
