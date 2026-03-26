"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { MOCK_VENUES, SAO_CARLOS_CENTER, DEFAULT_ZOOM } from "@/data/venues";
import { fetchVenuesInBounds, createVenue, updateVenuePrices } from "@/lib/api";
import { expandBounds } from "@/lib/google-places";
import type { Venue, SortOption, PriceFilter, BeerType } from "@/types";
import { FilterBar } from "@/components/FilterBar";
import { VenueList } from "@/components/VenueList";
import { AddVenueModal } from "@/components/AddVenueModal";
import { AddPricesModal } from "@/components/AddPricesModal";
import { AddressSearch } from "@/components/AddressSearch";
import { FilterChips } from "@/components/FilterChips";
import { VenueSheet } from "@/components/VenueSheet";
import type { MapHandle } from "@/components/Map";
import { MapLoadingPlaceholder } from "@/components/MapLoadingPlaceholder";

const Map = dynamic(() => import("@/components/Map").then((m) => m.Map), {
  ssr: false,
  loading: () => <MapLoadingPlaceholder />,
});

const BEER_TYPE_LABELS: Record<BeerType, string> = {
  chope: "Chope",
  long_neck: "Long neck",
  lata: "Lata",
  garrafa: "Garrafa",
  outro: "Outro",
};

/** Zoom threshold: allow places search when zoom >= this. */
const PLACES_ZOOM_THRESHOLD = 12;
/** Minimum ms between two venue requests (0 = disabled). */
const PLACES_REQUEST_COOLDOWN_MS = 0;
/** Debounce before auto-loading venues after user stops panning/zooming. */
const AUTO_LOAD_DEBOUNCE_MS = 150;
/** Expand visible bounds by this factor when calling the API (overscanning for smoother pans). */
const OVERSCAN_FACTOR = 1.25;
/** Expand bounds slightly for filtering the list so it matches what user sees on screen. */
const LIST_BOUNDS_OVERSCAN_FACTOR = 1.05;
const PLACES_CACHE_MAX_ENTRIES = 30;
const PRECISE_LOCATION_ZOOM = 14;
const APPROX_LOCATION_ZOOM = 12;
/** Max external (Google) venues to keep in state; evict oldest by id when exceeded to avoid unbounded growth. */
const MAX_EXTERNAL_VENUES = 300;
/** Rounded bbox key for cache (~1.1 km grid) so nearby pans reuse data anywhere in the world. */
function bboxCacheKey(bounds: { south: number; west: number; north: number; east: number }): string {
  const { south, west, north, east } = bounds;
  return `${south.toFixed(2)},${west.toFixed(2)},${north.toFixed(2)},${east.toFixed(2)}`;
}

/** Approximate visible bounds from center + zoom (used when map instance is not ready yet). */
function boundsFromCenterAndZoom(
  center: { lat: number; lng: number },
  zoom: number
): { south: number; west: number; north: number; east: number } {
  const deg = 360 / Math.pow(2, zoom);
  const halfLat = (deg * 0.6) / 2;
  const halfLng = deg / 2;
  return {
    south: center.lat - halfLat,
    north: center.lat + halfLat,
    west: center.lng - halfLng,
    east: center.lng + halfLng,
  };
}

function getMinBeerPrice(venue: Venue): number {
  if (venue.beerPrices.length === 0) return Infinity;
  return Math.min(...venue.beerPrices.map((p) => p.priceBRL));
}

