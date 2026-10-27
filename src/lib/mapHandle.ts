/**
 * Imperative access to the live Google Map, handed to the page through the
 * `onReady` callback of `Map` (a `ref` on the `next/dynamic` wrapper is not
 * forwarded reliably, which left "Buscar bares" using stale state bounds).
 *
 * Kept free of React/Google imports so it can be tested with `node --test`.
 */

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface MapViewport {
  bounds: MapBounds;
  zoom: number;
}

export interface MapHandle {
  /** Reads bounds/zoom from the map instance at call time (never cached). */
  getCurrentBounds(): MapViewport | null;
}

interface LatLngLike {
  lat(): number;
  lng(): number;
}

/** Minimal subset of `google.maps.Map` used here. */
export interface MapLike {
  getBounds(): { getNorthEast(): LatLngLike; getSouthWest(): LatLngLike } | null | undefined;
  getZoom(): number | null | undefined;
}

export function readMapViewport(map: MapLike): MapViewport | null {
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  if (!bounds || zoom == null) return null;
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return {
    bounds: { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() },
    zoom,
  };
}

export function createMapHandle(map: MapLike): MapHandle {
  return { getCurrentBounds: () => readMapViewport(map) };
}

/**
 * Stores `handle` in `slot` and returns a release function that clears it only
 * if it still holds this same handle, so a late cleanup from an old map
 * (remount, StrictMode double effects) never wipes the handle of a newer one.
 */
export function attachMapHandle(
  slot: { current: MapHandle | null },
  handle: MapHandle
): () => void {
  slot.current = handle;
  return () => {
    if (slot.current === handle) slot.current = null;
  };
}
