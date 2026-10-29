"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { reportVenuePrices } from "@/lib/api";
import type { Venue } from "@/types";
import { FilterBar } from "@/components/FilterBar";
import { VenueList } from "@/components/VenueList";
import { AddVenueModal } from "@/components/AddVenueModal";
import { AddPricesModal } from "@/components/AddPricesModal";
import { AddressSearch } from "@/components/AddressSearch";
import { FilterChips } from "@/components/FilterChips";
import { VenueSheet } from "@/components/VenueSheet";
import { MapLoadingPlaceholder } from "@/components/MapLoadingPlaceholder";
import { REOPEN_ADD_VENUE_KEY } from "@/components/LoginCard";
import { BEER_TYPE_LABELS } from "@/lib/venue-state";
import { useVenuesMap } from "@/lib/use-venues-map";
import { useVenueFilters } from "@/lib/use-venue-filters";

const Map = dynamic(() => import("@/components/Map").then((m) => m.Map), {
  ssr: false,
  loading: () => <MapLoadingPlaceholder />,
});

type ViewMode = "map" | "list";

export default function Home() {
  const {
    venues,
    mapCenter,
    mapZoom,
    mapBounds,
    searchMarker,
    userLocation,
    osmLoadState,
    osmError,
    venuesTruncated,
    handleMapBoundsChange,
    handleMapReady,
    handleLoadPlacesBars,
    handleSearchLocation,
    handleLocateMe,
    handleAddVenue: saveVenue,
    handleUpdateVenuePrices: saveVenuePrices,
  } = useVenuesMap();
  const {
    maxPrice,
    setMaxPrice,
    beerType,
    setBeerType,
    neighborhood,
    setNeighborhood,
    happyHourOnly,
    setHappyHourOnly,
    sort,
    setSort,
    filtersOpen,
    setFiltersOpen,
    venuesInBounds,
    neighborhoods,
    hasActiveFilters,
    filteredAndSortedVenues,
    getMatchingPrices,
    getMinPrice: getMatchingMinPrice,
  } = useVenueFilters({ venues, mapBounds, mapCenter, userLocation });
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [venueToEditPrices, setVenueToEditPrices] = useState<Venue | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("map");

  // Back from the Google login redirect started in "Adicionar bar": reopen the modal.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(REOPEN_ADD_VENUE_KEY)) {
        sessionStorage.removeItem(REOPEN_ADD_VENUE_KEY);
        setAddModalOpen(true);
      }
    } catch {
      // sessionStorage unavailable: nothing to reopen.
    }
  }, []);

  const selectedVenue = useMemo(
    () => (selectedVenueId ? venues.find((v) => v.id === selectedVenueId) ?? null : null),
    [venues, selectedVenueId]
  );

  /** Save errors propagate so the modal stays open and shows them. */
  const handleAddVenue = useCallback(
    async (venue: Omit<Venue, "id" | "createdAt">, accessToken: string | null) => {
      await saveVenue(venue, accessToken);
      setAddModalOpen(false);
    },
    [saveVenue]
  );

  const handleUpdateVenuePrices = useCallback(
    async (updatedVenue: Venue) => {
      await saveVenuePrices(updatedVenue);
      setVenueToEditPrices(null);
    },
    [saveVenuePrices]
  );

  return (
    <div className="flex flex-col h-dvh min-h-0">
      {/* Header: logo + search (MisterGoodBeer style) */}
      <header className="relative z-[1000] flex-none border-b border-stone-800 bg-stone-900/95 backdrop-blur">
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <h1 className="text-lg font-bold text-amber-400 tracking-tight">
              BrejaMap
            </h1>
          </div>
          <div className="w-full">
            <AddressSearch
              onSelectLocation={handleSearchLocation}
              placeholder="Pesquisar endereço"
              biasLocation={userLocation ?? mapCenter}
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
            venuesTruncated={venuesTruncated}
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
              { value: "distance", label: "Mais perto" },
              { value: "name", label: "Nome" },
            ]}
          />
          <VenueList
            venues={filteredAndSortedVenues}
            totalVenuesCount={venuesInBounds.length}
            selectedVenueId={selectedVenueId}
            onSelectVenue={setSelectedVenueId}
            beerTypeLabels={BEER_TYPE_LABELS}
            getPrices={getMatchingPrices}
            getMinPrice={getMatchingMinPrice}
            onAddBar={() => setAddModalOpen(true)}
          />
        </aside>

        {/* Map - mount only when map view is active so the map gets a visible container and can load fully */}
        <main
          className={`flex-1 min-w-0 p-2 flex flex-col min-h-0 ${
            viewMode === "list" ? "hidden sm:flex" : ""
          }`}
        >
          <div className="relative w-full flex-1 min-h-[min(52vh,520px)] sm:min-h-[240px] rounded-xl overflow-hidden border border-stone-800 touch-none">
            {viewMode === "map" ? (
              <>
                <Map
                  venues={filteredAndSortedVenues}
                  center={mapCenter}
                  zoom={mapZoom}
                  searchMarker={searchMarker}
                  selectedVenueId={selectedVenueId}
                  onSelectVenue={setSelectedVenueId}
                  getMinPrice={getMatchingMinPrice}
                  onBoundsChange={handleMapBoundsChange}
                  onReady={handleMapReady}
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
          getMinPrice={getMatchingMinPrice}
          priceTypeLabel={beerType ? BEER_TYPE_LABELS[beerType] : undefined}
          onAddPrices={(v) => setVenueToEditPrices(v)}
          onReportPrices={(v) => reportVenuePrices(v.id)}
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
        className="flex-none flex items-center justify-center gap-16 sm:gap-24 border-t border-stone-800 bg-stone-900/95 pt-2 safe-area-pb z-[800]"
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
      </nav>

      <AddVenueModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleAddVenue}
        initialLat={mapCenter.lat}
        initialLng={mapCenter.lng}
        initialZoom={mapZoom}
      />
    </div>
  );
}
