"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bounds } from "@/lib/geo";
import {
  extractNeighborhoods,
  filterAndSortVenues,
  filterVenuesInBounds,
  getMatchingMinPrice,
  matchingBeerPrices,
} from "@/lib/venue-state";
import type { BeerType, PriceFilter, SortOption, Venue } from "@/types";

/** Yes/no venue facts the list can be narrowed to (unknown values never pass). */
export type TagFilters = {
  footballOnly: boolean;
  reservationsOnly: boolean;
  outdoorOnly: boolean;
  openNowOnly: boolean;
};

const NO_TAG_FILTERS: TagFilters = {
  footballOnly: false,
  reservationsOnly: false,
  outdoorOnly: false,
  openNowOnly: false,
};

/** "Aberto agora" is re-evaluated this often while that filter is on. */
const OPEN_NOW_REFRESH_MS = 60_000;

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
  const [tagFilters, setTagFilters] = useState<TagFilters>(NO_TAG_FILTERS);
  const [happyHourOnly, setHappyHourOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!tagFilters.openNowOnly) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), OPEN_NOW_REFRESH_MS);
    return () => clearInterval(id);
  }, [tagFilters.openNowOnly]);

  const setTagFilter = (key: keyof TagFilters, value: boolean) =>
    setTagFilters((prev) => ({ ...prev, [key]: value }));

  const venuesInBounds = useMemo(
    () => filterVenuesInBounds(venues, mapBounds),
    [venues, mapBounds]
  );

  const neighborhoods = useMemo(() => extractNeighborhoods(venuesInBounds), [venuesInBounds]);

  const hasActiveFilters =
    Object.values(tagFilters).some(Boolean) ||
    maxPrice != null ||
    beerType !== "" ||
    neighborhood !== "" ||
    happyHourOnly ||
    sort !== "price_asc";

  const filteredAndSortedVenues = useMemo(
    () =>
      filterAndSortVenues(venues, {
        mapBounds,
        maxPrice,
        beerType,
        neighborhood,
        ...tagFilters,
        happyHourOnly,
        sort,
        userLocation,
        mapCenter,
        now,
      }),
    [venues, mapBounds, maxPrice, beerType, neighborhood, tagFilters, happyHourOnly, sort, userLocation, mapCenter, now]
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
    tagFilters,
    setTagFilter,
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
    getMinPrice,
  };
}
