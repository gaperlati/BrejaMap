/**
 * Address search via Nominatim (OpenStreetMap) plus pure helpers to format, dedupe and
 * rank its results.
 *
 * The helpers are kept free of React/Next/browser imports so they can be tested with `node --test`.
 */

import { distanceKm } from "./geo";
import { createRequestScheduler, type RequestScheduler } from "./request-scheduler";

export interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  osm_type?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  name?: string;
  importance?: number;
  boundingbox?: [string, string, string, string];
  address?: {
    house_number?: string;
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city_district?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    "ISO3166-2-lvl4"?: string;
    postcode?: string;
    country?: string;
  };
}

export interface FormattedNominatimResult {
  /** Primary line (city, neighborhood, street or place name). */
  title: string;
  /** Secondary line with the parent places, without administrative noise. */
  subtitle: string;
  /** Compact label for the input after the result is selected. */
  shortLabel: string;
  /** Map zoom that fits the kind of place. */
  zoom: number;
}

/** Clean address parts extracted from a Nominatim result. */
export interface NominatimAddressParts {
  city?: string;
  neighborhood?: string;
  /** Road plus house number, e.g. "Av. São Carlos, 2100". */
  street?: string;
  stateName?: string;
  /** Two-letter state code (e.g. "SP"), or the state name when it is unknown. */
  stateCode?: string;
}

export type LatLng = { lat: number; lng: number };

type PlaceKind = "state" | "city" | "neighborhood" | "street";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "BrejaMap/1.0 (map app; contact optional)";

/** São Paulo state bbox as Nominatim `viewbox` (west,north,east,south): biases, never restricts. */
const SAO_PAULO_VIEWBOX = "-53.11,-19.77,-44.16,-25.36";

const MAX_RESULTS = 6;

const STATE_CODES: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

const CITY_TYPES = new Set(["city", "town", "village", "municipality", "hamlet"]);
const NEIGHBORHOOD_TYPES = new Set([
  "suburb",
  "neighbourhood",
  "quarter",
  "city_district",
  "borough",
]);
const STATE_TYPES = new Set(["state", "region", "state_district"]);

const NOISE_PATTERNS = [
  /^regiao (sudeste|sul|nordeste|norte|centro-oeste)$/,
  /^regiao geografica/,
  /^regiao metropolitana/,
  /^brasil$/,
  /^\d{5}-?\d{3}$/,
];

/** Lowercase, trimmed and without diacritics ("São Carlos" → "sao carlos"). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isNoise(part: string): boolean {
  const n = normalizeText(part);
  return !n || NOISE_PATTERNS.some((re) => re.test(n));
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && !isNoise(v) ? v : undefined;
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && normalizeText(a) === normalizeText(b);
}

/** "BR-SP" or "São Paulo" → "SP"; unknown states fall back to the state name. */
export function toStateCode(
  state: string | undefined,
  iso?: string
): string | undefined {
  const isoMatch = iso?.trim().match(/^BR-([A-Z]{2})$/i);
  if (isoMatch) return isoMatch[1].toUpperCase();
  if (!state?.trim()) return undefined;
  return STATE_CODES[normalizeText(state)] ?? state.trim();
}

export function extractNominatimAddress(r: NominatimResult): NominatimAddressParts {
  const a = r.address ?? {};
  const road = clean(a.road);
  const houseNumber = clean(a.house_number);
  const stateName = clean(a.state);
  return {
    city: clean(a.city) ?? clean(a.town) ?? clean(a.village) ?? clean(a.municipality),
    neighborhood:
      clean(a.suburb) ?? clean(a.neighbourhood) ?? clean(a.quarter) ?? clean(a.city_district),
    street: road ? (houseNumber ? `${road}, ${houseNumber}` : road) : undefined,
    stateName,
    stateCode: toStateCode(stateName, a["ISO3166-2-lvl4"]),
  };
}

