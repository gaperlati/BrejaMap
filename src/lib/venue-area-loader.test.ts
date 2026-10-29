/**
 * Tests for the venue area loader: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Venue } from "../types";
import type { Bounds } from "./geo";
import { VenueBboxCache, boundsFromCenterAndZoom, type VenueCacheEntry } from "./venue-state";
import {
  createVenueAreaLoader,
  projectViewportBounds,
  type LoaderTimers,
  type VenueAreaLoadEvent,
} from "./venue-area-loader";

const SAO_CARLOS = { lat: -22.0174, lng: -47.886 };
const SAO_PAULO = { lat: -23.5505, lng: -46.6333 };
const SC_BOUNDS = boundsFromCenterAndZoom(SAO_CARLOS, 13);
const SP_BOUNDS = boundsFromCenterAndZoom(SAO_PAULO, 13);

function venue(id: string, at: { lat: number; lng: number }): Venue {
  return {
    id,
    name: `Bar ${id}`,
    address: "Rua A, 1",
    neighborhood: "Centro",
    city: "",
    state: "SP",
    lat: at.lat,
    lng: at.lng,
    beerPrices: [],
    hasHappyHour: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    fromOsm: true,
  };
}

function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const timers: LoaderTimers = {
    set: (fn) => {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const flush = () => {
    const fns = [...pending.values()];
    pending.clear();
    for (const fn of fns) fn();
  };
  return { timers, flush, get size() { return pending.size; } };
}

/** Loader whose fetches stay pending until the test resolves/rejects them. */
function setup() {
  const events: VenueAreaLoadEvent[] = [];
  const fetches: {
    bounds: Bounds;
    resolve: (entry: VenueCacheEntry) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const clock = fakeTimers();
  const cache = new VenueBboxCache(10);
  const loader = createVenueAreaLoader({
    fetchArea: (bounds) =>
      new Promise((resolve, reject) => fetches.push({ bounds, resolve, reject })),
    onEvent: (event) => events.push(event),
    cache,
    minZoom: 12,
    debounceMs: 150,
    overscanFactor: 1.25,
    timers: clock.timers,
  });
  const loadedIds = () =>
    events.flatMap((e) => (e.kind === "loaded" ? [e.entry.venues.map((v) => v.id)] : []));
  return { loader, events, fetches, clock, cache, loadedIds };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function contains(outer: Bounds, point: { lat: number; lng: number }): boolean {
  return (
    point.lat >= outer.south &&
    point.lat <= outer.north &&
    point.lng >= outer.west &&
    point.lng <= outer.east
  );
}

test("an explicit location pick loads its area at once, without a mounted map", async () => {
  const { loader, fetches, loadedIds } = setup();
  loader.request(SP_BOUNDS, 13, "now");
  assert.equal(fetches.length, 1);
  assert.ok(contains(fetches[0].bounds, SAO_PAULO));
  fetches[0].resolve({ venues: [venue("sp", SAO_PAULO)], truncated: false });
  await settle();
  assert.deepEqual(loadedIds(), [["sp"]]);
});

test("a pending São Carlos auto-load never fires after picking São Paulo", async () => {
  const { loader, fetches, clock } = setup();
  loader.request(SC_BOUNDS, 13, "debounced");
  assert.equal(clock.size, 1);
  loader.request(SP_BOUNDS, 13, "now");
  clock.flush();
  assert.equal(fetches.length, 1);
  assert.ok(contains(fetches[0].bounds, SAO_PAULO));
});

test("an in-flight São Carlos response cannot overwrite the newer São Paulo result", async () => {
  const { loader, fetches, loadedIds, events } = setup();
  loader.request(SC_BOUNDS, 13, "now");
  loader.request(SP_BOUNDS, 13, "now");
  fetches[1].resolve({ venues: [venue("sp", SAO_PAULO)], truncated: false });
  await settle();
  fetches[0].resolve({ venues: [venue("sc", SAO_CARLOS)], truncated: true });
  await settle();
  assert.deepEqual(loadedIds(), [["sp"]]);
  assert.equal(events.at(-1)?.kind, "loaded");
});

test("a late error from the old area does not replace the new result", async () => {
  const { loader, fetches, events } = setup();
  loader.request(SC_BOUNDS, 13, "now");
  loader.request(SP_BOUNDS, 13, "now");
  fetches[1].resolve({ venues: [], truncated: false });
  fetches[0].reject(new Error("boom"));
  await settle();
  assert.ok(!events.some((e) => e.kind === "error"));
});

test("a cached pick still makes the older in-flight request stale", async () => {
  const { loader, fetches, loadedIds } = setup();
  loader.request(SP_BOUNDS, 13, "now");
  fetches[0].resolve({ venues: [venue("sp", SAO_PAULO)], truncated: false });
  await settle();
  loader.request(SC_BOUNDS, 13, "now");
  loader.request(SP_BOUNDS, 13, "now"); // cache hit: no new fetch
  assert.equal(fetches.length, 2);
  fetches[1].resolve({ venues: [venue("sc", SAO_CARLOS)], truncated: false });
  await settle();
  assert.deepEqual(loadedIds(), [["sp"], ["sp"]]);
});

test("a stale response is still cached for its own area", async () => {
  const { loader, fetches, cache } = setup();
  loader.request(SC_BOUNDS, 13, "now");
  loader.request(SP_BOUNDS, 13, "now");
  fetches[0].resolve({ venues: [venue("sc", SAO_CARLOS)], truncated: false });
  await settle();
  assert.deepEqual(cache.get(SC_BOUNDS)?.venues.map((v) => v.id), ["sc"]);
});

test("a pick below the zoom policy clears loaded venues and stops older loads", async () => {
  const { loader, fetches, events, clock } = setup();
  loader.request(SC_BOUNDS, 13, "now");
  loader.request(SC_BOUNDS, 13, "debounced");
  loader.request(boundsFromCenterAndZoom(SAO_PAULO, 7), 7, "now");
  assert.equal(clock.size, 0);
  assert.equal(events.at(-1)?.kind, "cleared");
  fetches[0].resolve({ venues: [venue("sc", SAO_CARLOS)], truncated: false });
  await settle();
  assert.equal(events.at(-1)?.kind, "cleared");
  assert.equal(fetches.length, 1);
});

test("a manual load below the zoom policy is refused without clearing", () => {
  const { loader, fetches, events } = setup();
  loader.request(SC_BOUNDS, 10, "manual");
  assert.deepEqual(events, [{ kind: "zoom-too-low" }]);
  assert.equal(fetches.length, 0);
});

test("debounced pan/zoom reports load only the last target", () => {
  const { loader, fetches, clock } = setup();
  loader.request(SC_BOUNDS, 13, "debounced");
  loader.request(SP_BOUNDS, 13, "debounced");
  assert.equal(fetches.length, 0);
  clock.flush();
  assert.equal(fetches.length, 1);
  assert.ok(contains(fetches[0].bounds, SAO_PAULO));
});

test("cancel drops pending and in-flight loads", async () => {
  const { loader, fetches, clock, loadedIds } = setup();
  loader.request(SC_BOUNDS, 13, "now");
  loader.request(SP_BOUNDS, 13, "debounced");
  loader.cancel();
  clock.flush();
  fetches[0].resolve({ venues: [venue("sc", SAO_CARLOS)], truncated: false });
  await settle();
  assert.equal(fetches.length, 1);
  assert.deepEqual(loadedIds(), []);
});

test("projectViewportBounds is centered on the picked location", () => {
  const b = projectViewportBounds(SAO_PAULO, 13);
  assert.deepEqual(b, boundsFromCenterAndZoom(SAO_PAULO, 13));
  const withRef = projectViewportBounds(SAO_PAULO, 13, { bounds: SC_BOUNDS, zoom: 13 });
  assert.ok(Math.abs((withRef.south + withRef.north) / 2 - SAO_PAULO.lat) < 1e-9);
  assert.ok(Math.abs((withRef.west + withRef.east) / 2 - SAO_PAULO.lng) < 1e-9);
});

test("projectViewportBounds keeps the last real map size, scaled by zoom", () => {
  // Last real (mobile) map viewport over São Carlos at zoom 14.
  const reference = {
    zoom: 14,
    bounds: { south: -22.035, north: -22.0, west: -47.902, east: -47.87 },
  };
  const same = projectViewportBounds(SAO_CARLOS, 14, reference);
  assert.ok(Math.abs(same.east - same.west - 0.032) < 1e-9);
  assert.ok(Math.abs(same.north - same.south - 0.035) < 1e-3);

  const city = projectViewportBounds(SAO_PAULO, 13, reference);
  assert.ok(Math.abs(city.east - city.west - 0.064) < 1e-9);
  // Mercator: farther from the equator, the same screen height spans fewer degrees.
  const latSpan = city.north - city.south;
  assert.ok(latSpan < 0.07 && latSpan > 0.065, `latSpan ${latSpan}`);
});

test("projectViewportBounds falls back to the zoom estimate for a degenerate reference", () => {
  const degenerate = { zoom: 2, bounds: { south: -80, north: 80, west: 170, east: -170 } };
  assert.deepEqual(
    projectViewportBounds(SAO_PAULO, 13, degenerate),
    boundsFromCenterAndZoom(SAO_PAULO, 13)
  );
});
