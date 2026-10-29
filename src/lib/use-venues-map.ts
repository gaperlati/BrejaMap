"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SAO_CARLOS_CENTER, DEFAULT_ZOOM } from "@/data/venues";
import {
  fetchVenuesInBounds,
  loadVenuesErrorMessage,
  createVenue,
  updateVenuePrices,
  saveErrorMessage,
  type ApiError,
} from "@/lib/api";
import { expandBounds, type Bounds } from "@/lib/geo";
import { attachMapHandle, type MapHandle } from "@/lib/mapHandle";
import { getAccessToken } from "@/lib/supabase-browser";
import {
  apiVenueToVenue,
  boundsFromCenterAndZoom,
  isFromExternal,
  mergeExternalVenues,
  VenueBboxCache,
} from "@/lib/venue-state";
import type { Venue } from "@/types";

/** Zoom threshold: allow places search when zoom >= this. */
const PLACES_ZOOM_THRESHOLD = 12;
/** Minimum ms between two venue requests (0 = disabled). */
const PLACES_REQUEST_COOLDOWN_MS = 0;
/** Debounce before auto-loading venues after user stops panning/zooming. */
const AUTO_LOAD_DEBOUNCE_MS = 150;
/** Expand visible bounds by this factor when calling the API (overscanning for smoother pans). */
const OVERSCAN_FACTOR = 1.25;
const PLACES_CACHE_MAX_ENTRIES = 30;
const PRECISE_LOCATION_ZOOM = 14;
/** Startup geolocation timeout; past it the map simply stays on the São Carlos default. */
const INITIAL_GEOLOCATION_TIMEOUT_MS = 4000;
/** Center shift (degrees) on an idle report that counts as the user having moved the map. */
const USER_MOVE_THRESHOLD_DEG = 0.002;

export type OsmLoadState = "idle" | "loading" | "error" | "success";

/**
 * Map viewport, user location and the loaded venues: initial geolocation, venue loading
 * on pan/zoom (cached + debounced) and saving new venues/prices.
 */
