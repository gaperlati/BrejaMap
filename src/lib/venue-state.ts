/**
 * Pure venue/bounds helpers used by the home page hooks (merge of loaded venues,
 * filtering and sorting of the list).
 *
 * Kept free of React/Next/browser imports so it can be tested with `node --test`.
 */

import type { BeerType, PriceFilter, SortOption, Venue } from "../types";
import type { VenueFromAPI } from "./api";
import { distanceKm, expandBounds, type Bounds } from "./geo";

export const BEER_TYPE_LABELS: Record<BeerType, string> = {
  chope: "Chope",
  long_neck: "Long neck",
  lata: "Lata",
  garrafa: "Garrafa",
  outro: "Outro",
};

/** Max external (Google) venues to keep in state; evict oldest by id when exceeded to avoid unbounded growth. */
export const MAX_EXTERNAL_VENUES = 300;
/** Expand bounds slightly for filtering the list so it matches what user sees on screen. */
export const LIST_BOUNDS_OVERSCAN_FACTOR = 1.05;

/** Rounded bbox key for cache (~1.1 km grid) so nearby pans reuse data anywhere in the world. */
export function bboxCacheKey(bounds: Bounds): string {
  const { south, west, north, east } = bounds;
  return `${south.toFixed(2)},${west.toFixed(2)},${north.toFixed(2)},${east.toFixed(2)}`;
}

/** Approximate visible bounds from center + zoom (used when map instance is not ready yet). */
export function boundsFromCenterAndZoom(
  center: { lat: number; lng: number },
  zoom: number
): Bounds {
  const deg = 360 / Math.pow(2, zoom);
  const halfLat = (deg * 0.6) / 2;
  const halfLng = deg / 2;
  return {
    south: center.lat - halfLat,
    north: center.lat + halfLat,
    west: center.lng - halfLng,
    east: center.lng + halfLng,
  };
}

export function getMinBeerPrice(venue: Venue): number {
  if (venue.beerPrices.length === 0) return Infinity;
  return Math.min(...venue.beerPrices.map((p) => p.priceBRL));
}

export function apiVenueToVenue(v: VenueFromAPI): Venue {
  return {
    ...v,
    beerPrices: (v.beerPrices ?? []).map((p) => ({
      type: p.type as BeerType,
      label: p.label,
      priceBRL: p.priceBRL,
      volumeMl: p.volumeMl,
    })),
    hasHappyHour: v.hasHappyHour ?? false,
  };
}

export function venueKeyByPlace(venue: Venue): string {
  return `${venue.name.trim().toLowerCase()}|${venue.lat.toFixed(5)}|${venue.lng.toFixed(5)}`;
}

export function isFromExternal(venue: Venue): boolean {
  return Boolean(venue.fromOsm || venue.fromGoogle);
}

function placeScore(venue: Venue): number {
  return (
    (venue.userAdded ? 100 : 0) +
    (venue.beerPrices.length > 0 ? 10 : 0) +
    Date.parse(venue.createdAt)
  );
}

/**
 * Merges freshly loaded external venues into the current state: external venues
 * already in state keep their prices, the external set is capped at `maxExternal`
 * (oldest evicted first) and venues at the same place are deduplicated, preferring
 * user-added, then priced, then newer entries.
 */
export function mergeExternalVenues(
  prevVenues: Venue[],
  newVenues: Venue[],
  maxExternal: number = MAX_EXTERNAL_VENUES
): Venue[] {
  const byId = new Map<string, Venue>(newVenues.map((v) => [v.id, v]));
  const rest = prevVenues.filter((v) => !isFromExternal(v));
  const external = prevVenues.filter(isFromExternal);
  for (const v of external) {
    const existing = byId.get(v.id);
    if (existing) {
      if (v.beerPrices.length > 0) byId.set(v.id, v);
    } else {
      byId.set(v.id, v);
    }
  }
  let merged = Array.from(byId.values());
  if (merged.length > maxExternal) {
    merged = merged.slice(-maxExternal);
  }
  // Defensive dedupe: avoid repeated cards when the same venue is merged many times
  // (e.g. repeated API responses during pan/zoom or local fallback entries).
  const byPlace = new Map<string, Venue>();
  for (const venue of [...rest, ...merged]) {
    const key = venueKeyByPlace(venue);
    const current = byPlace.get(key);
    if (!current || placeScore(venue) >= placeScore(current)) {
      byPlace.set(key, venue);
    }
  }
  return Array.from(byPlace.values());
}

/** Venues inside the (slightly expanded) visible map bounds. */
export function filterVenuesInBounds(venues: Venue[], mapBounds: Bounds): Venue[] {
  const b = expandBounds(mapBounds, LIST_BOUNDS_OVERSCAN_FACTOR);
  return venues.filter(
    (v) => v.lat >= b.south && v.lat <= b.north && v.lng >= b.west && v.lng <= b.east
  );
}

/** Sorted, de-duplicated neighborhood names of the given venues. */
export function extractNeighborhoods(venuesInBounds: Venue[]): string[] {
  const set = new Set(venuesInBounds.map((v) => v.neighborhood.trim()).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export interface VenueFilterOptions {
  mapBounds: Bounds;
  maxPrice: PriceFilter;
  beerType: BeerType | "";
  neighborhood: string;
  happyHourOnly: boolean;
  sort: SortOption;
  userLocation: { lat: number; lng: number } | null;
  mapCenter: { lat: number; lng: number };
}

/** Venues visible on the map that pass the filters, in the requested order. */
export function filterAndSortVenues(venues: Venue[], options: VenueFilterOptions): Venue[] {
  const { maxPrice, beerType, neighborhood, happyHourOnly, sort } = options;
  let list = filterVenuesInBounds(venues, options.mapBounds);

  if (maxPrice != null) {
    list = list.filter((v) => getMinBeerPrice(v) <= maxPrice);
  }
  if (beerType) {
    list = list.filter((v) => v.beerPrices.some((p) => p.type === beerType));
  }
  if (neighborhood) {
    list = list.filter(
      (v) => v.neighborhood.toLowerCase() === neighborhood.toLowerCase()
    );
  }
  if (happyHourOnly) {
    list = list.filter((v) => v.hasHappyHour);
  }

  if (sort === "price_asc") {
    list.sort((a, b) => getMinBeerPrice(a) - getMinBeerPrice(b));
  } else if (sort === "price_desc") {
    list.sort((a, b) => getMinBeerPrice(b) - getMinBeerPrice(a));
  } else if (sort === "name") {
    list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  } else if (sort === "distance") {
    // Without a known user position, "nearest" means nearest to the map center.
    const origin = options.userLocation ?? options.mapCenter;
    const dist = new Map(list.map((v) => [v.id, distanceKm(origin, v)]));
    list.sort((a, b) => dist.get(a.id)! - dist.get(b.id)!);
  }
  return list;
}
