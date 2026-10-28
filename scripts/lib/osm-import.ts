/**
 * Pure helpers for the OSM import script: CLI parsing, OSM -> venues row mapping and the
 * insert-only writer. Kept separate from the CLI entry so tests can import them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SP_STATE_BOUNDS,
  validateImportBbox,
  type OsmBar,
  type OverpassBbox,
  type OverpassElement,
} from "../../src/lib/overpass";

/** Same limits the API applies to user-added venues (src/lib/venue-server.ts). */
const MAX_NAME_LEN = 80;
const MAX_ADDRESS_FIELD_LEN = 200;
const MAX_RETRIES_LIMIT = 3;
export const WRITE_BATCH_SIZE = 200;

export interface ImportPreset {
  /** One Overpass request per bbox, sequentially; each must pass validateImportBbox. */
  bboxes: OverpassBbox[];
  /**
   * Canonical city name. Without a boundary it fills a missing addr:city (and replaces accent/case
   * variants of itself); with a boundary every bar inside gets it.
   */
  city: string;
  state: string;
  /** OSM relation of the municipal boundary; bars outside it are dropped. Its name must match `city`. */
  boundaryRelationId?: number;
}

export const PRESETS: Record<string, ImportPreset> = {
  /** São Carlos urban area (launch city). Does not reach Ibaté or the rural districts. */
  "sao-carlos": {
    bboxes: [{ south: -22.08, west: -47.96, north: -21.96, east: -47.82 }],
    city: "São Carlos",
    state: "SP",
    boundaryRelationId: 297986,
  },
  /**
   * São Paulo municipality (lat -24.01..-23.36, lng -46.83..-46.36), split in two to respect the
   * per-bbox limit. The rectangles also cover Osasco, Guarulhos and the ABC cities, so the municipal
   * boundary (relation 298285) decides what is imported.
   */
  "sao-paulo": {
    bboxes: [
      { south: -23.8, west: -46.83, north: -23.36, east: -46.36 },
      { south: -24.01, west: -46.83, north: -23.8, east: -46.36 },
    ],
    city: "São Paulo",
    state: "SP",
    boundaryRelationId: 298285,
  },
};
export const DEFAULT_PRESET = "sao-carlos";

export interface ImportOptions {
  bboxes: OverpassBbox[];
  /** Human label for logs: preset name or "bbox". */
  scope: string;
  fallbackCity: string;
  fallbackState: string;
  /** Municipal boundary relation to filter by (presets only). */
  boundaryRelationId: number | null;
  write: boolean;
  outFile: string | null;
  maxRetries: number;
}

export type ParseResult = { ok: true; options: ImportOptions } | { ok: false; error: string } | { ok: "help" };

function parseBbox(raw: string): OverpassBbox | string {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => p === "")) {
    return "--bbox precisa de 4 valores: sul,oeste,norte,leste";
  }
  const [south, west, north, east] = parts.map(Number);
  return { south, west, north, east };
}

