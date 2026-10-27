// Regression tests for the "Buscar bares" map handle.
// Run: node --test src/lib/mapHandle.test.mjs (Node >= 22.18 / 23.6, which strips TS types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachMapHandle, createMapHandle, readMapViewport } from "./mapHandle.ts";

/** Fake `google.maps.Map` whose viewport can be moved like a user pan/zoom. */
function fakeMap(view) {
  const latLng = (lat, lng) => ({ lat: () => lat, lng: () => lng });
  return {
    view,
    getBounds() {
      if (!this.view) return undefined;
      const { south, west, north, east } = this.view.bounds;
      return { getNorthEast: () => latLng(north, east), getSouthWest: () => latLng(south, west) };
    },
    getZoom() {
      return this.view?.zoom;
    },
  };
}

const SAO_CARLOS = { bounds: { south: -22.03, west: -47.91, north: -21.99, east: -47.86 }, zoom: 14 };
const SAO_PAULO = { bounds: { south: -23.58, west: -46.67, north: -23.53, east: -46.6 }, zoom: 15 };

test("readMapViewport returns null before the map has bounds", () => {
  assert.equal(readMapViewport(fakeMap(null)), null);
});

test("handle reads live bounds/zoom at call time, not a snapshot", () => {
  const map = fakeMap(SAO_CARLOS);
  const handle = createMapHandle(map);
  assert.deepEqual(handle.getCurrentBounds(), SAO_CARLOS);
  map.view = SAO_PAULO; // user pans/zooms without any React state update
  assert.deepEqual(handle.getCurrentBounds(), SAO_PAULO);
});

test("release clears the slot so an unmounted map is never used", () => {
  const slot = { current: null };
  const release = attachMapHandle(slot, createMapHandle(fakeMap(SAO_CARLOS)));
  assert.ok(slot.current);
  release();
  assert.equal(slot.current, null);
});

test("late release of an old map does not clear a newer handle (remount/StrictMode)", () => {
  const slot = { current: null };
  const releaseOld = attachMapHandle(slot, createMapHandle(fakeMap(SAO_CARLOS)));
  const newer = createMapHandle(fakeMap(SAO_PAULO));
  const releaseNew = attachMapHandle(slot, newer);
  releaseOld();
  assert.equal(slot.current, newer);
  assert.deepEqual(slot.current.getCurrentBounds(), SAO_PAULO);
  releaseNew();
  assert.equal(slot.current, null);
});

test("StrictMode attach -> release -> attach leaves the handle set", () => {
  const slot = { current: null };
  const map = fakeMap(SAO_CARLOS);
  attachMapHandle(slot, createMapHandle(map))();
  const handle = createMapHandle(map);
  attachMapHandle(slot, handle);
  assert.equal(slot.current, handle);
});
