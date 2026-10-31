
/**
 * Price-aware map marker decluttering: decides which venues are drawn as individual
 * markers and which ones are grouped into clusters at the current zoom level.
 *
 * Kept free of React/DOM/Google Maps imports so it can be tested with `tsx --test`.
 */

import { formatBRL } from "./format";
import type { Venue } from "../types";

/** World size in pixels at zoom 0 (Google Maps / Web Mercator tile size). */
export const TILE_SIZE = 256;
/** At or above this zoom every venue is drawn individually (closest street zoom). */
export const MAX_CLUSTER_ZOOM = 18;
/** At or above this zoom an isolated unpriced venue gets the full compact pin (not a dot). */
export const UNPRICED_PIN_MIN_ZOOM = 16;

export const SELECTED_Z_INDEX = 1000;
const PRICED_BASE_Z_INDEX = 500;
const PRICED_MIN_Z_INDEX = 101;
const UNPRICED_CLUSTER_Z_INDEX = 100;
const UNPRICED_Z_INDEX = 50;

/** Screen-space collision boxes (marker size plus a small gap), in pixels. */
export const MARKER_BOXES = {
  priced: { width: 60, height: 34 },
  pricedCluster: { width: 72, height: 34 },
  unpriced: { width: 26, height: 26 },
  unpricedCluster: { width: 34, height: 34 },
} as const;

export interface PixelPoint {
  x: number;
  y: number;
}

/** Web Mercator projection of a coordinate into world pixels at the given zoom. */
export function projectToPixels(lat: number, lng: number, zoom: number): PixelPoint {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  // Clamp to avoid infinities at the poles.
  const sinLat = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: scale * (0.5 + lng / 360),
    y: scale * (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)),
  };
}

export type VenueMarkerTier = "selected" | "priced" | "unpriced";

export interface VenueMarkerItem {
  kind: "venue";
  id: string;
  lat: number;
  lng: number;
  venue: Venue;
  minPrice: number;
  tier: VenueMarkerTier;
  /** Unpriced venue drawn as a small dot instead of the full pin (low zoom). */
  compact: boolean;
  zIndex: number;
}

export interface ClusterMarkerItem {
  kind: "cluster";
  /** Stable key derived from the primary (best-priced) venue. */
  id: string;
  lat: number;
  lng: number;
  count: number;
  /** Lowest price among the members (`Infinity` when none has prices). */
  minPrice: number;
  venues: Venue[];
  /** Zoom to apply when the cluster is clicked so its members split apart. */
  expansionZoom: number;
  zIndex: number;
}

export type MapMarkerItem = VenueMarkerItem | ClusterMarkerItem;

export interface ClusterOptions {
  zoom: number;
  selectedVenueId: string | null;
  getMinPrice: (v: Venue) => number;
}

interface Ranked {
  venue: Venue;
  minPrice: number;
  rank: number;
  px: PixelPoint;
}

interface Placed {
  members: Ranked[];
  selected: boolean;
  /** Collision box center in world pixels. */
  px: PixelPoint;
}

function compareRanked(a: Omit<Ranked, "rank">, b: Omit<Ranked, "rank">): number {
  const aPriced = Number.isFinite(a.minPrice);
  const bPriced = Number.isFinite(b.minPrice);
  if (aPriced !== bPriced) return aPriced ? -1 : 1;
  if (aPriced && a.minPrice !== b.minPrice) return a.minPrice - b.minPrice;
  const aUser = a.venue.userAdded ? 1 : 0;
  const bUser = b.venue.userAdded ? 1 : 0;
  if (aUser !== bUser) return bUser - aUser;
  return a.venue.id < b.venue.id ? -1 : a.venue.id > b.venue.id ? 1 : 0;
}

function boxFor(placed: Placed): { width: number; height: number } {
  const priced = Number.isFinite(placed.members[0].minPrice);
  if (placed.members.length > 1) {
    return priced ? MARKER_BOXES.pricedCluster : MARKER_BOXES.unpricedCluster;
  }
  return priced || placed.selected ? MARKER_BOXES.priced : MARKER_BOXES.unpriced;
}

function boxForSingle(r: Ranked): { width: number; height: number } {
  return Number.isFinite(r.minPrice) ? MARKER_BOXES.priced : MARKER_BOXES.unpriced;
}

