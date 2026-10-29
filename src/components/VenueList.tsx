"use client";

import type { BeerPrice, BeerType, Venue } from "@/types";
import { VenueCard } from "./VenueCard";

interface VenueListProps {
  venues: Venue[];
  /** Total count before filters (to distinguish "no venues" vs "no matches"). */
  totalVenuesCount?: number;
  selectedVenueId: string | null;
  onSelectVenue: (id: string | null) => void;
  beerTypeLabels: Record<BeerType, string>;
  /** Prices shown on each card (those matching the active filters). */
  getPrices: (v: Venue) => BeerPrice[];
  getMinPrice: (v: Venue) => number;
  /** When provided and list is empty due to no venues, show CTA to add first bar. */
  onAddBar?: () => void;
}

export function VenueList({
  venues,
  totalVenuesCount,
  selectedVenueId,
  onSelectVenue,
  beerTypeLabels,
  getPrices,
  getMinPrice,
  onAddBar,
}: VenueListProps) {
  const isEmpty = venues.length === 0;
  const noVenuesAtAll = totalVenuesCount != null && totalVenuesCount === 0;

  return (
    <div className="min-h-0 pb-2">
      {isEmpty ? (
        <div className="p-6 text-center text-stone-500 text-sm flex flex-col items-center gap-3">
          {noVenuesAtAll ? (
            <>
              <p>
                Nenhum bar nesta região ainda.
                <br />
                Seja o primeiro a adicionar!
              </p>
              {onAddBar && (
                <button
                  type="button"
                  onClick={onAddBar}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-medium hover:bg-amber-400 transition"
                >
                  Adicionar bar
                </button>
              )}
            </>
          ) : (
            <p>Nenhum bar encontrado com esses filtros.</p>
          )}
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
                prices={getPrices(venue)}
                minPrice={getMinPrice(venue)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
