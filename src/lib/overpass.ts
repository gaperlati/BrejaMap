/**
 * Fetch bars and pubs from OpenStreetMap via Overpass API.
 * Used by the offline import script (scripts/import-osm.ts); the app never calls Overpass per request.
 * Returns places without price data – users add prices later.
 */

import type { Venue } from "@/types";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_USER_AGENT = "BrejaMap/1.0 (beer map; low request rate)";

/** Server-side query timeout (seconds) sent to Overpass. */
const OVERPASS_QUERY_TIMEOUT_S = 60;
/** Client-side abort a bit after the server timeout. */
const OVERPASS_FETCH_TIMEOUT_MS = 90_000;
/** Longest Retry-After we are willing to wait; anything above stops the run. */
const MAX_RETRY_AFTER_MS = 120_000;
const DEFAULT_BACKOFF_MS = [15_000, 45_000];
/** Overloaded/unavailable server: retried like 429 (bounded), then reported as a timeout. */
const RETRYABLE_SERVER_STATUSES = [502, 503, 504];

/** Thrown when Overpass returns 429 Too Many Requests. */
export class OverpassRateLimitError extends Error {
  constructor(message: string = "Muitas buscas no momento. Aguarde alguns segundos e tente de novo.") {
    super(message);
    this.name = "OverpassRateLimitError";
  }
}

/** Thrown when Overpass returns 502/503/504 (server overloaded) or a query runtime error. */
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

/**
 * Generous bounding box around São Paulo state (same as the API write check).
 * Imports outside it are rejected.
 */
export const SP_STATE_BOUNDS: OverpassBbox = { south: -25.5, west: -53.3, north: -19.5, east: -44.0 };

/** Largest bbox (degrees per side) one import may request: roughly 55 km, a large city plus surroundings. */
export const MAX_IMPORT_SPAN_DEG = 0.5;

/** Returns an error message (pt-BR) or null when the bbox is a valid import scope. */
export function validateImportBbox(bbox: OverpassBbox): string | null {
  const { south, west, north, east } = bbox;
  if (![south, west, north, east].every(Number.isFinite)) {
    return "bbox precisa de 4 números finitos (sul,oeste,norte,leste).";
  }
  if (south >= north) return "bbox inválida: sul precisa ser menor que norte.";
  if (west >= east) return "bbox inválida: oeste precisa ser menor que leste.";
  if (
    south < SP_STATE_BOUNDS.south ||
    north > SP_STATE_BOUNDS.north ||
    west < SP_STATE_BOUNDS.west ||
    east > SP_STATE_BOUNDS.east
  ) {
    return "bbox fora do estado de São Paulo.";
  }
  if (north - south > MAX_IMPORT_SPAN_DEG || east - west > MAX_IMPORT_SPAN_DEG) {
    return `bbox grande demais: no máximo ${MAX_IMPORT_SPAN_DEG}° por lado.`;
  }
  return null;
}

export type OsmElementType = "node" | "way" | "relation";

export interface OverpassLatLon {
  lat: number;
  lon: number;
}

/** Relation member as returned by `out geom` (ways carry their node coordinates in order). */
export interface OverpassMember {
  type: OsmElementType;
  ref: number;
  role: string;
  geometry?: (OverpassLatLon | null)[];
}

export interface OverpassElement {
  type: OsmElementType;
  id: number;
  lat?: number;
  lon?: number;
  center?: OverpassLatLon;
  tags?: Record<string, string>;
  members?: OverpassMember[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
}

/** A bar/pub as read from OSM: stable typed identity, coordinates and address tags. No prices. */
export interface OsmBar {
  /** e.g. "osm-node-123", "osm-way-123" – the same number can exist for different element types. */
  externalId: string;
  name: string | null;
  lat: number;
  lng: number;
  address: string;
  neighborhood: string;
  /** From addr:city / addr:municipality; empty when OSM does not say. */
  city: string;
  /** From addr:state; empty when OSM does not say. */
  state: string;
}

export function osmExternalId(type: OsmElementType, id: number): string {
  return `osm-${type}-${id}`;
}

function getCoords(el: OverpassElement): { lat: number; lng: number } | null {
  // Nodes carry lat/lon; ways and relations carry `center` (from `out center`).
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function buildAddress(tags: Record<string, string>): string {
  const street = tags["addr:street"]?.trim();
  if (!street) return "";
  const number = tags["addr:housenumber"]?.trim();
  return number ? `${street}, ${number}` : street;
}

function normalizeState(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return "";
  if (/^(sp|s[ãa]o paulo)$/i.test(value)) return "SP";
  return value;
}

export function elementToOsmBar(el: OverpassElement): OsmBar | null {
  if (el.type !== "node" && el.type !== "way" && el.type !== "relation") return null;
  if (!Number.isSafeInteger(el.id) || el.id <= 0) return null;
  const coords = getCoords(el);
  if (!coords) return null;

  const tags = el.tags ?? {};
  const name = (tags.name ?? tags["name:pt"])?.trim() || null;

  return {
    externalId: osmExternalId(el.type, el.id),
    name,
    lat: coords.lat,
    lng: coords.lng,
    address: buildAddress(tags),
    neighborhood: (tags["addr:suburb"] ?? tags["addr:neighbourhood"] ?? tags["addr:quarter"] ?? "").trim(),
    city: (tags["addr:city"] ?? tags["addr:municipality"] ?? "").trim(),
    state: normalizeState(tags["addr:state"]),
  };
}

/** Bars and pubs (exact amenity match) as nodes, ways and relations; ways/relations get a center point. */
export function buildBarsQuery(bbox: OverpassBbox): string {
  const { south, west, north, east } = bbox;
  return `
[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
nwr["amenity"~"^(bar|pub)$"](${south},${west},${north},${east});
out center tags;
  `.trim();
}

/** One relation with its member ways' geometry (used for municipal boundaries). */
export function buildRelationGeometryQuery(relationId: number): string {
  return `
[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
rel(${relationId});
out geom;
  `.trim();
}

/** Parses Retry-After (seconds or HTTP date) into milliseconds; null when absent/invalid. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export interface FetchOsmOptions {
  /** Retries after 429/502/503/504 (default 0: fail fast). Bounded; each waits Retry-After or a fixed backoff. */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; status: number; waitMs: number }) => void;
  url?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One sequential Overpass request (with bounded retries on 429/5xx overload).
 * Rejects partial results that Overpass reports as a runtime error.
 */