/** Parses CLI args. Never touches the network; everything is validated here first. */
export function parseArgs(argv: string[]): ParseResult {
  let preset: string | null = null;
  let bboxRaw: string | null = null;
  let city: string | null = null;
  let write = false;
  let dryRun = false;
  let outFile: string | null = null;
  let maxRetries = 1;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      i++;
      return value === undefined || value.startsWith("--") ? null : value;
    };
    switch (arg) {
      case "--help":
      case "-h":
        return { ok: "help" };
      case "--write":
        write = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--preset":
        preset = next();
        if (preset === null) return { ok: false, error: "--preset precisa de um nome" };
        break;
      case "--bbox":
        bboxRaw = next();
        if (bboxRaw === null) return { ok: false, error: "--bbox precisa de sul,oeste,norte,leste" };
        break;
      case "--city":
        city = next()?.trim() || null;
        if (city === null) return { ok: false, error: "--city precisa de um nome" };
        break;
      case "--out":
        outFile = next();
        if (outFile === null) return { ok: false, error: "--out precisa de um caminho" };
        break;
      case "--max-retries": {
        const raw = next();
        const n = Number(raw);
        if (raw === null || !Number.isInteger(n) || n < 0 || n > MAX_RETRIES_LIMIT) {
          return { ok: false, error: `--max-retries precisa ser inteiro entre 0 e ${MAX_RETRIES_LIMIT}` };
        }
        maxRetries = n;
        break;
      }
      default:
        return { ok: false, error: `argumento desconhecido: ${arg}` };
    }
  }

  if (write && dryRun) {
    return { ok: false, error: "use --write ou --dry-run, não os dois" };
  }
  if (city !== null && bboxRaw === null) {
    return { ok: false, error: "--city só vale com --bbox" };
  }
  if (preset !== null && bboxRaw !== null) {
    return { ok: false, error: "use --preset ou --bbox, não os dois" };
  }
  if (preset !== null && city !== null) {
    return { ok: false, error: "--city só vale com --bbox (o preset já define a cidade)" };
  }
  if (write && preset === null && bboxRaw === null) {
    return { ok: false, error: "--write exige escopo explícito: --preset <nome> ou --bbox" };
  }

  let options: ImportOptions;
  if (bboxRaw !== null) {
    const bbox = parseBbox(bboxRaw);
    if (typeof bbox === "string") return { ok: false, error: bbox };
    options = {
      bboxes: [bbox],
      scope: "bbox",
      fallbackCity: city ?? "",
      // An operator-given city is asserted to be in SP; a bare bbox leaves both unknown.
      fallbackState: city ? "SP" : "",
      boundaryRelationId: null,
      write,
      outFile,
      maxRetries,
    };
  } else {
    const name = preset ?? DEFAULT_PRESET;
    const found = Object.prototype.hasOwnProperty.call(PRESETS, name) ? PRESETS[name] : undefined;
    if (!found) {
      return { ok: false, error: `preset desconhecido: ${name} (disponíveis: ${Object.keys(PRESETS).join(", ")})` };
    }
    options = {
      bboxes: found.bboxes,
      scope: name,
      fallbackCity: found.city,
      fallbackState: found.state,
      boundaryRelationId: found.boundaryRelationId ?? null,
      write,
      outFile,
      maxRetries,
    };
  }

  for (const bbox of options.bboxes) {
    const bboxError = validateImportBbox(bbox);
    if (bboxError) return { ok: false, error: bboxError };
  }
  return { ok: true, options };
}

/** Row inserted into public.venues. No price, happy hour or photo: those stay at DB defaults. */
export interface VenueImportRow {
  external_id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  source: "osm";
  user_added: false;
}

export interface MappingSummary {
  rows: VenueImportRow[];
  skippedUnnamed: number;
  skippedOutOfScope: number;
  /** Inside the requested bboxes but outside the municipal boundary. */
  skippedOutsideBoundary: number;
  skippedDuplicate: number;
}

function inside(bbox: OverpassBbox, lat: number, lng: number): boolean {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east;
}

// --- Municipal boundary (OSM multipolygon relation) ---

export interface LatLng {
  lat: number;
  lng: number;
}

/** Closed ring: the first point equals the last one. */
export type Ring = LatLng[];

export interface Boundary {
  name: string;
  outer: Ring[];
  inner: Ring[];
}

const pointKey = (p: LatLng) => `${p.lat},${p.lng}`;

/**
 * Joins way segments into closed rings by matching shared end nodes (ways may run in either
 * direction). Throws when a ring cannot be closed: a broken boundary must never filter silently.
 */