type ViewMode = "map" | "list";

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>(MOCK_VENUES);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(SAO_CARLOS_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [mapBounds, setMapBounds] = useState<{
    south: number;
    west: number;
    north: number;
    east: number;
  }>(() => boundsFromCenterAndZoom(SAO_CARLOS_CENTER, DEFAULT_ZOOM));
  const [searchMarker, setSearchMarker] = useState<{ lat: number; lng: number } | null>(null);
  const [maxPrice, setMaxPrice] = useState<PriceFilter>(null);
  const [beerType, setBeerType] = useState<BeerType | "">("");
  const [neighborhood, setNeighborhood] = useState("");
  const [happyHourOnly, setHappyHourOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [venueToEditPrices, setVenueToEditPrices] = useState<Venue | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [osmLoadState, setOsmLoadState] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [osmError, setOsmError] = useState<string | null>(null);
  const osmRequestIdRef = useRef(0);
  const osmCacheRef = useRef(new globalThis.Map<string, Venue[]>());
  const lastOverpassRequestTimeRef = useRef(0);
  const autoLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsForAutoLoadRef = useRef<{
    bounds: { south: number; west: number; north: number; east: number };
    zoom: number;
  } | null>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const initialLocationResolvedRef = useRef(false);

  const isFromExternal = (v: Venue) => v.fromOsm || v.fromGoogle;

  /**
   * Load places for the given bounds (cache or API).
   * Used by both manual "Buscar bares" and auto-load on pan/zoom.
   * When isManual is false, cooldown/zoom errors are not shown to the user.
   */
  const tryLoadPlacesForBounds = useCallback(
    (
      bounds: { south: number; west: number; north: number; east: number },
      zoom: number,
      isManual: boolean
    ) => {
      if (zoom < PLACES_ZOOM_THRESHOLD) {
        if (isManual) setOsmError("Dê mais zoom no mapa para buscar bares desta área.");
        return;
      }

      const bboxKey = bboxCacheKey(bounds);
      const cache = osmCacheRef.current;

      const mergeExternalIntoState = (newVenues: Venue[]) => {
        const byId = new globalThis.Map<string, Venue>(newVenues.map((v) => [v.id, v]));
        setVenues((prev) => {
          const rest = prev.filter((v) => !isFromExternal(v));
          const external = prev.filter(isFromExternal);
          for (const v of external) {
            const existing = byId.get(v.id);
            if (existing) {
              if (v.beerPrices.length > 0) byId.set(v.id, v);
            } else {
              byId.set(v.id, v);
            }
          }
          let merged = Array.from(byId.values());
          if (merged.length > MAX_EXTERNAL_VENUES) {
            merged = merged.slice(-MAX_EXTERNAL_VENUES);
          }
          return [...rest, ...merged];
        });
      };

      if (cache.has(bboxKey)) {
        const cached = cache.get(bboxKey)!;
        mergeExternalIntoState(cached);
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
        .then((apiVenues) => {
          if (requestId !== osmRequestIdRef.current) return;
          const asVenues: Venue[] = apiVenues.map((v) => ({
            ...v,
            id: v.id,
            beerPrices: (v.beerPrices ?? []).map((p) => ({
              type: p.type as BeerType,
              label: p.label,
              priceBRL: p.priceBRL,
              volumeMl: p.volumeMl,
            })),
            hasHappyHour: v.hasHappyHour ?? false,
            createdAt: v.createdAt,
            userAdded: v.userAdded,
            fromOsm: v.fromOsm,
            fromGoogle: v.fromGoogle,
          }));
          mergeExternalIntoState(asVenues);
          setOsmLoadState("success");

          if (cache.size >= PLACES_CACHE_MAX_ENTRIES) {
            const firstKey = cache.keys().next().value;
            if (firstKey != null) cache.delete(firstKey);
          }
          cache.set(bboxKey, asVenues);
        })
        .catch((e) => {
          if (requestId !== osmRequestIdRef.current) return;
          setOsmLoadState("error");
          const err = e as Error & { status?: number };
          const msg = err instanceof Error ? err.message : "Erro ao buscar bares";
          setOsmError(
            err.status === 503 || msg.includes("Database not configured")
              ? "Backend não configurado. Configure Supabase para carregar bares do mapa."
              : msg
          );
        });
    },
    []
  );

  // Sync map view to state when user pans/zooms; clear venues when zoom < threshold; trigger auto-load when zoom >= threshold
  const handleMapBoundsChange = useCallback(
    (
      bounds: { south: number; west: number; north: number; east: number },
      zoom: number,
      reason: "idle" | "changing"
    ) => {
      // Evita feedback/jank: enquanto o usuário arrasta, não sincronizamos center/zoom/state
      // com props (isso causa loop com `map.panTo`/`map.setZoom` no componente Map).
      if (reason === "idle") {
        setMapCenter({
          lat: (bounds.south + bounds.north) / 2,
          lng: (bounds.west + bounds.east) / 2,
        });
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

  const handleLoadPlacesBars = useCallback(() => {
    const current = mapRef.current?.getCurrentBounds();
    const zoom = current?.zoom ?? mapZoom;
    const bounds =
      current?.bounds ?? boundsFromCenterAndZoom(mapCenter, mapZoom);
    tryLoadPlacesForBounds(bounds, zoom, true);
  }, [mapZoom, mapCenter, tryLoadPlacesForBounds]);

  const handleSearchLocation = useCallback((lat: number, lng: number, zoom: number) => {
    setMapCenter({ lat, lng });
    setMapZoom(zoom);
    setSearchMarker({ lat, lng });
  }, []);

  const handleLocateMe = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setMapCenter({ lat, lng });
        setMapZoom(PRECISE_LOCATION_ZOOM);
        setSearchMarker({ lat, lng });
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

  // Initial map center: browser geolocation (with prompt) -> IP approximation -> São Carlos fallback.
  useEffect(() => {
    if (initialLocationResolvedRef.current) return;
    initialLocationResolvedRef.current = true;
    let isCancelled = false;

    const applyLocation = (lat: number, lng: number, zoom: number) => {
      if (isCancelled) return;
      setMapCenter({ lat, lng });
      setMapZoom(zoom);
      setSearchMarker({ lat, lng });
    };

    const fallbackToIpLocation = async () => {
      try {
        const res = await fetch("https://ipapi.co/json/");
        if (!res.ok) return;
        const data = (await res.json()) as { latitude?: number; longitude?: number };
        if (typeof data.latitude === "number" && typeof data.longitude === "number") {
          applyLocation(data.latitude, data.longitude, APPROX_LOCATION_ZOOM);
        }
      } catch {
        // Keep São Carlos fallback if IP lookup fails.
      }
    };

    if (!("geolocation" in navigator)) {
      void fallbackToIpLocation();
      return () => {
        isCancelled = true;
      };
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyLocation(
          position.coords.latitude,
          position.coords.longitude,
          PRECISE_LOCATION_ZOOM
        );
      },
      () => {
        void fallbackToIpLocation();
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300000,
      }
    );

    return () => {
      isCancelled = true;
    };
  }, []);

  const venuesInBounds = useMemo(() => {
    const b = expandBounds(mapBounds, LIST_BOUNDS_OVERSCAN_FACTOR);
    return venues.filter(
      (v) => v.lat >= b.south && v.lat <= b.north && v.lng >= b.west && v.lng <= b.east
    );
  }, [venues, mapBounds]);

  const neighborhoods = useMemo(() => {
    const set = new Set(venuesInBounds.map((v) => v.neighborhood));
    return Array.from(set).sort();
  }, [venuesInBounds]);

  const hasActiveFilters =
    maxPrice != null ||
    beerType !== "" ||
    neighborhood !== "" ||
    sort !== "price_asc";

  const filteredAndSortedVenues = useMemo(() => {
    let list = [...venuesInBounds];

    if (maxPrice != null) {
      list = list.filter((v) => getMinBeerPrice(v) <= maxPrice);
    }
    if (beerType) {
      list = list.filter((v) => v.beerPrices.some((p) => p.type === beerType));
    }
    if (neighborhood) {
      list = list.filter(
        (v) => v.neighborhood.toLowerCase() === neighborhood.toLowerCase()
      );
    }
    if (happyHourOnly) {
      list = list.filter((v) => v.hasHappyHour);
    }

    if (sort === "price_asc") {
      list.sort((a, b) => getMinBeerPrice(a) - getMinBeerPrice(b));
    } else if (sort === "price_desc") {
      list.sort((a, b) => getMinBeerPrice(b) - getMinBeerPrice(a));
    } else if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [venuesInBounds, maxPrice, beerType, neighborhood, happyHourOnly, sort]);

  const selectedVenue = useMemo(
    () => (selectedVenueId ? venues.find((v) => v.id === selectedVenueId) ?? null : null),
    [venues, selectedVenueId]
  );

  const handleAddVenue = useCallback(async (venue: Omit<Venue, "id" | "createdAt">) => {
    const fallback = () => {
      const newVenue: Venue = {
        ...venue,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        userAdded: true,
      };
      setVenues((prev) => [...prev, newVenue]);
      setAddModalOpen(false);
    };
    try {
      const created = await createVenue({
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
      });
      const asVenue: Venue = {
        ...created,
        id: created.id,
        beerPrices: (created.beerPrices ?? []).map((p) => ({
          type: p.type as BeerType,
          label: p.label,
          priceBRL: p.priceBRL,
          volumeMl: p.volumeMl,
        })),
        hasHappyHour: created.hasHappyHour ?? false,
        createdAt: created.createdAt,
        userAdded: created.userAdded,
        fromOsm: created.fromOsm,
        fromGoogle: created.fromGoogle,
      };
      setVenues((prev) => [...prev, asVenue]);
      setAddModalOpen(false);
    } catch {
      fallback();
    }
  }, []);

  const handleUpdateVenuePrices = useCallback(async (updatedVenue: Venue) => {
    const fallback = () => {
      setVenues((prev) =>
        prev.map((v) => (v.id === updatedVenue.id ? updatedVenue : v))
      );
      setVenueToEditPrices(null);
      setSelectedVenueId((id) => (id === updatedVenue.id ? id : null));
    };
    try {
      const saved = await updateVenuePrices(updatedVenue.id, {
        beerPrices: updatedVenue.beerPrices,
        hasHappyHour: updatedVenue.hasHappyHour,
        happyHourDetails: updatedVenue.happyHourDetails,
      });
      const asVenue: Venue = {
        ...saved,
        id: saved.id,
        beerPrices: (saved.beerPrices ?? []).map((p) => ({
          type: p.type as BeerType,
          label: p.label,
          priceBRL: p.priceBRL,
          volumeMl: p.volumeMl,
        })),
        hasHappyHour: saved.hasHappyHour ?? false,
        createdAt: saved.createdAt,
        userAdded: saved.userAdded,
        fromOsm: saved.fromOsm,
        fromGoogle: saved.fromGoogle,
      };
      setVenues((prev) =>
        prev.map((v) => (v.id === updatedVenue.id ? asVenue : v))
      );
      setVenueToEditPrices(null);
      setSelectedVenueId((id) => (id === updatedVenue.id ? id : null));
    } catch {
      fallback();
    }
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Header: logo + search (MisterGoodBeer style) */}
      <header className="relative z-[1000] flex-none border-b border-stone-800 bg-stone-900/95 backdrop-blur">
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h1 className="text-lg font-bold text-amber-400 tracking-tight">
              BrejaMap
            </h1>
            <p className="text-stone-500 text-xs hidden sm:block">
              Estado de São Paulo
            </p>
          </div>
          <div className="w-full">
            <AddressSearch
              onSelectLocation={handleSearchLocation}
              placeholder="Pesquisar endereço"
            />
          </div>
        </div>
        <div className="px-4 pb-3">
          <FilterChips
            happyHourOnly={happyHourOnly}
            onHappyHourOnlyChange={setHappyHourOnly}
            filtersOpen={filtersOpen}
            onFiltersOpenChange={setFiltersOpen}
            hasActiveFilters={hasActiveFilters}
            onLoadOsmBars={handleLoadPlacesBars}
            osmLoadState={osmLoadState}
            osmError={osmError}
          />
        </div>
      </header>

      {/* View toggle: Mapa | Lista */}
      <div className="flex-none flex border-b border-stone-800 bg-stone-950/80 px-4 py-2 gap-1">
        <button
          type="button"
          onClick={() => setViewMode("map")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
            viewMode === "map"
              ? "bg-amber-500 text-stone-950"
              : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
          }`}
        >
          Mapa
        </button>
        <button
          type="button"
          onClick={() => setViewMode("list")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
            viewMode === "list"
              ? "bg-amber-500 text-stone-950"
              : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
          }`}
        >
          Lista
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar: filters + list. No mapa = lista ocupa; no mapa = sidebar ao lado em desktop ou ao abrir Filtros */}
        <aside
          className={`flex flex-col bg-stone-950 border-r border-stone-800 transition-all min-h-0 ${
            viewMode === "list"
              ? "flex-1 w-full min-h-0 overflow-y-auto overscroll-y-contain sm:flex-none sm:max-w-[420px]"
              : filtersOpen
                ? "flex-none w-full overflow-y-auto overscroll-y-contain sm:w-96"
                : "flex-none w-0 overflow-hidden sm:w-96 sm:overflow-y-auto sm:overscroll-y-contain sm:min-h-0"
          }`}
        >
          <FilterBar
            maxPrice={maxPrice}
            onMaxPriceChange={setMaxPrice}
            beerType={beerType}
            onBeerTypeChange={setBeerType}
            neighborhood={neighborhood}
            onNeighborhoodChange={setNeighborhood}
            neighborhoods={neighborhoods}
            happyHourOnly={happyHourOnly}
            onHappyHourOnlyChange={setHappyHourOnly}
            sort={sort}
            onSortChange={setSort}
            sortOptions={[
              { value: "price_asc", label: "Menor preço" },
              { value: "price_desc", label: "Maior preço" },
              { value: "name", label: "Nome" },
            ]}
          />
          <VenueList
            venues={filteredAndSortedVenues}
            totalVenuesCount={venuesInBounds.length}
            selectedVenueId={selectedVenueId}
            onSelectVenue={setSelectedVenueId}
            beerTypeLabels={BEER_TYPE_LABELS}
            getMinPrice={getMinBeerPrice}
            onAddBar={() => setAddModalOpen(true)}
          />
        </aside>

        {/* Map - mount only when map view is active so the map gets a visible container and can load fully */}
        <main
          className={`flex-1 min-w-0 p-2 flex flex-col min-h-0 ${
            viewMode === "list" ? "hidden sm:flex" : ""
          }`}
        >
          <div className="relative w-full flex-1 min-h-[min(52vh,520px)] sm:min-h-[240px] rounded-xl overflow-hidden border border-stone-800 touch-pan-x touch-pan-y">
            {viewMode === "map" ? (
              <>
                <Map
                  ref={mapRef}
                  venues={filteredAndSortedVenues}
                  center={mapCenter}
                  zoom={mapZoom}
                  searchMarker={searchMarker}
                  selectedVenueId={selectedVenueId}
                  onSelectVenue={setSelectedVenueId}
                  getMinPrice={getMinBeerPrice}
                  onBoundsChange={handleMapBoundsChange}
                />
                <button
                  type="button"
                  onClick={handleLocateMe}
                  className="absolute left-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:bottom-8 z-[1] flex h-11 w-11 items-center justify-center rounded-full border border-stone-600 bg-stone-900/95 text-lg shadow-lg text-stone-100 backdrop-blur hover:bg-stone-800 active:scale-95 transition"
                  aria-label="Onde estou"
                  title="Centralizar no meu local (pede permissão de localização)"
                >
                  <span aria-hidden>📍</span>
                </button>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-stone-900 rounded-xl">
                <span className="text-stone-500 text-sm">
                  Clique em Mapa para ver o mapa
                </span>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Bottom sheet when a venue is selected */}
      {selectedVenue && (
        <VenueSheet
          venue={selectedVenue}
          onClose={() => setSelectedVenueId(null)}
          beerTypeLabels={BEER_TYPE_LABELS}
          getMinPrice={getMinBeerPrice}
          onAddPrices={(v) => setVenueToEditPrices(v)}
        />
      )}

      <AddPricesModal
        isOpen={venueToEditPrices != null}
        venue={venueToEditPrices}
        onClose={() => setVenueToEditPrices(null)}
        onSubmit={handleUpdateVenuePrices}
      />

      {/* Bottom navigation (MisterGoodBeer style) */}
      <nav
        className="flex-none flex items-center justify-around border-t border-stone-800 bg-stone-900/95 py-2 safe-area-pb z-[800]"
        aria-label="Navegação principal"
      >
        <span className="flex flex-col items-center gap-0.5 text-amber-500 font-medium text-xs">
          <span aria-hidden>🗺️</span>
          Mapa
        </span>
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="flex flex-col items-center gap-0.5 text-stone-400 hover:text-amber-500 text-xs font-medium transition"
        >
          <span aria-hidden>➕</span>
          Adicionar bar
        </button>
        <span className="flex flex-col items-center gap-0.5 text-stone-500 text-xs">
          <span aria-hidden>👤</span>
          Minha conta
        </span>
      </nav>

      <AddVenueModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleAddVenue}
        initialLat={mapCenter.lat}
        initialLng={mapCenter.lng}
      />
    </div>
  );
}
