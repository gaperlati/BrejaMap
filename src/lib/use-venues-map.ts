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
import type { Bounds } from "@/lib/geo";
import { attachMapHandle, type MapHandle } from "@/lib/mapHandle";
import { getAccessToken } from "@/lib/supabase-browser";
import { createVenueAreaLoader, projectViewportBounds } from "@/lib/venue-area-loader";
import {
  apiVenueToVenue,
  boundsFromCenterAndZoom,
  isFromExternal,
  mergeExternalVenues,
  VenueBboxCache,
} from "@/lib/venue-state";
import type { Venue, VenueAttributesPatch } from "@/types";
import { applyVenueAttributesPatch } from "@/lib/venue-attributes";

/** Zoom threshold: allow places search when zoom >= this. */
const PLACES_ZOOM_THRESHOLD = 12;
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
  /** Live map handle from `Map`'s `onReady` (null while the map isn't mounted). */
  const mapHandleRef = useRef<MapHandle | null>(null);
  /** Last viewport reported by the real map; sizes the projected area while it is unmounted. */
  const lastMapViewportRef = useRef<{ bounds: Bounds; zoom: number } | null>(null);
  const initialLocationResolvedRef = useRef(false);
  /** Set once the user pans/zooms, searches or locates; startup geolocation then won't recenter. */
  const userInteractedRef = useRef(false);

  /** Responses per area; edits patch it (`replaceVenue`) so cached views never go stale. */
  const [areaCache] = useState(() => new VenueBboxCache(PLACES_CACHE_MAX_ENTRIES));
  /** Cache + debounce + latest-wins loading of the venues of the current area. */
  const [loader] = useState(() =>
    createVenueAreaLoader({
      fetchArea: (requestBounds) =>
        fetchVenuesInBounds(requestBounds).then(({ venues: apiVenues, truncated }) => ({
          venues: apiVenues.map(apiVenueToVenue),
          truncated,
        })),
      cache: areaCache,
      minZoom: PLACES_ZOOM_THRESHOLD,
      debounceMs: AUTO_LOAD_DEBOUNCE_MS,
      overscanFactor: OVERSCAN_FACTOR,
      onEvent: (event) => {
        switch (event.kind) {
          case "loading":
            setOsmLoadState("loading");
            setOsmError(null);
            break;
          case "loaded":
            setVenues((prev) => mergeExternalVenues(prev, event.entry.venues));
            setVenuesTruncated(event.entry.truncated);
            setOsmLoadState("success");
            setOsmError(null);
            break;
          case "error":
            setVenuesTruncated(false);
            setOsmLoadState("error");
            setOsmError(loadVenuesErrorMessage(event.error));
            break;
          case "cleared":
            setVenues((prev) => prev.filter((v) => !isFromExternal(v)));
            setOsmError(null);
            setVenuesTruncated(false);
            setOsmLoadState("idle");
            break;
          case "zoom-too-low":
            setOsmError("Dê mais zoom no mapa para buscar bares desta área.");
            break;
        }
      },
    })
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
        lastMapViewportRef.current = { bounds, zoom };
        setMapCenter(center);
        setMapZoom(zoom);
        setMapBounds(bounds);
      }

      // Below the threshold only the settled (idle) view clears the loaded venues.
      if (zoom < PLACES_ZOOM_THRESHOLD && reason !== "idle") return;
      // Mesmo durante o movimento, apenas atualizamos o "alvo" do próximo carregamento.
      loader.request(bounds, zoom, "debounced");
    },
    [loader]
  );

  const handleMapReady = useCallback(
    (handle: MapHandle) => attachMapHandle(mapHandleRef, handle),
    []
  );

  const handleLoadPlacesBars = useCallback(() => {
    const current = mapHandleRef.current?.getCurrentBounds();
    loader.request(current?.bounds ?? mapBounds, current?.zoom ?? mapZoom, "manual");
  }, [mapZoom, mapBounds, loader]);

  /**
   * Moves the view to an explicitly chosen location. A mounted map pans/zooms and reports
   * its real bounds itself; without one (list view) nothing would, so the area the list
   * shows is projected here and its venues are loaded right away.
   */
  const goToLocation = useCallback(
    (center: { lat: number; lng: number }, zoom: number) => {
      setMapCenter(center);
      setMapZoom(zoom);
      if (mapHandleRef.current) return;
      const bounds = projectViewportBounds(center, zoom, lastMapViewportRef.current);
      setMapBounds(bounds);
      loader.request(bounds, zoom, "now");
    },
    [loader]
  );

  const handleSearchLocation = useCallback(
    (lat: number, lng: number, zoom: number) => {
      userInteractedRef.current = true;
      goToLocation({ lat, lng }, zoom);
      setSearchMarker({ lat, lng });
    },
    [goToLocation]
  );

  const handleLocateMe = useCallback(() => {
    userInteractedRef.current = true;
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        goToLocation({ lat, lng }, PRECISE_LOCATION_ZOOM);
        setSearchMarker({ lat, lng });
        setUserLocation({ lat, lng });
      },
      () => {
        /* denied or error — silent; user can search address */
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  }, [goToLocation]);

  // Drop the pending auto-load and any in-flight result on unmount
  useEffect(() => () => loader.cancel(), [loader]);

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
        goToLocation({ lat, lng }, PRECISE_LOCATION_ZOOM);
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
  }, [goToLocation]);

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
          transmitsFootball: venue.transmitsFootball,
          acceptsReservations: venue.acceptsReservations,
          hasOutdoorArea: venue.hasOutdoorArea,
          openingHours: venue.openingHours,
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

  /**
   * Puts a venue saved by the API (edit, "Ainda é esse preço? Sim", rating) into state and into
   * every cached area, so a later pan back to a cached view shows the saved version.
   */
  const handleVenueSaved = useCallback((saved: Venue) => {
    areaCache.replaceVenue(saved);
    setVenues((prev) => prev.map((v) => (v.id === saved.id ? saved : v)));
  }, [areaCache]);

  /** `attributes` holds only what the user changed (absent = unchanged, null = clear). */
  const handleUpdateVenuePrices = useCallback(
    async ({ venue: updatedVenue, attributes }: { venue: Venue; attributes: VenueAttributesPatch }) => {
      let saved: Venue;
      try {
        saved = apiVenueToVenue(
          await updateVenuePrices(
            updatedVenue.id,
            {
              beerPrices: updatedVenue.beerPrices.map(({ type, label, priceBRL, volumeMl }) => ({
                type,
                label,
                priceBRL,
                volumeMl,
              })),
              hasHappyHour: updatedVenue.hasHappyHour,
              happyHourDetails: updatedVenue.happyHourDetails,
              ...attributes,
            },
            await getAccessToken()
          )
        );
      } catch (e) {
        if ((e as ApiError).status !== 503) throw new Error(saveErrorMessage(e));
        saved = applyVenueAttributesPatch(updatedVenue, attributes);
      }
      handleVenueSaved(saved);
    },
    [handleVenueSaved]
  );

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
    handleMapBoundsChange,
    handleMapReady,
    handleLoadPlacesBars,
    handleSearchLocation,
    handleLocateMe,
    handleAddVenue,
    handleUpdateVenuePrices,
    handleVenueSaved,
  };
}