function placeKind(r: NominatimResult, parts: NominatimAddressParts): PlaceKind {
  const subject = r.addresstype ?? r.type ?? "";
  if (CITY_TYPES.has(subject)) return "city";
  if (NEIGHBORHOOD_TYPES.has(subject)) return "neighborhood";
  if (STATE_TYPES.has(subject)) return "state";
  if (parts.street) return "street";
  const name = clean(r.name);
  if (subject === "administrative" || !name) {
    if (parts.neighborhood && !sameText(name, parts.city)) return "neighborhood";
    if (parts.city || name) return "city";
  }
  return "street";
}

/** First meaningful token of `display_name`, used when structured fields are missing. */
function displayNameHead(r: NominatimResult): string {
  return r.display_name.split(",").map((p) => p.trim()).find((p) => !isNoise(p)) ?? r.display_name;
}

function joinDistinct(parts: (string | undefined)[], sep: string, exclude?: string): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || sameText(p, exclude) || out.some((o) => sameText(o, p))) continue;
    out.push(p);
  }
  return out.join(sep);
}

/** "São Carlos - SP", or whichever part exists. */
function cityWithState(city: string | undefined, stateCode: string | undefined): string | undefined {
  if (city && stateCode) return `${city} - ${stateCode}`;
  return city ?? stateCode;
}

export function formatNominatimResult(r: NominatimResult): FormattedNominatimResult {
  const parts = extractNominatimAddress(r);
  const { city, neighborhood, street, stateName, stateCode } = parts;
  const name = clean(r.name);
  const kind = placeKind(r, parts);

  if (kind === "state") {
    const title = name ?? stateName ?? displayNameHead(r);
    return { title, subtitle: "Estado", shortLabel: title, zoom: 7 };
  }

  if (kind === "city") {
    const title = name ?? city ?? displayNameHead(r);
    // A village or district inside another municipality shows that municipality instead.
    const parent = r.address?.municipality && !sameText(r.address.municipality, title)
      ? clean(r.address.municipality)
      : sameText(city, title) ? undefined : city;
    const subtitle = parent
      ? joinDistinct([parent, stateCode], ", ", title)
      : joinDistinct([stateName, stateCode], ", ", title);
    return {
      title,
      subtitle,
      shortLabel: joinDistinct([title, stateCode], ", "),
      zoom: 13,
    };
  }

  if (kind === "neighborhood") {
    const title = name ?? neighborhood ?? displayNameHead(r);
    return {
      title,
      subtitle: joinDistinct([city, stateCode], ", ", title),
      shortLabel: city
        ? `${title}, ${cityWithState(city, stateCode)}`
        : joinDistinct([title, stateCode], ", "),
      zoom: 14,
    };
  }

  const isPoi =
    !!name && !sameText(name, r.address?.road) && !sameText(name, r.address?.house_number);
  const title = isPoi ? name! : street ?? name ?? displayNameHead(r);
  const area = joinDistinct([neighborhood, cityWithState(city, stateCode)], " · ", title);
  const subtitle = isPoi ? joinDistinct([street, area], ", ", title) : area;
  const shortCity = joinDistinct([city, stateCode], ", ");
  return {
    title,
    subtitle,
    shortLabel: shortCity ? `${title} — ${shortCity}` : title,
    zoom: 16,
  };
}

function dedupeKey(r: NominatimResult): { key: string; kind: PlaceKind } {
  const parts = extractNominatimAddress(r);
  const kind = placeKind(r, parts);
  const { title } = formatNominatimResult(r);
  const key = [title, parts.city ?? "", parts.stateCode ?? "", kind].map(normalizeText).join("|");
  return { key, kind };
}

function coords(r: NominatimResult): LatLng {
  return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
}

/**
 * Drops results that represent the same place (e.g. the `place=city` node and the
 * administrative boundary relation of the same city). Keeps the first occurrence, so pass
 * results already in priority order. Streets/POIs only merge when within ~1 km, so
 * homonymous bars or distant segments of a long road stay separate.
 */
export function dedupeNominatimResults(results: NominatimResult[]): NominatimResult[] {
  const kept: { r: NominatimResult; key: string }[] = [];
  for (const r of results) {
    const { key, kind } = dedupeKey(r);
    const duplicate = kept.some(
      (k) =>
        k.key === key &&
        (kind === "city" || kind === "state" || kind === "neighborhood" ||
          distanceKm(coords(k.r), coords(r)) <= 1)
    );
    if (!duplicate) kept.push({ r, key });
  }
  return kept.map((k) => k.r);
}

