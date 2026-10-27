/**
 * Tests for the OSM import (no network, no database): run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OverpassRateLimitError,
  OverpassTimeoutError,
  buildBarsQuery,
  elementToOsmBar,
  fetchOsmBars,
  parseRetryAfter,
  validateImportBbox,
  type OverpassResponse,
} from "../src/lib/overpass";
import {
  PRESETS,
  buildImportRows,
  createSupabaseWriter,
  parseArgs,
  readSupabaseEnv,
  writeRows,
  type VenueImportRow,
  type VenueWriter,
} from "./lib/osm-import";

const SAO_CARLOS = PRESETS["sao-carlos"];
const SAO_CARLOS_SCOPE = { bbox: SAO_CARLOS.bbox, fallbackCity: SAO_CARLOS.city, fallbackState: SAO_CARLOS.state };

const FIXTURE: OverpassResponse = {
  elements: [
    {
      type: "node",
      id: 123,
      lat: -22.0175,
      lon: -47.8908,
      tags: {
        amenity: "bar",
        name: "Bar do Centro",
        "addr:street": "Rua Episcopal",
        "addr:housenumber": "100",
        "addr:suburb": "Centro",
        "addr:city": "São Carlos",
        "addr:state": "São Paulo",
      },
    },
    // Same numeric id as the node, different element type: must be a different venue.
    { type: "way", id: 123, center: { lat: -22.0, lon: -47.9 }, tags: { amenity: "pub", name: "Pub da Praça" } },
    { type: "relation", id: 9, center: { lat: -22.01, lon: -47.88 }, tags: { amenity: "bar", name: "Boteco Relação" } },
    { type: "node", id: 5, lat: -22.02, lon: -47.89, tags: { amenity: "bar" } },
    // Relation center outside the requested bbox.
    { type: "relation", id: 10, center: { lat: -22.5, lon: -47.89 }, tags: { amenity: "bar", name: "Longe" } },
    // Tagged in another state.
    { type: "node", id: 6, lat: -22.03, lon: -47.9, tags: { amenity: "bar", name: "Bar MG", "addr:state": "MG" } },
    // Way without center: unusable.
    { type: "way", id: 7, tags: { amenity: "bar", name: "Sem coordenada" } },
    { type: "node", id: 123, lat: -22.0175, lon: -47.8908, tags: { amenity: "bar", name: "Bar do Centro" } },
  ],
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

// --- Overpass query and element mapping ---

test("query matches exactly bar|pub on nodes, ways and relations with centers", () => {
  const q = buildBarsQuery(SAO_CARLOS.bbox);
  assert.match(q, /nwr\["amenity"~"\^\(bar\|pub\)\$"\]\(-22\.08,-47\.96,-21\.96,-47\.82\)/);
  assert.match(q, /out center tags;/);
  const re = /^(bar|pub)$/;
  assert.ok(re.test("bar") && re.test("pub"));
  assert.ok(!re.test("bar_restaurant") && !re.test("biergarten_pub") && !re.test("barbecue"));
});

test("elements map to typed OSM ids with node coords or way/relation centers", () => {
  const node = elementToOsmBar(FIXTURE.elements[0]);
  const way = elementToOsmBar(FIXTURE.elements[1]);
  const rel = elementToOsmBar(FIXTURE.elements[2]);
  assert.deepEqual(node, {
    externalId: "osm-node-123",
    name: "Bar do Centro",
    lat: -22.0175,
    lng: -47.8908,
    address: "Rua Episcopal, 100",
    neighborhood: "Centro",
    city: "São Carlos",
    state: "SP",
  });
  assert.equal(way?.externalId, "osm-way-123");
  assert.deepEqual([way?.lat, way?.lng], [-22.0, -47.9]);
  assert.equal(rel?.externalId, "osm-relation-9");
  // Unknown city/state stay empty (never "São Paulo").
  assert.equal(way?.city, "");
  assert.equal(way?.state, "");
  assert.equal(elementToOsmBar(FIXTURE.elements[6]), null);
  assert.equal(elementToOsmBar({ type: "node", id: 1, lat: NaN, lon: -47 }), null);
});

// --- bbox validation ---

test("validateImportBbox accepts the São Carlos preset", () => {
  assert.equal(validateImportBbox(SAO_CARLOS.bbox), null);
});

test("validateImportBbox rejects non-finite, unordered, out-of-SP and oversized boxes", () => {
  const ok = SAO_CARLOS.bbox;
  assert.ok(validateImportBbox({ ...ok, south: NaN }));
  assert.ok(validateImportBbox({ ...ok, east: Infinity }));
  assert.ok(validateImportBbox({ ...ok, south: ok.north, north: ok.south }));
  assert.ok(validateImportBbox({ ...ok, west: ok.east, east: ok.west }));
  assert.ok(validateImportBbox({ south: 0, west: 0, north: 0.1, east: 0.1 }));
  assert.ok(validateImportBbox({ south: -23.0, west: -47.0, north: -22.0, east: -46.9 }));
});

// --- fetch: rate limits, retries, partial results ---

test("fetchOsmBars validates the bbox before any request", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return jsonResponse(FIXTURE);
  }) as typeof fetch;
  await assert.rejects(fetchOsmBars({ south: 1, west: 1, north: 0, east: 0 }, { fetchImpl }));
  assert.equal(calls, 0);
});

test("fetchOsmBars stops on 429 with no retries and honors Retry-After when retrying", async () => {
  const fail429 = (async () => jsonResponse({}, 429, { "retry-after": "7" })) as typeof fetch;
  await assert.rejects(fetchOsmBars(SAO_CARLOS.bbox, { fetchImpl: fail429 }), OverpassRateLimitError);

  const waits: number[] = [];
  let calls = 0;
  const flaky = (async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(init.method, "POST");
    return calls === 1 ? jsonResponse({}, 429, { "retry-after": "7" }) : jsonResponse(FIXTURE);
  }) as unknown as typeof fetch;
  const bars = await fetchOsmBars(SAO_CARLOS.bbox, {
    fetchImpl: flaky,
    maxRetries: 2,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [7000]);
  assert.equal(bars.length, 7);
});

test("fetchOsmBars gives up on 504 after bounded retries and on huge Retry-After", async () => {
  let calls = 0;
  const always504 = (async () => {
    calls++;
    return jsonResponse({}, 504);
  }) as typeof fetch;
  await assert.rejects(
    fetchOsmBars(SAO_CARLOS.bbox, { fetchImpl: always504, maxRetries: 2, sleep: async () => {} }),
    OverpassTimeoutError
  );
  assert.equal(calls, 3);

  calls = 0;
  const longWait = (async () => {
    calls++;
    return jsonResponse({}, 429, { "retry-after": "3600" });
  }) as typeof fetch;
  await assert.rejects(
    fetchOsmBars(SAO_CARLOS.bbox, { fetchImpl: longWait, maxRetries: 3, sleep: async () => {} }),
    OverpassRateLimitError
  );
  assert.equal(calls, 1);
});

test("fetchOsmBars retries 502 like other overload responses", async () => {
  let calls = 0;
  const bad502 = (async () => {
    calls++;
    return calls === 1 ? jsonResponse({}, 502) : jsonResponse(FIXTURE);
  }) as typeof fetch;
  const bars = await fetchOsmBars(SAO_CARLOS.bbox, { fetchImpl: bad502, maxRetries: 1, sleep: async () => {} });
  assert.equal(calls, 2);
  assert.equal(bars.length, 7);
});

test("fetchOsmBars rejects partial results reported as runtime error", async () => {
  const partial = (async () =>
    jsonResponse({ elements: [], remark: "runtime error: Query timed out" })) as typeof fetch;
  await assert.rejects(fetchOsmBars(SAO_CARLOS.bbox, { fetchImpl: partial }), OverpassTimeoutError);
});

test("parseRetryAfter handles seconds, dates and garbage", () => {
  assert.equal(parseRetryAfter("30"), 30000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(parseRetryAfter("soon"), null);
  assert.equal(parseRetryAfter(null), null);
});

// --- CLI parsing ---

test("parseArgs defaults to a São Carlos dry-run", () => {
  const r = parseArgs([]);
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  assert.equal(r.options.write, false);
  assert.equal(r.options.scope, "sao-carlos");
  assert.equal(r.options.fallbackCity, "São Carlos");
});

test("parseArgs: generic bbox leaves city unknown unless --city is given", () => {
  const plain = parseArgs(["--bbox", "-22.08,-47.96,-21.96,-47.82"]);
  assert.ok(plain.ok === true && plain.options.fallbackCity === "" && plain.options.fallbackState === "");
  const named = parseArgs(["--bbox", "-22.08,-47.96,-21.96,-47.82", "--city", "São Carlos", "--write"]);
  assert.ok(named.ok === true && named.options.fallbackCity === "São Carlos" && named.options.write);
});

test("parseArgs rejects invalid input before any network call", () => {
  const bad = [
    ["--preset", "sao-carlos", "--write", "--dry-run"],
    ["--preset", "sao-carlos", "--dry-run", "--write"],
    ["--city", "Campinas"],
    ["--write"],
    ["--bbox", "-22,-47,-21"],
    ["--bbox", "a,b,c,d"],
    ["--bbox", "-21.96,-47.96,-22.08,-47.82"],
    ["--bbox", "-23.5,-47.5,-22.5,-46.5"],
    ["--bbox", "0,0,0.1,0.1"],
    ["--preset", "campinas"],
    ["--preset", "__proto__"],
    ["--preset", "sao-carlos", "--bbox", "-22.08,-47.96,-21.96,-47.82"],
    ["--preset", "sao-carlos", "--city", "X"],
    ["--max-retries", "10"],
    ["--wirte"],
  ];
  for (const argv of bad) {
    const r = parseArgs(argv);
    assert.equal(r.ok, false, `expected error for ${argv.join(" ")}`);
  }
});

test("explicit dry-run never enables writing", () => {
  const result = parseArgs(["--preset", "sao-carlos", "--dry-run"]);
  assert.ok(result.ok === true && !result.options.write);
});

// --- Mapping to rows ---

test("buildImportRows keeps only named, in-scope, unique bars and never adds prices", () => {
  const bars = FIXTURE.elements.map(elementToOsmBar).filter((b) => b !== null);
  const { rows, skippedUnnamed, skippedOutOfScope, skippedDuplicate } = buildImportRows(bars, SAO_CARLOS_SCOPE);
  assert.deepEqual(
    rows.map((r) => r.external_id),
    ["osm-node-123", "osm-relation-9", "osm-way-123"]
  );
  assert.equal(skippedUnnamed, 1);
  assert.equal(skippedOutOfScope, 2);
  assert.equal(skippedDuplicate, 1);
  for (const row of rows) {
    assert.equal(row.source, "osm");
    assert.equal(row.user_added, false);
    assert.deepEqual(Object.keys(row).sort(), [
      "address", "city", "external_id", "lat", "lng", "name", "neighborhood", "source", "state", "user_added",
    ]);
  }
  // Preset fallback fills the city only when OSM is silent.
  assert.equal(rows.find((r) => r.external_id === "osm-way-123")?.city, "São Carlos");

  const generic = buildImportRows(bars, { bbox: SAO_CARLOS.bbox, fallbackCity: "", fallbackState: "" });
  const way = generic.rows.find((r) => r.external_id === "osm-way-123");
  assert.equal(way?.city, "");
  assert.equal(way?.state, "");
});

// --- Idempotence and preservation of existing rows ---

type StoredVenue = VenueImportRow & { has_happy_hour: boolean; happy_hour_details: string | null };

/** In-memory stand-in for venues with the unique external_id index and ON CONFLICT DO NOTHING. */
function memoryWriter(store: Map<string, StoredVenue>): VenueWriter {
  return {
    async insertNew(rows) {
      const inserted: string[] = [];
      for (const row of rows) {
        if (store.has(row.external_id)) continue;
        store.set(row.external_id, { ...row, has_happy_hour: false, happy_hour_details: null });
        inserted.push(row.external_id);
      }
      return inserted;
    },
  };
}

