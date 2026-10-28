/**
 * Tests for the pure map marker clustering: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Venue } from "../types";
import { getMinBeerPrice } from "./venue-state";
import {
  clusterMapVenues,
  formatPriceLabel,
  projectToPixels,
  SELECTED_Z_INDEX,
  type ClusterMarkerItem,
  type MapMarkerItem,
  type VenueMarkerItem,
} from "./map-markers";

function venue(
  id: string,
  lat: number,
  lng: number,
  price?: number,
  overrides: Partial<Venue> = {}
): Venue {
  return {
    id,
    name: `Bar ${id}`,
    address: "Rua A, 1",
    neighborhood: "Centro",
    city: "São Carlos",
    state: "SP",
    lat,
    lng,
    beerPrices:
      price == null ? [] : [{ type: "chope", label: "Chope", priceBRL: price }],
    hasHappyHour: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_LAT = -22.0175;
const BASE_LNG = -47.8908;

function run(venues: Venue[], zoom: number, selectedVenueId: string | null = null) {
  return clusterMapVenues(venues, { zoom, selectedVenueId, getMinPrice: getMinBeerPrice });
}

function clusters(items: MapMarkerItem[]): ClusterMarkerItem[] {
  return items.filter((i): i is ClusterMarkerItem => i.kind === "cluster");
}

function singles(items: MapMarkerItem[]): VenueMarkerItem[] {
  return items.filter((i): i is VenueMarkerItem => i.kind === "venue");
}

test("projectToPixels: world doubles in size with each zoom level", () => {
  const z0 = projectToPixels(0, 0, 0);
  assert.deepEqual(z0, { x: 128, y: 128 });
  const a = projectToPixels(BASE_LAT, BASE_LNG, 14);
  const b = projectToPixels(BASE_LAT, BASE_LNG, 15);
  assert.ok(Math.abs(b.x - a.x * 2) < 1e-6);
  assert.ok(Math.abs(b.y - a.y * 2) < 1e-6);
});

test("distant venues stay individual markers", () => {
  const items = run(
    [
      venue("a", BASE_LAT, BASE_LNG, 9),
      venue("b", BASE_LAT + 0.05, BASE_LNG, 8),
      venue("c", BASE_LAT, BASE_LNG + 0.05),
    ],
    14
  );
  assert.equal(items.length, 3);
  assert.equal(clusters(items).length, 0);
});

test("overlapping priced venues merge into a cluster anchored on the cheapest bar", () => {
  const cheap = venue("cheap", BASE_LAT + 0.0001, BASE_LNG + 0.0001, 7.5);
  const items = run(
    [venue("pricey", BASE_LAT, BASE_LNG, 12), cheap, venue("mid", BASE_LAT, BASE_LNG + 0.0002, 9)],
    15
  );
  assert.equal(items.length, 1);
  const [cluster] = clusters(items);
  assert.equal(cluster.count, 3);
  assert.equal(cluster.minPrice, 7.5);
  assert.equal(cluster.lat, cheap.lat);
  assert.equal(cluster.lng, cheap.lng);
  assert.equal(cluster.id, "cluster:cheap");
  assert.equal(cluster.expansionZoom, 17);
  assert.deepEqual(
    cluster.venues.map((v) => v.id),
    ["cheap", "mid", "pricey"]
  );
});

test("cheaper priced single bubbles get a higher zIndex", () => {
  const items = singles(
    run([venue("a", BASE_LAT, BASE_LNG, 10), venue("b", BASE_LAT + 0.05, BASE_LNG, 6)], 14)
  );
  const a = items.find((i) => i.id === "a")!;
  const b = items.find((i) => i.id === "b")!;
  assert.ok(b.zIndex > a.zIndex);
  assert.ok(a.zIndex < SELECTED_Z_INDEX);
});

test("expansionZoom is capped at 18", () => {
  const items = run([venue("a", BASE_LAT, BASE_LNG, 8), venue("b", BASE_LAT, BASE_LNG, 9)], 17);
  assert.equal(clusters(items)[0].expansionZoom, 18);
});

test("the selected venue is never merged into a cluster", () => {
  const items = run(
    [
      venue("sel", BASE_LAT, BASE_LNG, 15),
      venue("x", BASE_LAT, BASE_LNG, 6),
      venue("y", BASE_LAT, BASE_LNG, 7),
    ],
    14,
    "sel"
  );
  const sel = singles(items).find((i) => i.id === "sel");
  assert.ok(sel);
  assert.equal(sel.tier, "selected");
  assert.equal(sel.zIndex, SELECTED_Z_INDEX);
  for (const c of clusters(items)) {
    assert.ok(!c.venues.some((v) => v.id === "sel"));
  }
  // The others still group together, with the cheapest one as primary.
  const [cluster] = clusters(items);
  assert.equal(cluster.count, 2);
  assert.equal(cluster.minPrice, 6);
});

test("at zoom >= 18 overlapping venues are never clustered", () => {
  const venues = [
    venue("a", BASE_LAT, BASE_LNG, 8),
    venue("b", BASE_LAT, BASE_LNG, 9),
    venue("c", BASE_LAT, BASE_LNG),
  ];
  for (const zoom of [18, 19, 21]) {
    const items = run(venues, zoom);
    assert.equal(items.length, 3);
    assert.equal(clusters(items).length, 0);
  }
});

test("unpriced venues yield to priced ones and join their cluster", () => {
  const items = run(
    [venue("osm1", BASE_LAT, BASE_LNG), venue("priced", BASE_LAT, BASE_LNG + 0.0001, 8)],
    15
  );
  assert.equal(items.length, 1);
  const [cluster] = clusters(items);
  assert.equal(cluster.id, "cluster:priced");
  assert.equal(cluster.minPrice, 8);
  assert.deepEqual(
    cluster.venues.map((v) => v.id),
    ["priced", "osm1"]
  );
});

test("unpriced-only overlaps form an unpriced cluster at their centroid", () => {
  const items = run(
    [
      venue("o1", BASE_LAT, BASE_LNG),
      venue("o2", BASE_LAT + 0.0002, BASE_LNG),
      venue("o3", BASE_LAT, BASE_LNG + 0.0002),
    ],
    15
  );
  assert.equal(items.length, 1);
  const [cluster] = clusters(items);
  assert.equal(cluster.count, 3);
  assert.equal(cluster.minPrice, Infinity);
  assert.ok(Math.abs(cluster.lat - (BASE_LAT + 0.0002 / 3)) < 1e-9);
  assert.ok(Math.abs(cluster.lng - (BASE_LNG + 0.0002 / 3)) < 1e-9);
  // Unpriced clusters sit below priced markers.
  const priced = singles(run([venue("p", BASE_LAT + 0.05, BASE_LNG, 9)], 15))[0];
  assert.ok(cluster.zIndex < priced.zIndex);
});

test("isolated unpriced venues are compact dots below zoom 16 and pins from 16", () => {
  const v = [venue("osm", BASE_LAT, BASE_LNG)];
  const low = singles(run(v, 15))[0];
  assert.equal(low.tier, "unpriced");
  assert.equal(low.compact, true);
  const high = singles(run(v, 16))[0];
  assert.equal(high.tier, "unpriced");
  assert.equal(high.compact, false);
});

test("formatPriceLabel uses a pt-BR decimal comma", () => {
  assert.equal(formatPriceLabel(8), "R$ 8,0");
  assert.equal(formatPriceLabel(12.5), "R$ 12,5");
});
