/**
 * Tests for the GET /api/venues selection logic: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Venue } from "../types";
import {
  dedupeVenuesByPlace,
  selectVenuesForBounds,
  venueTier,
} from "./venue-selection";

function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Bar ${overrides.id}`,
    address: "Rua A, 1",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    lat: -23.55,
    lng: -46.63,
    beerPrices: [],
    hasHappyHour: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const chope = (priceBRL: number) => ({ type: "chope" as const, label: "Chope", priceBRL });
const ids = (venues: Venue[]) => venues.map((v) => v.id);

/** Roughly a desktop zoom-12 view of central São Paulo (with the client's 1.25 overscan). */
const SP_BOUNDS = { south: -23.66, west: -46.78, north: -23.44, east: -46.48 };
const SP_CENTER = { lat: -23.55, lng: -46.63 };

test("venueTier ranks priced, then user-added, then the rest", () => {
  assert.equal(venueTier(venue({ id: "a", beerPrices: [chope(9)] })), 0);
  assert.equal(venueTier(venue({ id: "b", userAdded: true, beerPrices: [chope(9)] })), 0);
  assert.equal(venueTier(venue({ id: "c", userAdded: true })), 1);
  assert.equal(venueTier(venue({ id: "d", fromOsm: true })), 2);
});

test("selectVenuesForBounds returns everything, ranked, when under the cap", () => {
  const far = venue({ id: "far", fromOsm: true, lat: -23.65 });
  const near = venue({ id: "near", fromOsm: true, lat: -23.551 });
  const user = venue({ id: "user", userAdded: true, lat: -23.6 });
  const priced = venue({ id: "priced", beerPrices: [chope(10)], lat: -23.44 });
  const result = selectVenuesForBounds([far, near, user, priced], SP_BOUNDS, 10);
  assert.deepEqual(ids(result.venues), ["priced", "user", "near", "far"]);
  assert.equal(result.truncated, false);
});

test("selectVenuesForBounds cuts the farthest venues of the lowest tier first", () => {
  const venues = [
    venue({ id: "osm-far", fromOsm: true, lat: -23.4401 }),
    venue({ id: "osm-near", fromOsm: true, lat: -23.5501 }),
    venue({ id: "priced-far", beerPrices: [chope(8)], lat: -23.65 }),
    venue({ id: "user-far", userAdded: true, lng: -46.77 }),
  ];
  const result = selectVenuesForBounds(venues, SP_BOUNDS, 3);
  assert.deepEqual(ids(result.venues), ["priced-far", "user-far", "osm-near"]);
  assert.equal(result.truncated, true);
});

test("selectVenuesForBounds scales longitude by latitude when measuring distance", () => {
  // 0.1° of longitude at -23.5° is ~10.2 km, 0.095° of latitude is ~10.6 km.
  const east = venue({ id: "east", fromOsm: true, lng: SP_CENTER.lng + 0.1 });
  const north = venue({ id: "north", fromOsm: true, lat: SP_CENTER.lat + 0.095 });
  assert.deepEqual(ids(selectVenuesForBounds([north, east], SP_BOUNDS, 1).venues), ["east"]);
});

test("selectVenuesForBounds is deterministic for venues at the same distance", () => {
  const a = venue({ id: "a", fromOsm: true });
  const b = venue({ id: "b", fromOsm: true });
  assert.deepEqual(ids(selectVenuesForBounds([b, a], SP_BOUNDS, 2).venues), ["a", "b"]);
  assert.deepEqual(ids(selectVenuesForBounds([a, b], SP_BOUNDS, 1).venues), ["a"]);
});

test("selectVenuesForBounds is truncated when the database had more rows than fetched", () => {
  const result = selectVenuesForBounds([venue({ id: "a" })], SP_BOUNDS, 10, true);
  assert.equal(result.venues.length, 1);
  assert.equal(result.truncated, true);
});

test("dedupeVenuesByPlace keeps one venue per place, preferring user-added then priced", () => {
  const place = { name: " Bar do Zé ", lat: -23.55, lng: -46.63 };
  const osm = venue({ id: "osm", ...place, name: "bar do zé", fromOsm: true });
  const priced = venue({ id: "priced", ...place, beerPrices: [chope(9)] });
  const user = venue({ id: "user", ...place, userAdded: true });
  const other = venue({ id: "other", lat: -23.56 });
  assert.deepEqual(ids(dedupeVenuesByPlace([osm, priced, other])), ["priced", "other"]);
  assert.deepEqual(ids(dedupeVenuesByPlace([user, priced, osm])), ["user"]);
});

/** Deterministic pseudo-random numbers so the dense-area fixture is stable. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

test("selectVenuesForBounds keeps every priced and user-added bar in a dense São Paulo view", () => {
  const random = seededRandom(42);
  const point = () => ({
    lat: SP_BOUNDS.south + random() * (SP_BOUNDS.north - SP_BOUNDS.south),
    lng: SP_BOUNDS.west + random() * (SP_BOUNDS.east - SP_BOUNDS.west),
  });
  // ~700 bars like the planned OSM import: all imported at the same instant, no prices.
  const imported = Array.from({ length: 682 }, (_, i) =>
    venue({ id: `osm-${i}`, fromOsm: true, createdAt: "2026-10-01T00:00:00.000Z", ...point() })
  );
  const pricedOsm = Array.from({ length: 30 }, (_, i) =>
    venue({ id: `priced-osm-${i}`, fromOsm: true, beerPrices: [chope(10)], ...point() })
  );
  const userAdded = Array.from({ length: 15 }, (_, i) =>
    venue({ id: `user-${i}`, userAdded: true, beerPrices: [chope(12)], ...point() })
  );
  const userNoPrices = Array.from({ length: 5 }, (_, i) =>
    venue({ id: `user-empty-${i}`, userAdded: true, ...point() })
  );
  const all = [...imported, ...pricedOsm, ...userAdded, ...userNoPrices];

  const { venues, truncated } = selectVenuesForBounds(all, SP_BOUNDS, 500);
  assert.equal(venues.length, 500);
  assert.equal(truncated, true);

  const kept = new Set(ids(venues));
  for (const v of [...pricedOsm, ...userAdded, ...userNoPrices]) assert.ok(kept.has(v.id), v.id);
  // Priced bars lead the response, then user-added ones without prices, then the imports.
  assert.deepEqual(
    venues.slice(0, 50).map(venueTier),
    [...Array(45).fill(0), ...Array(5).fill(1)]
  );

  // The imports that made it are the ones nearest to the centre.
  const dist = (v: Venue) =>
    Math.hypot(v.lat - SP_CENTER.lat, (v.lng - SP_CENTER.lng) * Math.cos((SP_CENTER.lat * Math.PI) / 180));
  const keptImports = imported.filter((v) => kept.has(v.id));
  const droppedImports = imported.filter((v) => !kept.has(v.id));
  assert.equal(keptImports.length, 450);
  assert.ok(Math.max(...keptImports.map(dist)) <= Math.min(...droppedImports.map(dist)));
});
