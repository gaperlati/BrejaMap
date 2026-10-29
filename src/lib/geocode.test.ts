/**
 * Tests for the pure Nominatim helpers: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOMINATIM_MIN_INTERVAL_MS,
  dedupeNominatimResults,
  extractNominatimAddress,
  formatDistanceLabel,
  formatNominatimResult,
  placeDetailsFromNominatim,
  rankNominatimResults,
  reverseGeocode,
  searchAddress,
  searchAddressNear,
  setNominatimSchedulerForTesting,
  viewboxAround,
  type NominatimResult,
} from "./geocode";
import { createRequestScheduler } from "./request-scheduler";

// Virtual time for the shared Nominatim scheduler: waits advance the clock instantly, so
// request spacing is asserted without real 1 s sleeps.
let virtualNow = 0;
setNominatimSchedulerForTesting(
  createRequestScheduler(NOMINATIM_MIN_INTERVAL_MS, {
    now: () => virtualNow,
    sleep: (ms) =>
      new Promise((resolve) =>
        setImmediate(() => {
          virtualNow += ms;
          resolve();
        })
      ),
  })
);

const SAO_CARLOS_ADDRESS = {
  city: "São Carlos",
  municipality: "São Carlos",
  state: "São Paulo",
  "ISO3166-2-lvl4": "BR-SP",
  country: "Brasil",
};

const SAO_CARLOS_DISPLAY =
  "São Carlos, Região Geográfica Imediata de São Carlos, Região Geográfica Intermediária de Araraquara, São Paulo, Região Sudeste, Brasil";

const saoCarlosNode: NominatimResult = {
  place_id: 1,
  osm_type: "node",
  class: "place",
  type: "city",
  addresstype: "city",
  name: "São Carlos",
  importance: 0.55,
  lat: "-22.0154",
  lon: "-47.8911",
  display_name: SAO_CARLOS_DISPLAY,
  address: SAO_CARLOS_ADDRESS,
};

const saoCarlosRelation: NominatimResult = {
  ...saoCarlosNode,
  place_id: 2,
  osm_type: "relation",
  class: "boundary",
  type: "administrative",
  addresstype: "city",
  importance: 0.6,
  lat: "-21.9500",
  lon: "-47.8800",
};

const saoCarlosSC: NominatimResult = {
  place_id: 3,
  osm_type: "relation",
  class: "boundary",
  type: "administrative",
  addresstype: "town",
  name: "São Carlos",
  importance: 0.45,
  lat: "-27.0786",
  lon: "-53.0036",
  display_name: "São Carlos, Região Geográfica Imediata de Chapecó, Santa Catarina, Região Sul, Brasil",
  address: {
    town: "São Carlos",
    state: "Santa Catarina",
    "ISO3166-2-lvl4": "BR-SC",
    country: "Brasil",
  },
};

const saoCarlosRS: NominatimResult = {
  place_id: 4,
  osm_type: "node",
  class: "place",
  type: "village",
  addresstype: "village",
  name: "São Carlos",
  importance: 0.2,
  lat: "-30.3000",
  lon: "-55.0000",
  display_name: "São Carlos, Rosário do Sul, Rio Grande do Sul, Região Sul, Brasil",
  address: {
    village: "São Carlos",
    municipality: "Rosário do Sul",
    state: "Rio Grande do Sul",
    "ISO3166-2-lvl4": "BR-RS",
    country: "Brasil",
  },
};

const centroSaoCarlos: NominatimResult = {
  place_id: 5,
  class: "place",
  type: "suburb",
  addresstype: "suburb",
  name: "Centro",
  lat: "-22.0175",
  lon: "-47.8909",
  display_name: "Centro, São Carlos, Região Geográfica Imediata de São Carlos, São Paulo, Região Sudeste, 13560-000, Brasil",
  address: { suburb: "Centro", postcode: "13560-000", ...SAO_CARLOS_ADDRESS },
};

const centroCampinas: NominatimResult = {
  place_id: 6,
  class: "place",
  type: "suburb",
  addresstype: "suburb",
  name: "Centro",
  lat: "-22.9056",
  lon: "-47.0608",
  display_name: "Centro, Campinas, São Paulo, Região Sudeste, Brasil",
  address: {
    suburb: "Centro",
    city: "Campinas",
    state: "São Paulo",
    "ISO3166-2-lvl4": "BR-SP",
    country: "Brasil",
  },
};

const streetResult: NominatimResult = {
  place_id: 7,
  class: "place",
  type: "house",
  addresstype: "place",
  lat: "-22.0170",
  lon: "-47.8900",
  display_name: "2100, Av. São Carlos, Centro, São Carlos, Região Sudeste, 13560-000, Brasil",
  address: {
    house_number: "2100",
    road: "Av. São Carlos",
    suburb: "Centro",
    postcode: "13560-000",
    ...SAO_CARLOS_ADDRESS,
  },
};

const barResult: NominatimResult = {
  ...streetResult,
  place_id: 8,
  class: "amenity",
  type: "bar",
  addresstype: "amenity",
  name: "Bar do Zé",
};

function assertNoNoise(text: string) {
  assert.doesNotMatch(text, /Região|Brasil|13560/);
}

test("dedupe collapses the city node and its administrative relation", () => {
  const out = dedupeNominatimResults([saoCarlosNode, saoCarlosRelation, saoCarlosSC]);
  assert.deepEqual(out.map((r) => r.place_id), [1, 3]);
});

test("dedupe keeps homonymous streets/POIs that are far apart", () => {
  const farBar = { ...barResult, place_id: 9, lat: "-22.1000", lon: "-47.9500" };
  assert.equal(dedupeNominatimResults([barResult, farBar]).length, 2);
  const nearBar = { ...barResult, place_id: 10, lat: "-22.0171" };
  assert.equal(dedupeNominatimResults([barResult, nearBar]).length, 1);
});

test("formats a city without repeating it in the subtitle", () => {
  const f = formatNominatimResult(saoCarlosRelation);
  assert.deepEqual(f, {
    title: "São Carlos",
    subtitle: "São Paulo, SP",
    shortLabel: "São Carlos, SP",
    zoom: 13,
  });
});

test("formats a village with its parent municipality", () => {
  const f = formatNominatimResult(saoCarlosRS);
  assert.equal(f.title, "São Carlos");
  assert.equal(f.subtitle, "Rosário do Sul, RS");
  assert.equal(f.zoom, 13);
});

test("formats a neighborhood", () => {
  const f = formatNominatimResult(centroSaoCarlos);
  assert.deepEqual(f, {
    title: "Centro",
    subtitle: "São Carlos, SP",
    shortLabel: "Centro, São Carlos - SP",
    zoom: 14,
  });
  assertNoNoise(f.title + f.subtitle + f.shortLabel);
});

test("formats a street address", () => {
  const f = formatNominatimResult(streetResult);
  assert.deepEqual(f, {
    title: "Av. São Carlos, 2100",
    subtitle: "Centro · São Carlos - SP",
    shortLabel: "Av. São Carlos, 2100 — São Carlos, SP",
    zoom: 16,
  });
  assertNoNoise(f.title + f.subtitle + f.shortLabel);
});

test("formats a POI with its street in the subtitle", () => {
  const f = formatNominatimResult(barResult);
  assert.equal(f.title, "Bar do Zé");
  assert.equal(f.subtitle, "Av. São Carlos, 2100, Centro · São Carlos - SP");
  assert.equal(f.zoom, 16);
});

test("falls back to the cleaned display name when the address is missing", () => {
  const f = formatNominatimResult({
    place_id: 11,
    lat: "0",
    lon: "0",
    display_name: "Região Sudeste, Brasil, Algum Lugar",
  });
  assert.equal(f.title, "Algum Lugar");
  assertNoNoise(f.title + f.subtitle);
});

test("extracts the 2-letter state code from the state name when ISO is missing", () => {
  const parts = extractNominatimAddress({
    place_id: 12,
    lat: "0",
    lon: "0",
    display_name: "",
    address: { road: "Rua A", city: "Curitiba", state: "Paraná" },
  });
  assert.equal(parts.stateCode, "PR");
  assert.equal(parts.street, "Rua A");
});

test("ranks São Carlos, SP first and keeps the other states", () => {
  const out = rankNominatimResults(
    [saoCarlosSC, saoCarlosRS, saoCarlosNode, saoCarlosRelation],
    "sao carlos"
  );
  assert.equal(out.length, 3);
  assert.equal(extractNominatimAddress(out[0]).stateCode, "SP");
  assert.deepEqual(
    out.slice(1).map((r) => extractNominatimAddress(r).stateCode).sort(),
    ["RS", "SC"]
  );
});

test("exact title match beats a substring match", () => {
  const out = rankNominatimResults([streetResult, saoCarlosNode], "São Carlos");
  assert.equal(out[0].place_id, saoCarlosNode.place_id);
});

test("biasLocation boosts closer results", () => {
  const campinas = { lat: -22.9, lng: -47.06 };
  const saoCarlos = { lat: -22.01, lng: -47.89 };
  assert.equal(
    rankNominatimResults([centroSaoCarlos, centroCampinas], "Centro", campinas)[0].place_id,
    centroCampinas.place_id
  );
  assert.equal(
    rankNominatimResults([centroCampinas, centroSaoCarlos], "Centro", saoCarlos)[0].place_id,
    centroSaoCarlos.place_id
  );
});

// --- "Adicionar bar": nearby search, reverse geocoding and labels ---

const SAO_CARLOS_CENTER = { lat: -22.0175, lng: -47.8909 };

function street(
  placeId: number,
  city: string,
  lat: string,
  lon: string,
  extra: Partial<NominatimResult["address"]> = {}
): NominatimResult {
  return {
    place_id: placeId,
    osm_type: "way",
    class: "highway",
    type: "residential",
    addresstype: "road",
    name: "Rua Alvarenga Peixoto",
    importance: 0.1,
    lat,
    lon,
    display_name: `Rua Alvarenga Peixoto, ${city}, São Paulo, Brasil`,
    address: {
      road: "Rua Alvarenga Peixoto",
      city,
      state: "São Paulo",
      "ISO3166-2-lvl4": "BR-SP",
      ...extra,
    },
  };
}

type FetchFn = typeof globalThis.fetch;

/**
 * Replaces `fetch` with a queue of JSON responses and records the requested URLs and the
 * (virtual) time each request was sent.
 */
