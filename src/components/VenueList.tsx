"use client";

import type { Venue, BeerType } from "@/types";
import { VenueCard } from "./VenueCard";

interface VenueListProps {
  venues: Venue[];
  selectedVenueId: string | null;
  onSelectVenue: (id: string | null) => void;
  beerTypeLabels: Record<BeerType, string>;
  getMinPrice: (v: Venue) => number;
}

export function VenueList({
  venues,
  selectedVenueId,
  onSelectVenue,
  beerTypeLabels,
  getMinPrice,
}: VenueListProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {venues.length === 0 ? (
        <div className="p-6 text-center text-stone-500 text-sm">
          Nenhum bar encontrado com esses filtros.
        </div>
      ) : (
        <ul className="divide-y divide-stone-800">
          {venues.map((venue) => (
            <li key={venue.id}>
              <VenueCard
                venue={venue}
                isSelected={venue.id === selectedVenueId}
                onSelect={() => onSelectVenue(venue.id)}
                beerTypeLabels={beerTypeLabels}
                minPrice={getMinPrice(venue)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