test("repeated imports insert nothing new and keep existing community edits", async () => {
  const bars = FIXTURE.elements.map(elementToOsmBar).filter((b) => b !== null);
  const { rows } = buildImportRows(bars, SAO_CARLOS_SCOPE);
  const store = new Map<string, StoredVenue>();
  store.set("osm-node-123", {
    ...rows[0],
    name: "Bar do Centro (editado)",
    has_happy_hour: true,
    happy_hour_details: "Seg–Sex 17h–20h",
  });

  const first = await writeRows(memoryWriter(store), rows, 2);
  assert.deepEqual(first, { inserted: 2, alreadyPresent: 1 });
  const second = await writeRows(memoryWriter(store), rows, 2);
  assert.deepEqual(second, { inserted: 0, alreadyPresent: 3 });

  assert.equal(store.size, 3);
  const edited = store.get("osm-node-123");
  assert.equal(edited?.name, "Bar do Centro (editado)");
  assert.equal(edited?.has_happy_hour, true);
  assert.equal(edited?.happy_hour_details, "Seg–Sex 17h–20h");
});

test("Supabase writer uses insert-on-conflict-do-nothing on venues only", async () => {
  const calls: { table: string; rows?: unknown; opts?: unknown; select?: string }[] = [];
  const fake = {
    from(table: string) {
      const call: (typeof calls)[number] = { table };
      calls.push(call);
      return {
        upsert(rows: VenueImportRow[], opts: unknown) {
          call.rows = rows;
          call.opts = opts;
          return {
            async select(cols: string) {
              call.select = cols;
              return { data: rows.slice(0, 1).map((r) => ({ external_id: r.external_id })), error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  const { rows } = buildImportRows(
    FIXTURE.elements.map(elementToOsmBar).filter((b) => b !== null),
    SAO_CARLOS_SCOPE
  );
  const result = await writeRows(createSupabaseWriter(fake), rows);
  assert.deepEqual(result, { inserted: 1, alreadyPresent: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "venues");
  assert.deepEqual(calls[0].opts, { onConflict: "external_id", ignoreDuplicates: true });
  assert.equal(calls[0].select, "external_id");
});

test("Supabase writer explains a missing migration", async () => {
  const fake = {
    from: () => ({
      upsert: () => ({
        select: async () => ({
          data: null,
          error: { code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  await assert.rejects(createSupabaseWriter(fake).insertNew([]), /002_venues_external_id\.sql/);
});

// --- Write configuration ---

test("readSupabaseEnv requires both values and never echoes the key", () => {
  assert.equal(readSupabaseEnv({}).ok, false);
  const missingKey = readSupabaseEnv({ SUPABASE_URL: "https://x.supabase.co" });
  assert.equal(missingKey.ok, false);
  const badUrl = readSupabaseEnv({ SUPABASE_URL: "not a url", SUPABASE_SERVICE_ROLE_KEY: "secret-key-value" });
  assert.ok(badUrl.ok === false && !badUrl.error.includes("secret-key-value"));
  const http = readSupabaseEnv({ SUPABASE_URL: "http://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
  assert.equal(http.ok, false);
  const ok = readSupabaseEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
  assert.ok(ok.ok === true && ok.host === "x.supabase.co");
});