async function withFetch<T>(
  responses: { status?: number; body: unknown }[],
  fn: (urls: URL[], sentAt: number[]) => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  const sentAt: number[] = [];
  globalThis.fetch = (async (input: Parameters<FetchFn>[0]) => {
    urls.push(new URL(String(input)));
    sentAt.push(virtualNow);
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as FetchFn;
  try {
    return await fn(urls, sentAt);
  } finally {
    globalThis.fetch = original;
  }
}

test("viewboxAround builds a west,north,east,south box of the given radius", () => {
  const [west, north, east, south] = viewboxAround(SAO_CARLOS_CENTER, 15).split(",").map(Number);
  assert.ok(west < SAO_CARLOS_CENTER.lng && east > SAO_CARLOS_CENTER.lng);
  assert.ok(north > SAO_CARLOS_CENTER.lat && south < SAO_CARLOS_CENTER.lat);
  // ~15 km of latitude each way; longitude degrees are wider away from the equator.
  assert.ok(Math.abs(north - SAO_CARLOS_CENTER.lat - 0.1347) < 0.001);
  assert.ok(east - SAO_CARLOS_CENTER.lng > north - SAO_CARLOS_CENTER.lat);
});

test("searchAddressNear searches only around the pin first", async () => {
  const local = street(10, "São Carlos", "-22.0230", "-47.8850", { suburb: "Vila Prado" });
  const result = await withFetch([{ body: [local] }], async (urls) => {
    const r = await searchAddressNear("Rua Alvarenga Peixoto", SAO_CARLOS_CENTER);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].searchParams.get("bounded"), "1");
    assert.equal(urls[0].searchParams.get("viewbox"), viewboxAround(SAO_CARLOS_CENTER, 15));
    return r;
  });
  assert.equal(result.scope, "nearby");
  assert.deepEqual(result.results.map((r) => r.place_id), [10]);
});