async function runOverpassQuery(query: string, options: FetchOsmOptions): Promise<OverpassResponse> {
  const {
    maxRetries = 0,
    fetchImpl = fetch,
    sleep = defaultSleep,
    onRetry,
    url = OVERPASS_URL,
  } = options;
  const body = `data=${encodeURIComponent(query)}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OVERPASS_USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(OVERPASS_FETCH_TIMEOUT_MS),
    });

    if (res.status === 429 || RETRYABLE_SERVER_STATUSES.includes(res.status)) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const waitMs = retryAfter ?? DEFAULT_BACKOFF_MS[Math.min(attempt, DEFAULT_BACKOFF_MS.length - 1)];
      if (attempt >= maxRetries || waitMs > MAX_RETRY_AFTER_MS) {
        throw res.status === 429 ? new OverpassRateLimitError() : new OverpassTimeoutError();
      }
      onRetry?.({ attempt: attempt + 1, status: res.status, waitMs });
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Overpass API error: ${res.status}`);
    }

    const data = (await res.json()) as OverpassResponse;
    // Overpass reports query timeouts/out-of-memory as 200 with a "runtime error" remark and partial data.
    if (data.remark && /runtime error/i.test(data.remark)) {
      throw new OverpassTimeoutError(`Overpass devolveu resultado incompleto: ${data.remark}`);
    }
    if (!Array.isArray(data.elements)) {
      throw new Error("Overpass API: resposta sem 'elements'.");
    }
    return data;
  }
}

/**
 * One sequential Overpass request for bars/pubs in the bbox (with bounded retries on 429/5xx overload).
 * Validates the bbox before any network call.
 */
export async function fetchOsmBars(bbox: OverpassBbox, options: FetchOsmOptions = {}): Promise<OsmBar[]> {
  const bboxError = validateImportBbox(bbox);
  if (bboxError) throw new Error(bboxError);

  const data = await runOverpassQuery(buildBarsQuery(bbox), options);
  const bars: OsmBar[] = [];
  for (const el of data.elements) {
    const bar = elementToOsmBar(el);
    if (bar) bars.push(bar);
  }
  return bars;
}

/**
 * Fetches one OSM relation with its member geometry (`out geom`). Throws when the relation is
 * missing, so callers never fall back to unfiltered data.
 */
export async function fetchOsmRelation(relationId: number, options: FetchOsmOptions = {}): Promise<OverpassElement> {
  if (!Number.isSafeInteger(relationId) || relationId <= 0) {
    throw new Error(`id de relação OSM inválido: ${relationId}`);
  }
  const data = await runOverpassQuery(buildRelationGeometryQuery(relationId), options);
  const rel = data.elements.find((el) => el.type === "relation" && el.id === relationId);
  if (!rel) throw new Error(`Overpass não devolveu a relação OSM ${relationId}.`);
  return rel;
}

/**
 * Query Overpass for bars and pubs in the given bounding box, as app venues (no prices).
 */
export async function fetchBarsFromOsm(bbox: OverpassBbox, options?: FetchOsmOptions): Promise<Venue[]> {
  const bars = await fetchOsmBars(bbox, options);
  const createdAt = new Date().toISOString();
  return bars.map((bar) => ({
    id: bar.externalId,
    name: bar.name ?? "Bar (sem nome)",
    address: bar.address,
    neighborhood: bar.neighborhood,
    city: bar.city,
    state: bar.state,
    lat: bar.lat,
    lng: bar.lng,
    beerPrices: [],
    hasHappyHour: false,
    createdAt,
    fromOsm: true,
  }));
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
