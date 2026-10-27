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
} from "../../src/lib/overpass";

/** Same limits the API applies to user-added venues (src/lib/venue-server.ts). */
const MAX_NAME_LEN = 80;
const MAX_ADDRESS_FIELD_LEN = 200;
const MAX_RETRIES_LIMIT = 3;
export const WRITE_BATCH_SIZE = 200;

export interface ImportPreset {
  bbox: OverpassBbox;
  /** Used only when the OSM element has no addr:city. */
  city: string;
  state: string;
}

/** São Carlos urban area (launch city). Does not reach Ibaté or the rural districts. */
export const PRESETS: Record<string, ImportPreset> = {
  "sao-carlos": {
    bbox: { south: -22.08, west: -47.96, north: -21.96, east: -47.82 },
    city: "São Carlos",
    state: "SP",
  },
};
export const DEFAULT_PRESET = "sao-carlos";

export interface ImportOptions {
  bbox: OverpassBbox;
  /** Human label for logs: preset name or "bbox". */
  scope: string;
  fallbackCity: string;
  fallbackState: string;
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
      bbox,
      scope: "bbox",
      fallbackCity: city ?? "",
      // An operator-given city is asserted to be in SP; a bare bbox leaves both unknown.
      fallbackState: city ? "SP" : "",
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
      bbox: found.bbox,
      scope: name,
      fallbackCity: found.city,
      fallbackState: found.state,
      write,
      outFile,
      maxRetries,
    };
  }

  const bboxError = validateImportBbox(options.bbox);
  if (bboxError) return { ok: false, error: bboxError };
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
  skippedDuplicate: number;
}

function inside(bbox: OverpassBbox, lat: number, lng: number): boolean {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east;
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s);

/**
 * Maps OSM bars to venue rows. Skips unnamed places, anything outside the requested bbox/SP
 * (relation centers can fall outside) or tagged with another state, and repeated OSM ids.
 */
export function buildImportRows(
  bars: OsmBar[],
  opts: Pick<ImportOptions, "bbox" | "fallbackCity" | "fallbackState">
): MappingSummary {
  const summary: MappingSummary = { rows: [], skippedUnnamed: 0, skippedOutOfScope: 0, skippedDuplicate: 0 };
  const seen = new Set<string>();

  for (const bar of bars) {
    if (!bar.name) {
      summary.skippedUnnamed++;
      continue;
    }
    if (
      !Number.isFinite(bar.lat) ||
      !Number.isFinite(bar.lng) ||
      !inside(opts.bbox, bar.lat, bar.lng) ||
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

    summary.rows.push({
      external_id: bar.externalId,
      name: clip(bar.name, MAX_NAME_LEN),
      address: clip(bar.address, MAX_ADDRESS_FIELD_LEN),
      neighborhood: clip(bar.neighborhood, MAX_ADDRESS_FIELD_LEN),
      city: clip(bar.city || opts.fallbackCity, MAX_ADDRESS_FIELD_LEN),
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