test("searchAddressNear falls back to the state-wide search when nothing is nearby", async () => {
  const campinas = street(20, "Campinas", "-22.9000", "-47.0600");
  const sorocaba = street(21, "Sorocaba", "-23.5000", "-47.4500");
  const result = await withFetch(
    [{ body: [] }, { body: [sorocaba, campinas] }],
    async (urls, sentAt) => {
      const r = await searchAddressNear("Rua Alvarenga Peixoto", SAO_CARLOS_CENTER);
      assert.equal(urls.length, 2);
      assert.equal(urls[1].searchParams.get("bounded"), "0");
      // The fallback respects Nominatim's 1 request/s policy.
      assert.ok(sentAt[1] - sentAt[0] >= NOMINATIM_MIN_INTERVAL_MS);
      return r;
    }
  );
  assert.equal(result.scope, "wide");
  // Ranked by proximity to the pin: Campinas (~150 km) before Sorocaba (~200 km).
  assert.deepEqual(result.results.map((r) => r.place_id), [20, 21]);
});

test("searchAddressNear reports an HTTP error instead of falling back", async () => {
  await withFetch([{ status: 429, body: {} }], async (urls) => {
    await assert.rejects(searchAddressNear("Rua Alvarenga Peixoto", SAO_CARLOS_CENTER));
    assert.equal(urls.length, 1);
  });
});

