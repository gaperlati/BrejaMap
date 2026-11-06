"use client";

import { useCallback, useMemo, useState } from "react";
import type { Bounds } from "@/lib/geo";
import {
  countActiveFilters,
  extractNeighborhoods,
  filterAndSortVenues,
  filterVenuesInBounds,
  getMatchingMinPrice,
  matchingBeerPrices,
} from "@/lib/venue-state";
import type { BeerType, PriceFilter, SortOption, Venue } from "@/types";

/** Filter/sort state of the venue list and the venues it selects from the visible map area. */
export function useVenueFilters({
  venues,
  mapBounds,
  mapCenter,
  userLocation,
}: {
  venues: Venue[];
  mapBounds: Bounds;
  mapCenter: { lat: number; lng: number };
  userLocation: { lat: number; lng: number } | null;
}) {
  const [maxPrice, setMaxPrice] = useState<PriceFilter>(null);
  const [beerType, setBeerType] = useState<BeerType | "">("");
  const [neighborhood, setNeighborhood] = useState("");
  const [happyHourOnly, setHappyHourOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const venuesInBounds = useMemo(
    () => filterVenuesInBounds(venues, mapBounds),
    [venues, mapBounds]
  );

  const neighborhoods = useMemo(() => extractNeighborhoods(venuesInBounds), [venuesInBounds]);

  const activeFilterCount = countActiveFilters({
    maxPrice,
    beerType,
    neighborhood,
    happyHourOnly,
    sort,
  });
  const hasActiveFilters = activeFilterCount > 0;

  /** "Limpar filtros": back to the defaults (the panel stays as it is). */
  const clearFilters = useCallback(() => {
    setMaxPrice(null);
    setBeerType("");
    setNeighborhood("");
    setHappyHourOnly(false);
    setSort("price_asc");
  }, []);

  const filteredAndSortedVenues = useMemo(
    () =>
      filterAndSortVenues(venues, {
        mapBounds,
        maxPrice,
        beerType,
        neighborhood,
        happyHourOnly,
        sort,
        userLocation,
        mapCenter,
      }),
    [venues, mapBounds, maxPrice, beerType, neighborhood, happyHourOnly, sort, userLocation, mapCenter]
  );

  // Price shown for a venue in the list and on the map: only beers matching type and budget.
  const getMatchingPrices = useCallback(
    (venue: Venue) => matchingBeerPrices(venue, { beerType, maxPrice }),
    [beerType, maxPrice]
  );
  const getMinPrice = useCallback(
    (venue: Venue) => getMatchingMinPrice(venue, { beerType, maxPrice }),
    [beerType, maxPrice]
  );

  return {
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
    activeFilterCount,
    clearFilters,
    filteredAndSortedVenues,
    getMatchingPrices,
    getMinPrice,
  };
}
