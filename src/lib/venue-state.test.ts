/**
 * Tests for the pure venue state helpers: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Venue } from "../types";
import {
  bboxCacheKey,
  extractNeighborhoods,
  filterAndSortVenues,
  getMinBeerPrice,
  mergeExternalVenues,
  type VenueFilterOptions,
} from "./venue-state";

function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Bar ${overrides.id}`,
    address: "Rua A, 1",
    neighborhood: "Centro",
    city: "São Carlos",
    state: "SP",
    lat: -22.0,
    lng: -47.9,
    beerPrices: [],
    hasHappyHour: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const chope = (priceBRL: number) => ({ type: "chope" as const, label: "Chope", priceBRL });
const lata = (priceBRL: number) => ({ type: "lata" as const, label: "Lata", priceBRL });

const BOUNDS = { south: -22.1, west: -48.0, north: -21.9, east: -47.8 };

function options(overrides: Partial<VenueFilterOptions> = {}): VenueFilterOptions {
  return {
    mapBounds: BOUNDS,
    maxPrice: null,
    beerType: "",
    neighborhood: "",
    happyHourOnly: false,
    sort: "price_asc",
    userLocation: null,
    mapCenter: { lat: -22.0, lng: -47.9 },
    ...overrides,
  };
}

const ids = (venues: Venue[]) => venues.map((v) => v.id);

test("bboxCacheKey rounds each edge to two decimals", () => {
  assert.equal(
    bboxCacheKey({ south: -22.01234, west: -47.98765, north: -21.995, east: -47.8 }),
    "-22.01,-47.99,-22.00,-47.80"
  );
});

test("getMinBeerPrice returns the cheapest price or Infinity without prices", () => {
  assert.equal(getMinBeerPrice(venue({ id: "a", beerPrices: [chope(12), lata(6.5)] })), 6.5);
  assert.equal(getMinBeerPrice(venue({ id: "b" })), Infinity);
});

test("mergeExternalVenues keeps prices already known for an external venue", () => {
  const priced = venue({ id: "g1", fromGoogle: true, beerPrices: [chope(10)] });
  const fresh = venue({ id: "g1", fromGoogle: true, name: "Bar g1" });
  const merged = mergeExternalVenues([priced], [fresh]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].beerPrices, [chope(10)]);
});

test("mergeExternalVenues replaces an unpriced external venue with the fresh copy", () => {
  const old = venue({ id: "g1", fromGoogle: true, address: "old" });
  const fresh = venue({ id: "g1", fromGoogle: true, address: "new" });
  const merged = mergeExternalVenues([old], [fresh]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].address, "new");
});

test("mergeExternalVenues keeps non-external venues and previous external ones", () => {
  const local = venue({ id: "local", lat: -22.01 });
  const prevExternal = venue({ id: "g1", fromOsm: true, lat: -22.02 });
  const fresh = venue({ id: "g2", fromGoogle: true, lat: -22.03 });
  assert.deepEqual(ids(mergeExternalVenues([local, prevExternal], [fresh])), ["local", "g2", "g1"]);
});

test("mergeExternalVenues caps external venues at maxExternal, evicting the oldest", () => {
  const prev = [
    venue({ id: "local", lat: -21.5 }),
    venue({ id: "g1", fromGoogle: true, lat: -22.01 }),
  ];
  const fresh = [
    venue({ id: "g2", fromGoogle: true, lat: -22.02 }),
    venue({ id: "g3", fromGoogle: true, lat: -22.03 }),
  ];
  // Order before capping is fresh ids first, then previous-only ids: g2, g3, g1.
  assert.deepEqual(ids(mergeExternalVenues(prev, fresh, 2)), ["local", "g3", "g1"]);
});

test("mergeExternalVenues dedupes by place preferring user-added, then priced, then newer", () => {
  // The user-added/priced bonuses are added to the createdAt timestamp, so they break ties
  // between entries created at the same time; otherwise the newer entry wins.
  const place = { name: " Bar do Zé ", lat: -22.0, lng: -47.9 };
  const userAdded = venue({ id: "u", ...place, userAdded: true, createdAt: "2026-06-01T00:00:00.000Z" });
  const priced = venue({ id: "p", ...place, beerPrices: [chope(9)], createdAt: "2026-06-01T00:00:00.000Z" });
  assert.deepEqual(ids(mergeExternalVenues([userAdded, priced], [])), ["u"]);
  assert.deepEqual(ids(mergeExternalVenues([priced, userAdded], [])), ["u"]);

  const external = venue({
    id: "g1",
    ...place,
    name: "bar do zé",
    fromGoogle: true,
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  assert.deepEqual(ids(mergeExternalVenues([priced], [external])), ["p"]);

  const older = venue({ id: "old", ...place, createdAt: "2025-01-01T00:00:00.000Z" });
  const newer = venue({ id: "new", ...place, createdAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(ids(mergeExternalVenues([newer, older], [])), ["new"]);
  assert.deepEqual(ids(mergeExternalVenues([older, newer], [])), ["new"]);
});

test("filterAndSortVenues drops venues outside the map bounds", () => {
  const inside = venue({ id: "in" });
  const outside = venue({ id: "out", lat: -23.5 });
  assert.deepEqual(ids(filterAndSortVenues([inside, outside], options())), ["in"]);
});

test("filterAndSortVenues applies price, beer type, neighborhood and happy hour filters", () => {
  const a = venue({ id: "a", beerPrices: [chope(8)], neighborhood: "Centro", hasHappyHour: true });
  const b = venue({ id: "b", beerPrices: [lata(15)], neighborhood: "Vila Prado" });
  const c = venue({ id: "c", beerPrices: [lata(6)], neighborhood: "centro" });
  const all = [a, b, c];

  assert.deepEqual(ids(filterAndSortVenues(all, options({ maxPrice: 10 }))), ["c", "a"]);
  assert.deepEqual(ids(filterAndSortVenues(all, options({ beerType: "lata" }))), ["c", "b"]);
  assert.deepEqual(ids(filterAndSortVenues(all, options({ neighborhood: "CENTRO" }))), ["c", "a"]);
  assert.deepEqual(ids(filterAndSortVenues(all, options({ happyHourOnly: true }))), ["a"]);
});

test("filterAndSortVenues sorts by price, name and distance", () => {
  const cheap = venue({ id: "cheap", name: "Zeca", beerPrices: [chope(5)], lat: -22.05 });
  const pricey = venue({ id: "pricey", name: "Ágora", beerPrices: [chope(20)], lat: -21.95 });
  const noPrice = venue({ id: "none", name: "Bar", lat: -22.0 });
  const all = [pricey, noPrice, cheap];

  assert.deepEqual(ids(filterAndSortVenues(all, options({ sort: "price_asc" }))), ["cheap", "pricey", "none"]);
  assert.deepEqual(ids(filterAndSortVenues(all, options({ sort: "price_desc" }))), ["none", "pricey", "cheap"]);
  assert.deepEqual(ids(filterAndSortVenues(all, options({ sort: "name" }))), ["pricey", "none", "cheap"]);

  // Distance uses the map center when the user location is unknown...
  assert.deepEqual(
    ids(filterAndSortVenues(all, options({ sort: "distance", mapCenter: { lat: -22.06, lng: -47.9 } }))),
    ["cheap", "none", "pricey"]
  );
  // ...and the user location when known.
  assert.deepEqual(
    ids(
      filterAndSortVenues(
        all,
        options({
          sort: "distance",
          mapCenter: { lat: -22.06, lng: -47.9 },
          userLocation: { lat: -21.94, lng: -47.9 },
        })
      )
    ),
    ["pricey", "none", "cheap"]
  );
});

test("filterAndSortVenues does not mutate the input list", () => {
  const all = [venue({ id: "b", beerPrices: [chope(9)] }), venue({ id: "a", beerPrices: [chope(4)] })];
  filterAndSortVenues(all, options());
  assert.deepEqual(ids(all), ["b", "a"]);
});

test("extractNeighborhoods trims, dedupes, drops empty names and sorts in pt-BR order", () => {
  const venues = [
    venue({ id: "1", neighborhood: " Vila Prado " }),
    venue({ id: "2", neighborhood: "Centro" }),
    venue({ id: "3", neighborhood: "Vila Prado" }),
    venue({ id: "4", neighborhood: "  " }),
    venue({ id: "5", neighborhood: "Água Vermelha" }),
  ];
  assert.deepEqual(extractNeighborhoods(venues), ["Água Vermelha", "Centro", "Vila Prado"]);
});