const TYPE_SCORES: Record<string, number> = {
  city: 20,
  town: 20,
  municipality: 18,
  suburb: 15,
  neighbourhood: 15,
  quarter: 15,
  city_district: 12,
  road: 15,
  bar: 15,
  pub: 15,
  biergarten: 15,
  restaurant: 12,
  village: 8,
  state: 5,
  hamlet: 2,
  administrative: 0,
};

function scoreResult(r: NominatimResult, query: string, bias?: LatLng): number {
  const { title } = formatNominatimResult(r);
  const q = normalizeText(query);
  const t = normalizeText(title);
  let score = 0;

  if (q && t === q) score += 100;
  else if (q && t.startsWith(q)) score += 60;
  else if (q && (t.includes(q) || q.startsWith(t))) score += 30;

  if (extractNominatimAddress(r).stateCode === "SP") score += 50;

  if (bias) {
    const { lat, lng } = coords(r);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const km = distanceKm(bias, { lat, lng });
      score += 40 / (1 + km / 50);
    }
  }

  const subject = r.addresstype ?? r.type ?? "";
  score += TYPE_SCORES[subject] ?? TYPE_SCORES[r.type ?? ""] ?? 5;
  score += (r.importance ?? 0) * 20;
  return score;
}

/**
 * Sorts results by relevance (title match, São Paulo state, proximity to `biasLocation`,
 * place type and Nominatim importance) and removes duplicates. Nothing is filtered out:
 * results from other states stay in the list, just lower.
 */
export function rankNominatimResults(
  results: NominatimResult[],
  query: string,
  biasLocation?: LatLng
): NominatimResult[] {
  const ranked = results
    .map((r, index) => ({ r, index, score: scoreResult(r, query, biasLocation) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.r);
  return dedupeNominatimResults(ranked);
}

function searchParams(query: string, viewbox: string, bounded: boolean): URLSearchParams {
  return new URLSearchParams({
    q: query.trim(),
    format: "json",
    addressdetails: "1",
    limit: "12",
    dedupe: "1",
    // The app only covers Brazil; restricting results avoids picking a homonym abroad.
    countrycodes: "br",
    viewbox,
    bounded: bounded ? "1" : "0",
    "accept-language": "pt-BR",
  });
}

/** Nominatim's usage policy allows at most 1 request per second per client. */
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

/**
 * Shared by every Nominatim call in this tab (main map search, "Adicionar bar" search and
 * reverse geocoding), so their request starts are always >= 1 s apart.
 */
let nominatimScheduler: RequestScheduler = createRequestScheduler(NOMINATIM_MIN_INTERVAL_MS);

/** Swaps the shared scheduler (tests use a fake clock); returns the previous one. */
export function setNominatimSchedulerForTesting(scheduler: RequestScheduler): RequestScheduler {
  const previous = nominatimScheduler;
  nominatimScheduler = scheduler;
  return previous;
}

/**
 * Rate-limited GET to Nominatim. Waits for a free slot first; an abort while waiting means
 * the request is never sent. Throws on HTTP errors (e.g. 429), so callers can tell "no
 * results" from "the search failed".
 */
async function fetchNominatimJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await nominatimScheduler.schedule(
    () => fetch(url, { headers: { "User-Agent": USER_AGENT }, signal }),
    signal
  );
  if (!res.ok) throw new Error(`Nominatim request failed (${res.status})`);
  return (await res.json()) as T;
}

function fetchNominatim(url: string, signal?: AbortSignal): Promise<NominatimResult[]> {
  return fetchNominatimJson<NominatimResult[]>(url, signal);
}

export async function searchAddress(
  query: string,
  options?: { biasLocation?: LatLng; signal?: AbortSignal }
): Promise<NominatimResult[]> {
  if (!query.trim()) return [];
  // Prefer São Paulo state without excluding the rest of Brazil.
  const params = searchParams(query, SAO_PAULO_VIEWBOX, false);
  const data = await fetchNominatim(`${NOMINATIM_URL}?${params}`, options?.signal);
  return rankNominatimResults(data, query, options?.biasLocation).slice(0, MAX_RESULTS);
}

/** Radius of the "near the pin" pass of `searchAddressNear`. */
export const NEARBY_SEARCH_RADIUS_KM = 15;

/**
 * Nominatim `viewbox` ("west,north,east,south") of a square of `radiusKm` around `center`.
 */
export function viewboxAround(center: LatLng, radiusKm: number): string {
  const dLat = radiusKm / 111.32;
  const cosLat = Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01);
  const dLng = radiusKm / (111.32 * cosLat);
  const r = (n: number) => n.toFixed(5);
  return [
    r(center.lng - dLng),
    r(center.lat + dLat),
    r(center.lng + dLng),
    r(center.lat - dLat),
  ].join(",");
}