export function assembleRings(segments: LatLng[][]): Ring[] {
  const pending = segments.filter((s) => s.length > 0);
  const rings: Ring[] = [];

  while (pending.length > 0) {
    const ring = [...pending.shift()!];
    while (pointKey(ring[0]) !== pointKey(ring[ring.length - 1])) {
      const endKey = pointKey(ring[ring.length - 1]);
      const idx = pending.findIndex((s) => pointKey(s[0]) === endKey || pointKey(s[s.length - 1]) === endKey);
      if (idx === -1) throw new Error(`limite municipal com anel aberto perto de ${endKey}`);
      const [next] = pending.splice(idx, 1);
      const oriented = pointKey(next[0]) === endKey ? next : [...next].reverse();
      ring.push(...oriented.slice(1));
    }
    if (ring.length < 4) throw new Error("limite municipal com anel degenerado (menos de 3 vértices)");
    rings.push(ring);
  }
  return rings;
}

/** Builds outer/inner rings from an Overpass `out geom` relation (way members only). */
export function boundaryFromRelation(rel: OverpassElement): Boundary {
  const outerSegments: LatLng[][] = [];
  const innerSegments: LatLng[][] = [];
  for (const member of rel.members ?? []) {
    if (member.type !== "way") continue;
    // OSM multipolygons treat an empty role as outer.
    if (member.role !== "outer" && member.role !== "inner" && member.role !== "") continue;
    const geometry = member.geometry ?? [];
    const points: LatLng[] = [];
    for (const p of geometry) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) break;
      points.push({ lat: p.lat, lng: p.lon });
    }
    if (points.length < 2 || points.length !== geometry.length) {
      throw new Error(`limite municipal com geometria incompleta no way ${member.ref}`);
    }
    (member.role === "inner" ? innerSegments : outerSegments).push(points);
  }
  const outer = assembleRings(outerSegments);
  if (outer.length === 0) throw new Error(`relação OSM ${rel.id} sem anel externo`);
  return { name: rel.tags?.name?.trim() ?? "", outer, inner: assembleRings(innerSegments) };
}

/** Ray casting with lng as x and lat as y. */
export function pointInRing(ring: Ring, lat: number, lng: number): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > lat !== b.lat > lat && lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      result = !result;
    }
  }
  return result;
}

/**
 * Even-odd rule over all rings: correct for valid multipolygons (several outers, holes, outers
 * inside holes) without having to pair each inner ring with its outer.
 */
export function pointInBoundary(boundary: Boundary, lat: number, lng: number): boolean {
  let count = 0;
  for (const ring of boundary.outer) if (pointInRing(ring, lat, lng)) count++;
  for (const ring of boundary.inner) if (pointInRing(ring, lat, lng)) count++;
  return count % 2 === 1;
}

/** Case-, accent- and whitespace-insensitive form used to compare place names. */
export function foldPlaceName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Maps spelling variants of the canonical city ("Sao Paulo", "são paulo") to it; keeps other values. */
export function normalizeCity(raw: string, canonical: string): string {
  if (canonical && raw && foldPlaceName(raw) === foldPlaceName(canonical)) return canonical;
  return raw;
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s);

/**
 * Maps OSM bars to venue rows. Skips unnamed places, anything outside the requested bboxes/SP
 * (relation centers can fall outside) or tagged with another state, repeated OSM ids (also across
 * adjacent bboxes) and, when a boundary is given, anything outside it. Inside a boundary the
 * municipality is authoritative: every row gets the canonical city (fallbackCity).
 */
