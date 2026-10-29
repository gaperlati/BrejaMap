/**
 * Loads the venues of a map area: debounced loads while the user pans/zooms, immediate
 * loads for explicit location picks (address search, geolocation) and the manual
 * "Buscar bares" button. Only the latest load may report a result: starting a new one,
 * dropping below the zoom policy or `cancel()` makes any pending timer and in-flight
 * request stale, so an older area can never overwrite a newer one.
 *
 * Kept free of React/Next/browser imports so it can be tested with `node --test`.
 */

import { expandBounds, type Bounds } from "./geo";
import { boundsFromCenterAndZoom, type VenueBboxCache, type VenueCacheEntry } from "./venue-state";

export type VenueAreaLoadEvent =
  | { kind: "loading" }
  | { kind: "loaded"; entry: VenueCacheEntry }
  | { kind: "error"; error: unknown }
  /** The area is below the zoom policy: loaded external venues should be dropped. */
  | { kind: "cleared" }
  /** A manual load was refused because the area is below the zoom policy. */
  | { kind: "zoom-too-low" };

/** `debounced`: pan/zoom reports. `now`: explicit location pick. `manual`: "Buscar bares". */
export type VenueAreaLoadMode = "debounced" | "now" | "manual";

export interface LoaderTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface VenueAreaLoaderOptions {
  /** Fetches the venues of the (already overscanned) request bounds. */
  fetchArea(requestBounds: Bounds): Promise<VenueCacheEntry>;
  onEvent(event: VenueAreaLoadEvent): void;
  cache: VenueBboxCache;
  /** Areas below this zoom are never loaded. */
  minZoom: number;
  debounceMs: number;
  overscanFactor: number;
  timers?: LoaderTimers;
}

export interface VenueAreaLoader {
  request(bounds: Bounds, zoom: number, mode: VenueAreaLoadMode): void;
  /** Drops the pending debounced load and makes any in-flight request stale. */
  cancel(): void;
}

const realTimers: LoaderTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createVenueAreaLoader(options: VenueAreaLoaderOptions): VenueAreaLoader {
  const { fetchArea, onEvent, cache, minZoom, debounceMs, overscanFactor } = options;
  const timers = options.timers ?? realTimers;
  let generation = 0;
  let timer: unknown = null;
  let pending: Bounds | null = null;

  const cancel = () => {
    if (timer != null) timers.clear(timer);
    timer = null;
    pending = null;
    generation++;
  };

  const load = (bounds: Bounds) => {
    const current = ++generation;
    const cached = cache.get(bounds);
    if (cached) {
      onEvent({ kind: "loaded", entry: cached });
      return;
    }
    onEvent({ kind: "loading" });
    const requestBounds = expandBounds(bounds, overscanFactor);
    fetchArea(requestBounds).then(
      (entry) => {
        cache.set(bounds, requestBounds, entry);
        if (current === generation) onEvent({ kind: "loaded", entry });
      },
      (error) => {
        if (current === generation) onEvent({ kind: "error", error });
      }
    );
  };

  return {
    request(bounds, zoom, mode) {
      if (zoom < minZoom) {
        cancel();
        onEvent(mode === "manual" ? { kind: "zoom-too-low" } : { kind: "cleared" });
        return;
      }
      if (mode !== "debounced") {
        cancel();
        load(bounds);
        return;
      }
      // While the map moves only the target of the next load changes.
      pending = bounds;
      if (timer != null) timers.clear(timer);
      timer = timers.set(() => {
        timer = null;
        const target = pending;
        pending = null;
        if (target) load(target);
      }, debounceMs);
    },
    cancel,
  };
}

/**
 * Visible bounds the map would show at `center`/`zoom` when it isn't mounted (list view).
 * With a `reference` viewport last reported by the real map, its on-screen size is kept:
 * the span scales by 2^(zoom difference) and the latitude span by the Mercator factor.
 */
export function projectViewportBounds(
  center: { lat: number; lng: number },
  zoom: number,
  reference?: { bounds: Bounds; zoom: number } | null
): Bounds {
  if (!reference) return boundsFromCenterAndZoom(center, zoom);
  const { bounds: ref } = reference;
  const scale = Math.pow(2, reference.zoom - zoom);
  const refLngSpan = ref.east - ref.west;
  const refLatSpan = ref.north - ref.south;
  if (!(refLngSpan > 0 && refLngSpan < 360 && refLatSpan > 0)) {
    return boundsFromCenterAndZoom(center, zoom);
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));
  const mercator =
    Math.cos(toRad(clampLat(center.lat))) / Math.cos(toRad(clampLat((ref.south + ref.north) / 2)));
  const halfLng = Math.min((refLngSpan * scale) / 2, 180);
  const halfLat = (refLatSpan * scale * mercator) / 2;
  return {
    south: clampLat(center.lat - halfLat),
    north: clampLat(center.lat + halfLat),
    west: center.lng - halfLng,
    east: center.lng + halfLng,
  };
}
