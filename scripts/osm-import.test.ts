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
  buildRelationGeometryQuery,
  elementToOsmBar,
  fetchOsmBars,
  fetchOsmRelation,
  parseRetryAfter,
  validateImportBbox,
  type OsmBar,
  type OverpassElement,
  type OverpassResponse,
} from "../src/lib/overpass";
import {
  PRESETS,
  assembleRings,
  boundaryFromRelation,
  buildImportRows,
  createSupabaseWriter,
  normalizeCity,
  parseArgs,
  pointInBoundary,
  readSupabaseEnv,
  writeRows,
  type Boundary,
  type LatLng,
  type VenueImportRow,
  type VenueWriter,
} from "./lib/osm-import";

const SAO_CARLOS = PRESETS["sao-carlos"];
const SAO_CARLOS_BBOX = SAO_CARLOS.bboxes[0];
const SAO_CARLOS_SCOPE = { bboxes: SAO_CARLOS.bboxes, fallbackCity: SAO_CARLOS.city, fallbackState: SAO_CARLOS.state };

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
  const q = buildBarsQuery(SAO_CARLOS_BBOX);
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
  assert.equal(validateImportBbox(SAO_CARLOS_BBOX), null);
});

test("validateImportBbox rejects non-finite, unordered, out-of-SP and oversized boxes", () => {
  const ok = SAO_CARLOS_BBOX;
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
  await assert.rejects(fetchOsmBars(SAO_CARLOS_BBOX, { fetchImpl: fail429 }), OverpassRateLimitError);

  const waits: number[] = [];
  let calls = 0;
  const flaky = (async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(init.method, "POST");
    return calls === 1 ? jsonResponse({}, 429, { "retry-after": "7" }) : jsonResponse(FIXTURE);
  }) as unknown as typeof fetch;
  const bars = await fetchOsmBars(SAO_CARLOS_BBOX, {
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
    fetchOsmBars(SAO_CARLOS_BBOX, { fetchImpl: always504, maxRetries: 2, sleep: async () => {} }),
    OverpassTimeoutError
  );
  assert.equal(calls, 3);

  calls = 0;
  const longWait = (async () => {
    calls++;
    return jsonResponse({}, 429, { "retry-after": "3600" });
  }) as typeof fetch;
  await assert.rejects(
    fetchOsmBars(SAO_CARLOS_BBOX, { fetchImpl: longWait, maxRetries: 3, sleep: async () => {} }),
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
  const bars = await fetchOsmBars(SAO_CARLOS_BBOX, { fetchImpl: bad502, maxRetries: 1, sleep: async () => {} });
  assert.equal(calls, 2);
  assert.equal(bars.length, 7);
});

test("fetchOsmBars rejects partial results reported as runtime error", async () => {
  const partial = (async () =>
    jsonResponse({ elements: [], remark: "runtime error: Query timed out" })) as typeof fetch;
  await assert.rejects(fetchOsmBars(SAO_CARLOS_BBOX, { fetchImpl: partial }), OverpassTimeoutError);
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

  const generic = buildImportRows(bars, { bboxes: SAO_CARLOS.bboxes, fallbackCity: "", fallbackState: "" });
  const way = generic.rows.find((r) => r.external_id === "osm-way-123");
  assert.equal(way?.city, "");
  assert.equal(way?.state, "");
});

test("buildImportRows maps accent/case variants of the preset city to the canonical name", () => {
  const bar = (id: number, city: string): OsmBar => ({
    externalId: `osm-node-${id}`,
    name: `Bar ${id}`,
    lat: -22.02,
    lng: -47.89,
    address: "",
    neighborhood: "",
    city,
    state: "",
  });
  const { rows } = buildImportRows([bar(1, "Sao Carlos"), bar(2, "são  carlos"), bar(3, "Ibaté"), bar(4, "")], SAO_CARLOS_SCOPE);
  assert.deepEqual(
    rows.map((r) => r.city),
    ["São Carlos", "São Carlos", "Ibaté", "São Carlos"]
  );
});

// --- Municipal boundary ---

const pt = (lat: number, lng: number): LatLng => ({ lat, lng });
const geom = (points: LatLng[]) => points.map((p) => ({ lat: p.lat, lon: p.lng }));

/** Square -24..-23 / -47..-46 split into two ways (the second reversed), a hole and an island in the hole. */
const RELATION: OverpassElement = {
  type: "relation",
  id: 298285,
  tags: { name: "São Paulo", boundary: "administrative", admin_level: "8" },
  members: [
    { type: "way", ref: 1, role: "outer", geometry: geom([pt(-24, -47), pt(-24, -46), pt(-23, -46)]) },
    { type: "node", ref: 2, role: "admin_centre" },
    { type: "way", ref: 3, role: "inner", geometry: geom([pt(-23.6, -46.6), pt(-23.6, -46.4), pt(-23.4, -46.4), pt(-23.4, -46.6), pt(-23.6, -46.6)]) },
    { type: "way", ref: 4, role: "outer", geometry: geom([pt(-24, -47), pt(-23, -47), pt(-23, -46)]) },
    { type: "way", ref: 5, role: "outer", geometry: geom([pt(-23.55, -46.55), pt(-23.55, -46.45), pt(-23.45, -46.45), pt(-23.45, -46.55), pt(-23.55, -46.55)]) },
    { type: "way", ref: 6, role: "subarea", geometry: geom([pt(0, 0), pt(1, 1)]) },
  ],
};

test("assembleRings joins out-of-order and reversed ways and rejects open rings", () => {
  const rings = assembleRings([
    [pt(0, 1), pt(1, 1)],
    [pt(0, 0), pt(0, 1)],
    [pt(0, 0), pt(1, 0), pt(1, 1)],
    [pt(5, 5), pt(5, 6), pt(6, 6), pt(5, 5)],
  ]);
  assert.equal(rings.length, 2);
  assert.deepEqual(rings[0], [pt(0, 1), pt(1, 1), pt(1, 0), pt(0, 0), pt(0, 1)]);
  assert.equal(rings[1].length, 4);

  assert.throws(() => assembleRings([[pt(0, 0), pt(0, 1)], [pt(0, 1), pt(1, 1)]]), /anel aberto/);
  assert.throws(() => assembleRings([[pt(0, 0), pt(0, 1), pt(0, 0)]]), /degenerado/);
  assert.deepEqual(assembleRings([]), []);
});

test("boundaryFromRelation builds outer/inner rings from out geom members", () => {
  const boundary = boundaryFromRelation(RELATION);
  assert.equal(boundary.name, "São Paulo");
  assert.equal(boundary.outer.length, 2);
  assert.equal(boundary.inner.length, 1);
  assert.equal(boundary.outer[0].length, 5);

  const missingNode: OverpassElement = {
    ...RELATION,
    members: [{ type: "way", ref: 9, role: "outer", geometry: [{ lat: 0, lon: 0 }, null, { lat: 0, lon: 0 }] }],
  };
  assert.throws(() => boundaryFromRelation(missingNode), /geometria incompleta/);
  assert.throws(() => boundaryFromRelation({ ...RELATION, members: [] }), /sem anel externo/);
  assert.throws(() => boundaryFromRelation({ ...RELATION, members: RELATION.members!.slice(0, 1) }), /anel aberto/);
});

test("pointInBoundary honors holes and islands inside holes", () => {
  const boundary = boundaryFromRelation(RELATION);
  assert.equal(pointInBoundary(boundary, -23.8, -46.8), true);
  assert.equal(pointInBoundary(boundary, -23.58, -46.58), false, "inside the hole");
  assert.equal(pointInBoundary(boundary, -23.5, -46.5), true, "island inside the hole");
  assert.equal(pointInBoundary(boundary, -22.9, -46.5), false);
  assert.equal(pointInBoundary(boundary, -23.5, -45.9), false);
});

test("normalizeCity folds accents, case and spaces only for the canonical city", () => {
  assert.equal(normalizeCity("Sao Paulo", "São Paulo"), "São Paulo");
  assert.equal(normalizeCity("são paulo", "São Paulo"), "São Paulo");
  assert.equal(normalizeCity(" SAO  PAULO ", "São Paulo"), "São Paulo");
  assert.equal(normalizeCity("Osasco", "São Paulo"), "Osasco");
  assert.equal(normalizeCity("", "São Paulo"), "");
  assert.equal(normalizeCity("Sao Paulo", ""), "Sao Paulo");
});

test("buildImportRows with several bboxes and a boundary dedupes, filters and sets the canonical city", () => {
  const boundary: Boundary = boundaryFromRelation(RELATION);
  const bar = (id: number, lat: number, lng: number, city = ""): OsmBar => ({
    externalId: `osm-node-${id}`,
    name: `Bar ${id}`,
    lat,
    lng,
    address: "",
    neighborhood: "",
    city,
    state: "",
  });
  const north = [bar(1, -23.2, -46.8, "Sao Paulo"), bar(2, -23.5, -46.2, "São paulo"), bar(3, -23.1, -45.9, "Guarulhos"), bar(4, -23.5, -46.8)];
  // Bar 4 sits on the shared edge and comes back from both requests; bar 6 is in the hole.
  const south = [bar(4, -23.5, -46.8), bar(5, -23.9, -46.5, "Osasco"), bar(6, -23.58, -46.58, "sao paulo")];
  const summary = buildImportRows([...north, ...south], {
    bboxes: [
      { south: -23.5, west: -47, north: -23, east: -45.8 },
      { south: -24, west: -47, north: -23.5, east: -45.8 },
    ],
    fallbackCity: "São Paulo",
    fallbackState: "SP",
    boundary,
  });
  assert.deepEqual(
    summary.rows.map((r) => [r.external_id, r.city, r.state]),
    [
      ["osm-node-1", "São Paulo", "SP"],
      ["osm-node-2", "São Paulo", "SP"],
      ["osm-node-4", "São Paulo", "SP"],
      ["osm-node-5", "São Paulo", "SP"],
    ]
  );
  assert.equal(summary.skippedDuplicate, 1);
  assert.equal(summary.skippedOutsideBoundary, 2);
  assert.equal(summary.skippedOutOfScope, 0);
});

test("sao-paulo preset: two valid bboxes covering the municipality plus its boundary relation", () => {
  const sp = PRESETS["sao-paulo"];
  assert.equal(sp.boundaryRelationId, 298285);
  assert.equal(sp.city, "São Paulo");
  assert.equal(sp.bboxes.length, 2);
  for (const bbox of sp.bboxes) assert.equal(validateImportBbox(bbox), null);
  assert.equal(Math.min(...sp.bboxes.map((b) => b.south)), -24.01);
  assert.equal(Math.max(...sp.bboxes.map((b) => b.north)), -23.36);
  assert.equal(sp.bboxes[0].south, sp.bboxes[1].north, "bboxes must be contiguous");
  for (const bbox of sp.bboxes) assert.deepEqual([bbox.west, bbox.east], [-46.83, -46.36]);

  const r = parseArgs(["--preset", "sao-paulo"]);
  assert.ok(r.ok === true);
  if (r.ok !== true) return;
  assert.equal(r.options.boundaryRelationId, 298285);
  assert.equal(r.options.bboxes.length, 2);
  const generic = parseArgs(["--bbox", "-22.08,-47.96,-21.96,-47.82"]);
  assert.ok(generic.ok === true && generic.options.boundaryRelationId === null);
});

test("fetchOsmRelation requests out geom and fails when the relation is missing", async () => {
  assert.match(buildRelationGeometryQuery(298285), /rel\(298285\);\s*out geom;/);
  let calls = 0;
  const found = (async (_url: string, init: RequestInit) => {
    calls++;
    assert.match(decodeURIComponent(String(init.body)), /rel\(298285\)/);
    return jsonResponse({ elements: [RELATION] });
  }) as unknown as typeof fetch;
  const rel = await fetchOsmRelation(298285, { fetchImpl: found });
  assert.equal(rel.id, 298285);

  const empty = (async () => jsonResponse({ elements: [] })) as typeof fetch;
  await assert.rejects(fetchOsmRelation(298285, { fetchImpl: empty }), /298285/);
  const overloaded = (async () => jsonResponse({}, 504)) as typeof fetch;
  await assert.rejects(fetchOsmRelation(298285, { fetchImpl: overloaded }), OverpassTimeoutError);
  await assert.rejects(fetchOsmRelation(0, { fetchImpl: found }));
  assert.equal(calls, 1);
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
