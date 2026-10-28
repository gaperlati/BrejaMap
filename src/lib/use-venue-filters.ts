"use client";

import { useMemo, useState } from "react";
import type { Bounds } from "@/lib/geo";
import {
  extractNeighborhoods,
  filterAndSortVenues,
  filterVenuesInBounds,
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

  const hasActiveFilters =
    maxPrice != null ||
    beerType !== "" ||
    neighborhood !== "" ||
    sort !== "price_asc";

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
    filteredAndSortedVenues,
  };
}
