/**
 * Fetch bars and pubs from OpenStreetMap via Overpass API.
 * Returns venues without price data (beerPrices: []) – users can add prices later.
 */

import type { Venue } from "@/types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_USER_AGENT = "CervejaBarato/1.0 (beer map; low request rate)";

/** Thrown when Overpass returns 429 Too Many Requests. */
export class OverpassRateLimitError extends Error {
  constructor(message: string = "Muitas buscas no momento. Aguarde alguns segundos e tente de novo.") {
    super(message);
    this.name = "OverpassRateLimitError";
  }
}

/** Thrown when Overpass returns 504 Gateway Timeout (server overloaded). */
export class OverpassTimeoutError extends Error {
  constructor(message: string = "O servidor demorou demais. Tente de novo em instantes.") {
    super(message);
    this.name = "OverpassTimeoutError";
  }
}

export interface OverpassBbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function getCoords(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.lat != null && el.lon != null) {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center?.lat != null && el.center?.lon != null) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  if (el.bounds) {
    const { minlat, maxlat, minlon, maxlon } = el.bounds;
    return {
      lat: (minlat + maxlat) / 2,
      lng: (minlon + maxlon) / 2,
    };
  }
  return null;
}

function buildAddress(tags: Record<string, string>): string {
  const parts: string[] = [];
  if (tags["addr:street"]) {
    parts.push(tags["addr:housenumber"] ? `${tags["addr:street"]}, ${tags["addr:housenumber"]}` : tags["addr:street"]);
  }
  if (tags["addr:suburb"]) parts.push(tags["addr:suburb"]);
  if (tags["addr:city"]) parts.push(tags["addr:city"]);
  if (tags["addr:state"]) parts.push(tags["addr:state"]);
  return parts.length > 0 ? parts.join(" – ") : "Endereço não informado";
}

function elementToVenue(el: OverpassElement): Venue | null {
  const coords = getCoords(el);
  if (!coords) return null;

  const tags = el.tags ?? {};
  const name = tags.name ?? tags["name:pt"] ?? "Bar (sem nome)";

  const address = buildAddress(tags);
  const neighborhood = tags["addr:suburb"] ?? tags["addr:neighbourhood"] ?? tags["addr:district"] ?? "—";
  const city = tags["addr:city"] ?? tags["addr:municipality"] ?? "São Paulo";
  const state = tags["addr:state"] ?? "SP";

  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    address,
    neighborhood,
    city,
    state,
    lat: coords.lat,
    lng: coords.lng,
    beerPrices: [],
    hasHappyHour: false,
    createdAt: new Date().toISOString(),
    fromOsm: true,
  };
}

/**
 * Query Overpass for bars and pubs in the given bounding box.
 */
export async function fetchBarsFromOsm(bbox: OverpassBbox): Promise<Venue[]> {
  const { south, west, north, east } = bbox;
  const query = `
[out:json][timeout:15];
(
  node["amenity"~"^bar|pub$"](${south},${west},${north},${east});
  way["amenity"~"^bar|pub$"](${south},${west},${north},${east});
);
out center body;
  `.trim();

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": OVERPASS_USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (res.status === 429) {
    throw new OverpassRateLimitError();
  }
  if (res.status === 504) {
    throw new OverpassTimeoutError();
  }
  if (!res.ok) {
    throw new Error(`Overpass API error: ${res.status}`);
  }

  const data: OverpassResponse = await res.json();
  const venues: Venue[] = [];

  for (const el of data.elements) {
    const venue = elementToVenue(el);
    if (venue) venues.push(venue);
  }

  return venues;
}

/**
 * Build a bounding box from a center point and approximate radius in meters.
 */
export function bboxFromCenter(
  lat: number,
  lng: number,
  radiusMeters: number = 2500
): OverpassBbox {
  const deg = radiusMeters / 111320;
  return {
    south: lat - deg,
    west: lng - deg,
    north: lat + deg,
    east: lng + deg,
  };
}