function collides(
  a: PixelPoint,
  aBox: { width: number; height: number },
  b: PixelPoint,
  bBox: { width: number; height: number }
): boolean {
  return (
    Math.abs(a.x - b.x) < (aBox.width + bBox.width) / 2 &&
    Math.abs(a.y - b.y) < (aBox.height + bBox.height) / 2
  );
}

function pricedZIndex(rank: number): number {
  return Math.max(PRICED_BASE_Z_INDEX - rank, PRICED_MIN_Z_INDEX);
}

function toItem(placed: Placed, zoom: number): MapMarkerItem {
  const primary = placed.members[0];
  if (placed.members.length === 1) {
    const priced = Number.isFinite(primary.minPrice);
    const tier: VenueMarkerTier = placed.selected ? "selected" : priced ? "priced" : "unpriced";
    return {
      kind: "venue",
      id: primary.venue.id,
      lat: primary.venue.lat,
      lng: primary.venue.lng,
      venue: primary.venue,
      minPrice: primary.minPrice,
      tier,
      compact: tier === "unpriced" && zoom < UNPRICED_PIN_MIN_ZOOM,
      zIndex:
        tier === "selected"
          ? SELECTED_Z_INDEX
          : tier === "priced"
            ? pricedZIndex(primary.rank)
            : UNPRICED_Z_INDEX,
    };
  }
  const priced = Number.isFinite(primary.minPrice);
  const venues = placed.members.map((m) => m.venue);
  // Priced clusters stay anchored on the cheapest bar; unpriced-only ones use the centroid.
  const lat = priced ? primary.venue.lat : venues.reduce((s, v) => s + v.lat, 0) / venues.length;
  const lng = priced ? primary.venue.lng : venues.reduce((s, v) => s + v.lng, 0) / venues.length;
  return {
    kind: "cluster",
    id: `cluster:${primary.venue.id}`,
    lat,
    lng,
    count: venues.length,
    minPrice: primary.minPrice,
    venues,
    expansionZoom: Math.min(zoom + 2, MAX_CLUSTER_ZOOM),
    zIndex: priced ? pricedZIndex(primary.rank) : UNPRICED_CLUSTER_Z_INDEX,
  };
}

/**
 * Groups venues whose markers would overlap on screen at `zoom`.
 *
 * Greedy, in priority order: the selected venue is placed first and never absorbed;
 * then priced venues (cheapest first, user-added first, then id) and finally unpriced
 * ones. A venue that collides with an already placed marker joins it as a cluster, so
 * the cheapest bar of a spot always owns the marker. At `zoom >= MAX_CLUSTER_ZOOM`
 * nothing is clustered.
 */
export function clusterMapVenues(venues: Venue[], options: ClusterOptions): MapMarkerItem[] {
  const { zoom, selectedVenueId, getMinPrice } = options;
  const ranked: Ranked[] = venues
    .map((venue) => ({
      venue,
      minPrice: getMinPrice(venue),
      px: projectToPixels(venue.lat, venue.lng, zoom),
    }))
    .sort(compareRanked)
    .map((r, rank) => ({ ...r, rank }));

  const placed: Placed[] = [];
  const selected = ranked.find((r) => r.venue.id === selectedVenueId);
  if (selected) placed.push({ members: [selected], selected: true, px: selected.px });

  const clusterEnabled = zoom < MAX_CLUSTER_ZOOM;
  for (const r of ranked) {
    if (r === selected) continue;
    const box = boxForSingle(r);
    const target = clusterEnabled
      ? placed.find((p) => !p.selected && collides(r.px, box, p.px, boxFor(p)))
      : undefined;
    if (!target) {
      placed.push({ members: [r], selected: false, px: r.px });
      continue;
    }
    target.members.push(r);
    if (!Number.isFinite(target.members[0].minPrice)) {
      const n = target.members.length;
      target.px = {
        x: target.px.x + (r.px.x - target.px.x) / n,
        y: target.px.y + (r.px.y - target.px.y) / n,
      };
    }
  }

  return placed.map((p) => toItem(p, zoom));
}

/** "R$ 8,00" label used by price bubbles (same format as the rest of the app). */
export function formatPriceLabel(minPrice: number): string {
  return formatBRL(minPrice);
}

/**
 * Font size (px) that keeps a price label inside its bubble: `compact` is the narrower text area
 * of the cluster bubble, which also holds the "+N" badge.
 */
export function priceLabelFontSize(label: string, compact = false): number {
  if (label.length <= 7) return compact ? 11 : 12;
  if (label.length === 8) return compact ? 9 : 10;
  return compact ? 8 : 9;
}
