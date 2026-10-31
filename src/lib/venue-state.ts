/**
 * Pure venue/bounds helpers used by the home page hooks (merge of loaded venues,
 * filtering and sorting of the list).
 *
 * Kept free of React/Next/browser imports so it can be tested with `node --test`.
 */

import type { BeerPrice, BeerType, PriceFilter, SortOption, Venue } from "../types";
import type { VenueFromAPI } from "./api";
import { distanceKm, expandBounds, type Bounds } from "./geo";

export const BEER_TYPE_LABELS: Record<BeerType, string> = {
  chope: "Chope",
  long_neck: "Long neck",
  lata: "Lata",
  garrafa: "Litrão",
  outro: "Outro",
};

/**
 * Max external (OSM/Google) venues to keep in state; the oldest are evicted when exceeded to
 * avoid unbounded growth. Twice the API cap (500) so a full response plus its neighbours fit.
 */
export const MAX_EXTERNAL_VENUES = 1000;
/** Expand bounds slightly for filtering the list so it matches what user sees on screen. */
export const LIST_BOUNDS_OVERSCAN_FACTOR = 1.05;

/** Rounded bbox key for cache (~1.1 km grid) so nearby pans reuse data anywhere in the world. */
export function bboxCacheKey(bounds: Bounds): string {
  const { south, west, north, east } = bounds;
  return `${south.toFixed(2)},${west.toFixed(2)},${north.toFixed(2)},${east.toFixed(2)}`;
}

export interface VenueCacheEntry {
  venues: Venue[];
  /** The API had more venues in `requestBounds` than it returned. */
  truncated: boolean;
}

interface StoredVenueCacheEntry extends VenueCacheEntry {
  requestBounds: Bounds;
}

function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.south <= inner.south &&
    outer.west <= inner.west &&
    outer.north >= inner.north &&
    outer.east >= inner.east
  );
}

/**
 * Small FIFO cache of GET /api/venues responses keyed by `bboxCacheKey(visible bounds)`.
 * A complete response also answers any view inside the area it was fetched for (zooming in
 * needs no request). A truncated response is only reused for the exact same view: inside it
 * the API may hold venues that were cut, so zooming in must fetch again.
 */
export class VenueBboxCache {
  private readonly entries = new Map<string, StoredVenueCacheEntry>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(bounds: Bounds): VenueCacheEntry | undefined {
    const exact = this.entries.get(bboxCacheKey(bounds));
    if (exact) return { venues: exact.venues, truncated: exact.truncated };
    for (const entry of this.entries.values()) {
      if (!entry.truncated && containsBounds(entry.requestBounds, bounds)) {
        return { venues: entry.venues, truncated: false };
      }
    }
    return undefined;
  }

  set(bounds: Bounds, requestBounds: Bounds, entry: VenueCacheEntry): void {
    const key = bboxCacheKey(bounds);
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey != null) this.entries.delete(firstKey);
    }
    this.entries.set(key, { ...entry, requestBounds });
  }
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

/** Beer type and budget selected in the filters; empty/null fields match any beer. */
export interface BeerPriceCriteria {
  beerType: BeerType | "";
  maxPrice: PriceFilter;
}

export const NO_PRICE_CRITERIA: BeerPriceCriteria = { beerType: "", maxPrice: null };

export function hasPriceCriteria(criteria: BeerPriceCriteria): boolean {
  return criteria.beerType !== "" || criteria.maxPrice != null;
}

/**
 * The venue's beers that satisfy every price criterion at once (type and budget), so a
 * cheap chope does not qualify a bar when the user asked for bottles under a budget.
 * Without criteria this is the full price list.
 */
export function matchingBeerPrices(venue: Venue, criteria: BeerPriceCriteria): BeerPrice[] {
  if (!hasPriceCriteria(criteria)) return venue.beerPrices;
  const { beerType, maxPrice } = criteria;
  return venue.beerPrices.filter(
    (p) => (!beerType || p.type === beerType) && (maxPrice == null || p.priceBRL <= maxPrice)
  );
}

/** Lowest price among the matching beers (`Infinity` when none matches). */
export function getMatchingMinPrice(venue: Venue, criteria: BeerPriceCriteria): number {
  const prices = matchingBeerPrices(venue, criteria);
  if (prices.length === 0) return Infinity;
  return Math.min(...prices.map((p) => p.priceBRL));
}

/** Price order where venues without a (matching) price always go last. */
function comparePrices(a: number, b: number, direction: 1 | -1): number {
  const aPriced = Number.isFinite(a);
  const bPriced = Number.isFinite(b);
  if (aPriced !== bPriced) return aPriced ? -1 : 1;
  if (!aPriced) return 0;
  return (a - b) * direction;
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
 * (previously loaded venues are evicted first, oldest first) and venues at the same place
 * are deduplicated, preferring user-added, then priced, then newer entries.
 */
export function mergeExternalVenues(
  prevVenues: Venue[],
  newVenues: Venue[],
  maxExternal: number = MAX_EXTERNAL_VENUES
): Venue[] {
  const fresh = new Map<string, Venue>(newVenues.map((v) => [v.id, v]));
  const rest = prevVenues.filter((v) => !isFromExternal(v));
  const previousOnly: Venue[] = [];
  for (const v of prevVenues.filter(isFromExternal)) {
    if (!fresh.has(v.id)) previousOnly.push(v);
    else if (v.beerPrices.length > 0) fresh.set(v.id, v);
  }
  // Fresh venues come in API priority order (priced, user-added, nearest): keep them all
  // (up to the cap, head first) and evict previous-only venues, oldest first.
  const freshList = Array.from(fresh.values()).slice(0, maxExternal);
  const keepPrevious = Math.max(0, maxExternal - freshList.length);
  const merged = [...previousOnly.slice(previousOnly.length - keepPrevious), ...freshList];
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

/**
 * Venues visible on the map that pass the filters, in the requested order. Type and budget
 * must be met by the same beer; price sorting uses the cheapest matching beer.
 */
export function filterAndSortVenues(venues: Venue[], options: VenueFilterOptions): Venue[] {
  const { maxPrice, beerType, neighborhood, happyHourOnly, sort } = options;
  const criteria: BeerPriceCriteria = { beerType, maxPrice };
  let list = filterVenuesInBounds(venues, options.mapBounds);

  if (hasPriceCriteria(criteria)) {
    list = list.filter((v) => matchingBeerPrices(v, criteria).length > 0);
  }
  if (neighborhood) {
    list = list.filter(
      (v) => v.neighborhood.toLowerCase() === neighborhood.toLowerCase()
    );
  }
  if (happyHourOnly) {
    list = list.filter((v) => v.hasHappyHour);
  }

  if (sort === "price_asc" || sort === "price_desc") {
    const direction = sort === "price_asc" ? 1 : -1;
    const price = new Map(list.map((v) => [v, getMatchingMinPrice(v, criteria)]));
    list.sort((a, b) => comparePrices(price.get(a)!, price.get(b)!, direction));
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
