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

/** Positive when `a` should be kept over `b`: user-added, then priced, then most recent. */
export function comparePlacePriority(a: Venue, b: Venue): number {
  return (
    Number(!!a.userAdded) - Number(!!b.userAdded) ||
    Number(a.beerPrices.length > 0) - Number(b.beerPrices.length > 0) ||
    (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
  );
}

export function pickPreferredVenue(current: Venue, candidate: Venue): Venue {
  // Prefer user-added rows, then rows with beer prices, then most recent row (ties: candidate).
  return comparePlacePriority(candidate, current) >= 0 ? candidate : current;
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

/** Two OpenStreetMap entries with the same name closer than this are shown as one bar. */
export const OSM_NEAR_DUPLICATE_METERS = 25;

function metersBetween(a: Venue, b: Venue): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  return Math.sqrt(dLat * dLat + dLng * dLng) * 6_371_000;
}

/**
 * Display-only merge of OpenStreetMap near-duplicates: OSM sometimes maps one bar twice (a node
 * and a building way, or two nodes) a few metres apart under the same name. Such pairs are shown
 * once (see `pickPreferredVenue`); nothing is deleted. User-added venues are never merged here.
 */
export function collapseOsmNearDuplicates(
  venues: Venue[],
  maxMeters: number = OSM_NEAR_DUPLICATE_METERS
): Venue[] {
  const kept: Venue[] = [];
  const osmByName = new Map<string, number[]>();
  for (const venue of venues) {
    if (!venue.fromOsm) {
      kept.push(venue);
      continue;
    }
    const name = venue.name.trim().toLowerCase();
    const indexes = osmByName.get(name) ?? [];
    const twin = indexes.find((i) => metersBetween(kept[i], venue) <= maxMeters);
    if (twin !== undefined) {
      kept[twin] = pickPreferredVenue(kept[twin], venue);
      continue;
    }
    indexes.push(kept.length);
    osmByName.set(name, indexes);
    kept.push(venue);
  }
  return kept;
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