export interface NearbySearchResult {
  results: NominatimResult[];
  /** "nearby": every result is within the radius; "wide": nothing nearby, state-wide fallback. */
  scope: "nearby" | "wide";
}

/**
 * Address search for placing a point (e.g. "Adicionar bar"): first only around `center`
 * (where the user is looking), so a common street name doesn't return homonyms in other
 * cities; when nothing is found there, falls back to the regular SP-biased search. The
 * fallback only runs after an empty first answer, and like every Nominatim call it goes
 * through the shared scheduler, so it starts at least 1 s after the previous request.
 */
export async function searchAddressNear(
  query: string,
  center: LatLng,
  options?: { signal?: AbortSignal; radiusKm?: number }
): Promise<NearbySearchResult> {
  if (!query.trim()) return { results: [], scope: "nearby" };
  const params = searchParams(
    query,
    viewboxAround(center, options?.radiusKm ?? NEARBY_SEARCH_RADIUS_KM),
    true
  );
  const nearby = await fetchNominatim(`${NOMINATIM_URL}?${params}`, options?.signal);
  if (nearby.length > 0) {
    return {
      results: rankNominatimResults(nearby, query, center).slice(0, MAX_RESULTS),
      scope: "nearby",
    };
  }
  return {
    results: await searchAddress(query, { biasLocation: center, signal: options?.signal }),
    scope: "wide",
  };
}

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

/**
 * Address of the point (`zoom=18`: nearest building/street). Returns null when Nominatim
 * has nothing there (e.g. middle of a park or the sea).
 */
export async function reverseGeocode(
  point: LatLng,
  options?: { signal?: AbortSignal }
): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    lat: point.lat.toFixed(7),
    lon: point.lng.toFixed(7),
    format: "json",
    addressdetails: "1",
    zoom: "18",
    "accept-language": "pt-BR",
  });
  const data = await fetchNominatimJson<NominatimResult & { error?: string }>(
    `${NOMINATIM_REVERSE_URL}?${params}`,
    options?.signal
  );
  return data && !data.error && data.address ? data : null;
}

/** Address fields of a venue, as stored by POST /api/venues. */
export interface PlaceDetails {
  /** Street plus house number when known, e.g. "Rua Alvarenga Peixoto, 120". */
  address: string;
  neighborhood: string;
  city: string;
  /** Two-letter state code ("SP"); empty when unknown. */
  state: string;
}

/**
 * Venue address fields from a Nominatim result. Only the street is used, never a POI
 * name: the nearest POI to a pin is often a different business.
 */
export function placeDetailsFromNominatim(r: NominatimResult): PlaceDetails {
  const parts = extractNominatimAddress(r);
  const state = parts.stateCode && parts.stateCode.length === 2 ? parts.stateCode : "";
  return {
    address: parts.street ?? "",
    neighborhood: parts.neighborhood ?? "",
    city: parts.city ?? "",
    state,
  };
}

/** "a 350 m", "a 2,3 km", "a 148 km" (pt-BR decimal comma). */
export function formatDistanceLabel(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return `a ${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `a ${km.toFixed(1).replace(".", ",")} km`;
  return `a ${Math.round(km)} km`;
}