export function buildImportRows(
  bars: OsmBar[],
  opts: Pick<ImportOptions, "bboxes" | "fallbackCity" | "fallbackState"> & { boundary?: Boundary | null }
): MappingSummary {
  const summary: MappingSummary = {
    rows: [],
    skippedUnnamed: 0,
    skippedOutOfScope: 0,
    skippedOutsideBoundary: 0,
    skippedDuplicate: 0,
  };
  const boundary = opts.boundary ?? null;
  const seen = new Set<string>();

  for (const bar of bars) {
    if (!bar.name) {
      summary.skippedUnnamed++;
      continue;
    }
    if (
      !Number.isFinite(bar.lat) ||
      !Number.isFinite(bar.lng) ||
      !opts.bboxes.some((bbox) => inside(bbox, bar.lat, bar.lng)) ||
      !inside(SP_STATE_BOUNDS, bar.lat, bar.lng) ||
      (bar.state !== "" && bar.state !== "SP")
    ) {
      summary.skippedOutOfScope++;
      continue;
    }
    if (seen.has(bar.externalId)) {
      summary.skippedDuplicate++;
      continue;
    }
    seen.add(bar.externalId);
    if (boundary && !pointInBoundary(boundary, bar.lat, bar.lng)) {
      summary.skippedOutsideBoundary++;
      continue;
    }
    const city = boundary ? opts.fallbackCity : normalizeCity(bar.city, opts.fallbackCity) || opts.fallbackCity;

    summary.rows.push({
      external_id: bar.externalId,
      name: clip(bar.name, MAX_NAME_LEN),
      address: clip(bar.address, MAX_ADDRESS_FIELD_LEN),
      neighborhood: clip(bar.neighborhood, MAX_ADDRESS_FIELD_LEN),
      city: clip(city, MAX_ADDRESS_FIELD_LEN),
      state: clip(bar.state || opts.fallbackState, MAX_ADDRESS_FIELD_LEN),
      lat: round7(bar.lat),
      lng: round7(bar.lng),
      source: "osm",
      user_added: false,
    });
  }

  summary.rows.sort((a, b) => a.external_id.localeCompare(b.external_id));
  return summary;
}

/** Inserts rows whose external_id is new; returns the external_ids actually inserted. */
export interface VenueWriter {
  insertNew(rows: VenueImportRow[]): Promise<string[]>;
}

const MISSING_MIGRATION_HINT =
  "rode supabase/migrations/002_venues_external_id.sql no Supabase antes de usar --write";

/**
 * Insert-only writer: INSERT ... ON CONFLICT (external_id) DO NOTHING via PostgREST.
 * Existing venues (and their prices, happy hour and community edits) are never updated;
 * beer_prices is never touched.
 */
export function createSupabaseWriter(client: SupabaseClient): VenueWriter {
  return {
    async insertNew(rows) {
      const { data, error } = await client
        .from("venues")
        .upsert(rows, { onConflict: "external_id", ignoreDuplicates: true })
        .select("external_id");
      if (error) {
        // 42703 undefined column, 42P10 no unique constraint for ON CONFLICT.
        const hint = error.code === "42703" || error.code === "42P10" ? ` (${MISSING_MIGRATION_HINT})` : "";
        throw new Error(`Supabase: falha ao inserir venues: ${error.message}${hint}`);
      }
      return (data ?? []).map((r: { external_id: string }) => r.external_id);
    },
  };
}

/** Fails fast (before calling Overpass) when the external_id column is missing. */
export async function checkExternalIdColumn(client: SupabaseClient): Promise<void> {
  const { error } = await client.from("venues").select("external_id").limit(1);
  if (error) {
    const hint = error.code === "42703" ? ` (${MISSING_MIGRATION_HINT})` : "";
    throw new Error(`Supabase: não foi possível ler venues.external_id: ${error.message}${hint}`);
  }
}

export interface WriteSummary {
  inserted: number;
  alreadyPresent: number;
}

/** Writes sequentially in batches. Safe to repeat: existing external_ids are left untouched. */
export async function writeRows(
  writer: VenueWriter,
  rows: VenueImportRow[],
  batchSize: number = WRITE_BATCH_SIZE
): Promise<WriteSummary> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    inserted += (await writer.insertNew(batch)).length;
  }
  return { inserted, alreadyPresent: rows.length - inserted };
}

/** Reads Supabase settings for --write. Returns an error message instead of logging values. */
export function readSupabaseEnv(
  env: Record<string, string | undefined>
): { ok: true; url: string; key: string; host: string } | { ok: false; error: string } {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return { ok: false, error: "--write exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "SUPABASE_URL não é uma URL válida" };
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return { ok: false, error: "SUPABASE_URL precisa usar https" };
  }
  return { ok: true, url, key, host: parsed.host };
}
