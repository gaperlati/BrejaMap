/**
 * Server-only helpers shared by the /api/venues routes: row mapping and input validation.
 */

import { NextResponse } from "next/server";
import type { BeerPrice, BeerType } from "@/types";

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
/** Hard cap on rows returned by GET. */
export const MAX_VENUES_PER_REQUEST = 500;

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
 * Public writes stay blocked in production until Supabase Auth/RLS is in place.
 * Returns a 403 response when blocked, or null when writes are allowed.
 * To re-enable writes, set `USER_EDITS_ENABLED=true` in the production environment.
 */
export function writesBlockedResponse(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.USER_EDITS_ENABLED !== "true") {
    return NextResponse.json({ error: "User edits are disabled in production" }, { status: 403 });
  }
  return null;
}