export function useVenuesMap() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(SAO_CARLOS_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [mapBounds, setMapBounds] = useState<Bounds>(() =>
    boundsFromCenterAndZoom(SAO_CARLOS_CENTER, DEFAULT_ZOOM)
  );
  const [searchMarker, setSearchMarker] = useState<{ lat: number; lng: number } | null>(null);
  /** Last known browser geolocation; origin for "Mais perto" sorting. */
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [osmLoadState, setOsmLoadState] = useState<OsmLoadState>("idle");
  const [osmError, setOsmError] = useState<string | null>(null);
  /** The last loaded view hit the API cap: some bars in it are not shown until the user zooms in. */
  const [venuesTruncated, setVenuesTruncated] = useState(false);
  const osmRequestIdRef = useRef(0);
  const osmCacheRef = useRef(new VenueBboxCache(PLACES_CACHE_MAX_ENTRIES));
  const lastOverpassRequestTimeRef = useRef(0);
  const autoLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsForAutoLoadRef = useRef<{ bounds: Bounds; zoom: number } | null>(null);
  /** Live map handle from `Map`'s `onReady` (null while the map isn't mounted). */
  const mapHandleRef = useRef<MapHandle | null>(null);
  const initialLocationResolvedRef = useRef(false);
  /** Set once the user pans/zooms, searches or locates; startup geolocation then won't recenter. */
  const userInteractedRef = useRef(false);

  /**
   * Load places for the given bounds (cache or API).
   * Used by both manual "Buscar bares" and auto-load on pan/zoom.
   * When isManual is false, cooldown/zoom errors are not shown to the user.
   */
  const tryLoadPlacesForBounds = useCallback(
    (bounds: Bounds, zoom: number, isManual: boolean) => {
      if (zoom < PLACES_ZOOM_THRESHOLD) {
        if (isManual) setOsmError("Dê mais zoom no mapa para buscar bares desta área.");
        return;
      }

      const cache = osmCacheRef.current;

      const mergeExternalIntoState = (newVenues: Venue[]) => {
        setVenues((prev) => mergeExternalVenues(prev, newVenues));
      };

      const cached = cache.get(bounds);
      if (cached) {
        mergeExternalIntoState(cached.venues);
        setVenuesTruncated(cached.truncated);
        setOsmLoadState("success");
        setOsmError(null);
        return;
      }

      const now = Date.now();
      if (
        PLACES_REQUEST_COOLDOWN_MS > 0 &&
        now - lastOverpassRequestTimeRef.current < PLACES_REQUEST_COOLDOWN_MS
      ) {
        if (isManual) setOsmError("Aguarde um pouco entre as buscas.");
        return;
      }

      const requestId = ++osmRequestIdRef.current;
      setOsmLoadState("loading");
      setOsmError(null);
      if (PLACES_REQUEST_COOLDOWN_MS > 0) lastOverpassRequestTimeRef.current = now;

      const requestBounds = expandBounds(bounds, OVERSCAN_FACTOR);

      fetchVenuesInBounds(requestBounds)
        .then(({ venues: apiVenues, truncated }) => {
          if (requestId !== osmRequestIdRef.current) return;
          const asVenues: Venue[] = apiVenues.map(apiVenueToVenue);
          mergeExternalIntoState(asVenues);
          setVenuesTruncated(truncated);
          setOsmLoadState("success");
          cache.set(bounds, requestBounds, { venues: asVenues, truncated });
        })
        .catch((e) => {
          if (requestId !== osmRequestIdRef.current) return;
          setVenuesTruncated(false);
          setOsmLoadState("error");
          setOsmError(loadVenuesErrorMessage(e));
        });
    },
    []
  );

  // Sync map view to state when user pans/zooms; clear venues when zoom < threshold; trigger auto-load when zoom >= threshold
  const handleMapBoundsChange = useCallback(
    (bounds: Bounds, zoom: number, reason: "idle" | "changing") => {
      // Evita feedback/jank: enquanto o usuário arrasta, não sincronizamos center/zoom/state
      // com props (isso causa loop com `map.panTo`/`map.setZoom` no componente Map).
      if (reason === "idle") {
        const center = {
          lat: (bounds.south + bounds.north) / 2,
          lng: (bounds.west + bounds.east) / 2,
        };
        // The first idle report at the default view comes from the initial mount, not the user.
        if (
          zoom !== DEFAULT_ZOOM ||
          Math.abs(center.lat - SAO_CARLOS_CENTER.lat) > USER_MOVE_THRESHOLD_DEG ||
          Math.abs(center.lng - SAO_CARLOS_CENTER.lng) > USER_MOVE_THRESHOLD_DEG
        ) {
          userInteractedRef.current = true;
        }
        setMapCenter(center);
        setMapZoom(zoom);
        setMapBounds(bounds);
      }

      if (zoom < PLACES_ZOOM_THRESHOLD) {
        if (reason === "idle") {
          if (autoLoadTimeoutRef.current) {
            clearTimeout(autoLoadTimeoutRef.current);
            autoLoadTimeoutRef.current = null;
          }
          lastBoundsForAutoLoadRef.current = null;
          setVenues((prev) => prev.filter((v) => !isFromExternal(v)));
          setOsmError(null);
          setVenuesTruncated(false);
          setOsmLoadState("idle");
        }
        return;
      }

      // Mesmo durante o movimento, apenas atualizamos o "alvo" do próximo carregamento.
      lastBoundsForAutoLoadRef.current = { bounds, zoom };
      if (autoLoadTimeoutRef.current) clearTimeout(autoLoadTimeoutRef.current);
      autoLoadTimeoutRef.current = setTimeout(() => {
        autoLoadTimeoutRef.current = null;
        const b = lastBoundsForAutoLoadRef.current;
        if (b) tryLoadPlacesForBounds(b.bounds, b.zoom, false);
      }, AUTO_LOAD_DEBOUNCE_MS);
    },
    [tryLoadPlacesForBounds]
  );

  const handleMapReady = useCallback(
    (handle: MapHandle) => attachMapHandle(mapHandleRef, handle),
    []
  );

  const handleLoadPlacesBars = useCallback(() => {
    const current = mapHandleRef.current?.getCurrentBounds();
    const zoom = current?.zoom ?? mapZoom;
    const bounds =
      current?.bounds ?? boundsFromCenterAndZoom(mapCenter, mapZoom);
    tryLoadPlacesForBounds(bounds, zoom, true);
  }, [mapZoom, mapCenter, tryLoadPlacesForBounds]);

  const handleSearchLocation = useCallback((lat: number, lng: number, zoom: number) => {
    userInteractedRef.current = true;
    setMapCenter({ lat, lng });
    setMapZoom(zoom);
    setSearchMarker({ lat, lng });
  }, []);

  const handleLocateMe = useCallback(() => {
    userInteractedRef.current = true;
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setMapCenter({ lat, lng });
        setMapZoom(PRECISE_LOCATION_ZOOM);
        setSearchMarker({ lat, lng });
        setUserLocation({ lat, lng });
      },
      () => {
        /* denied or error — silent; user can search address */
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  }, []);

  // Clear auto-load timeout on unmount
  useEffect(() => {
    return () => {
      if (autoLoadTimeoutRef.current) {
        clearTimeout(autoLoadTimeoutRef.current);
        autoLoadTimeoutRef.current = null;
      }
    };
  }, []);

  // Initial map center: browser geolocation if available, otherwise stay on São Carlos.
  // No IP-based fallback: ISP geolocation in Brazil usually resolves to São Paulo capital.
  useEffect(() => {
    if (initialLocationResolvedRef.current) return;
    initialLocationResolvedRef.current = true;
    if (!("geolocation" in navigator)) return;
    let isCancelled = false;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (isCancelled) return;
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setUserLocation({ lat, lng });
        // Never yank the map away from where the user already went.
        if (userInteractedRef.current) return;
        setMapCenter({ lat, lng });
        setMapZoom(PRECISE_LOCATION_ZOOM);
      },
      () => {
        /* denied, unavailable or timed out — keep the São Carlos default */
      },
      {
        enableHighAccuracy: false,
        timeout: INITIAL_GEOLOCATION_TIMEOUT_MS,
        maximumAge: 300000,
      }
    );

    return () => {
      isCancelled = true;
    };
  }, []);

  /**
   * Saves through the API. Only when the backend isn't configured at all (503, e.g. local
   * demo without Supabase) do we keep the change in memory; any other failure is thrown as a
   * user-facing message so the modal can show it instead of pretending the save worked.
   */
  const handleAddVenue = useCallback(async (
    venue: Omit<Venue, "id" | "createdAt">,
    accessToken: string | null
  ) => {
    let saved: Venue;
    try {
      saved = apiVenueToVenue(
        await createVenue({
          name: venue.name,
          address: venue.address,
          neighborhood: venue.neighborhood,
          city: venue.city,
          state: venue.state,
          lat: venue.lat,
          lng: venue.lng,
          beerPrices: venue.beerPrices,
          hasHappyHour: venue.hasHappyHour,
          happyHourDetails: venue.happyHourDetails,
        }, accessToken)
      );
    } catch (e) {
      if ((e as ApiError).status !== 503) throw new Error(saveErrorMessage(e));
      saved = {
        ...venue,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        userAdded: true,
      };
    }
    setVenues((prev) => [...prev, saved]);
  }, []);

  const handleUpdateVenuePrices = useCallback(async (updatedVenue: Venue) => {
    let saved: Venue;
    try {
      saved = apiVenueToVenue(
        await updateVenuePrices(updatedVenue.id, {
          beerPrices: updatedVenue.beerPrices,
          hasHappyHour: updatedVenue.hasHappyHour,
          happyHourDetails: updatedVenue.happyHourDetails,
        }, await getAccessToken())
      );
    } catch (e) {
      if ((e as ApiError).status !== 503) throw new Error(saveErrorMessage(e));
      saved = updatedVenue;
    }
    setVenues((prev) => prev.map((v) => (v.id === updatedVenue.id ? saved : v)));
  }, []);

  return {
    venues,
    mapCenter,
    mapZoom,
    mapBounds,
    searchMarker,
    userLocation,
    osmLoadState,
    osmError,
    venuesTruncated,
    mapHandleRef,
    tryLoadPlacesForBounds,
    handleMapBoundsChange,
    handleMapReady,
    handleLoadPlacesBars,
    handleSearchLocation,
    handleLocateMe,
    handleAddVenue,
    handleUpdateVenuePrices,
  };
}