test("search and reverse geocoding share one 1 request/s queue", async () => {
  const found = street(31, "São Carlos", "-22.0175", "-47.8909");
  await withFetch(
    [{ body: [found] }, { body: found }, { body: [found] }],
    async (urls, sentAt) => {
      await Promise.all([
        searchAddress("Rua Alvarenga Peixoto"),
        reverseGeocode(SAO_CARLOS_CENTER),
        searchAddressNear("Rua Alvarenga Peixoto", SAO_CARLOS_CENTER),
      ]);
      assert.deepEqual(
        urls.map((u) => u.pathname),
        ["/search", "/reverse", "/search"]
      );
      for (let i = 1; i < sentAt.length; i++) {
        assert.ok(sentAt[i] - sentAt[i - 1] >= NOMINATIM_MIN_INTERVAL_MS, `gap before #${i}`);
      }
    }
  );
});

test("a lookup aborted while waiting for its slot is never sent", async () => {
  const found = street(32, "São Carlos", "-22.0175", "-47.8909");
  await withFetch([{ body: [found] }, { body: [found] }], async (urls) => {
    const first = searchAddressNear("Rua Episcopal", SAO_CARLOS_CENTER);
    const stale = new AbortController();
    const superseded = reverseGeocode(SAO_CARLOS_CENTER, { signal: stale.signal });
    const latest = searchAddressNear("Rua Alvarenga Peixoto", SAO_CARLOS_CENTER);
    stale.abort();
    await assert.rejects(superseded, { name: "AbortError" });
    await Promise.all([first, latest]);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((u) => u.pathname === "/search"));
    assert.equal(urls[1].searchParams.get("q"), "Rua Alvarenga Peixoto");
  });
});

test("searchAddressNear does nothing for a blank query", async () => {
  const result = await withFetch([], () => searchAddressNear("   ", SAO_CARLOS_CENTER));
  assert.deepEqual(result, { results: [], scope: "nearby" });
});

test("reverseGeocode returns the address, null when empty, and throws on HTTP errors", async () => {
  const found = street(30, "São Carlos", "-22.0175", "-47.8909", { house_number: "120" });
  await withFetch([{ body: found }], async (urls) => {
    const r = await reverseGeocode(SAO_CARLOS_CENTER);
    assert.equal(r?.place_id, 30);
    assert.equal(urls[0].pathname, "/reverse");
    assert.equal(urls[0].searchParams.get("zoom"), "18");
  });
  await withFetch([{ body: { error: "Unable to geocode" } }], async () => {
    assert.equal(await reverseGeocode(SAO_CARLOS_CENTER), null);
  });
  await withFetch([{ status: 503, body: {} }], async () => {
    await assert.rejects(reverseGeocode(SAO_CARLOS_CENTER));
  });
});

test("placeDetailsFromNominatim keeps the street, never a nearby POI name", () => {
  const pub: NominatimResult = {
    ...street(40, "São Carlos", "-22.0175", "-47.8909", {
      house_number: "120",
      suburb: "Vila Prado",
    }),
    class: "amenity",
    type: "pub",
    addresstype: "amenity",
    name: "Outro Bar",
  };
  assert.deepEqual(placeDetailsFromNominatim(pub), {
    address: "Rua Alvarenga Peixoto, 120",
    neighborhood: "Vila Prado",
    city: "São Carlos",
    state: "SP",
  });
  const noAddress: NominatimResult = {
    place_id: 41,
    lat: "-22",
    lon: "-47",
    display_name: "Algum lugar",
  };
  assert.deepEqual(placeDetailsFromNominatim(noAddress), {
    address: "",
    neighborhood: "",
    city: "",
    state: "",
  });
});

test("formatDistanceLabel rounds to readable pt-BR distances", () => {
  assert.equal(formatDistanceLabel(0.004), "a 10 m");
  assert.equal(formatDistanceLabel(0.347), "a 350 m");
  assert.equal(formatDistanceLabel(2.345), "a 2,3 km");
  assert.equal(formatDistanceLabel(148.4), "a 148 km");
  assert.equal(formatDistanceLabel(Number.NaN), "");
});
