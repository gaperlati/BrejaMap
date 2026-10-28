/**
 * Pure selection logic for GET /api/venues: dedupe of repeated rows and the prioritized cap
 * applied when a bounding box holds more venues than one response may return.
 *
 * Free of Next.js/Supabase imports so it can be tested with `node --test`.
 */

import type { Venue } from "../types";
import type { Bounds } from "./geo";

export function venueDedupKey(venue: Venue): string {
  const normalizedName = venue.name.trim().toLowerCase();
  // ~1m precision to collapse duplicated rows for same place
  const latKey = venue.lat.toFixed(5);
  const lngKey = venue.lng.toFixed(5);
  return `${normalizedName}|${latKey}|${lngKey}`;
}

export function pickPreferredVenue(current: Venue, candidate: Venue): Venue {
  // Prefer user-added rows, then rows with beer prices, then most recent row.
  const score = (v: Venue): number =>
    (v.userAdded ? 100 : 0) + (v.beerPrices.length > 0 ? 10 : 0) + Date.parse(v.createdAt);
  return score(candidate) >= score(current) ? candidate : current;
}

/** Collapses venues at the same place into one entry (see `pickPreferredVenue`). */
export function dedupeVenuesByPlace(venues: Venue[]): Venue[] {
  const dedupedByPlace = new Map<string, Venue>();
  for (const venue of venues) {
    const key = venueDedupKey(venue);
    const current = dedupedByPlace.get(key);
    dedupedByPlace.set(key, current ? pickPreferredVenue(current, venue) : venue);
  }
  return Array.from(dedupedByPlace.values());
}

/** 0 = has prices, 1 = user-added without prices, 2 = everything else (e.g. OSM imports). */
export function venueTier(venue: Venue): 0 | 1 | 2 {
  if (venue.beerPrices.length > 0) return 0;
  if (venue.userAdded) return 1;
  return 2;
}

/**
 * Squared equirectangular distance in degrees (longitude scaled by cos(latitude)).
 * Only used to rank venues inside a small bbox, where it orders like the real distance.
 */
function rankDistance(center: { lat: number; lng: number }, venue: Venue): number {
  const dLat = venue.lat - center.lat;
  const dLng = (venue.lng - center.lng) * Math.cos((center.lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

export interface VenueSelection {
  venues: Venue[];
  /** True when the bbox holds more venues than were returned. */
  truncated: boolean;
}

/**
 * Keeps at most `cap` venues: priced first, then user-added, then the rest, each tier ordered
 * by distance to the bounds centre (ties broken by id so the result is deterministic).
 * `moreInDatabase` signals that the candidate list itself was cut by a query limit, so the
 * response is truncated even when the candidates fit under the cap.
 */
export function selectVenuesForBounds(
  candidates: Venue[],
  bounds: Bounds,
  cap: number,
  moreInDatabase = false
): VenueSelection {
  const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
  const ranked = candidates
    .map((venue) => ({ venue, tier: venueTier(venue), dist: rankDistance(center, venue) }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.dist - b.dist ||
        (a.venue.id < b.venue.id ? -1 : a.venue.id > b.venue.id ? 1 : 0)
    )
    .map((r) => r.venue);
  return {
    venues: ranked.slice(0, cap),
    truncated: moreInDatabase || ranked.length > cap,
  };
}
