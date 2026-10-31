"use client";

import type { BeerPrice, BeerType, Venue } from "@/types";
import { venueFreshnessLabel } from "@/lib/price-freshness";
import { MIN_RATINGS_TO_SHOW, ratingLabel } from "@/lib/venue-ratings";

interface VenueCardProps {
  venue: Venue;
  isSelected: boolean;
  onSelect: () => void;
  beerTypeLabels: Record<BeerType, string>;
  /** Prices to show (the venue's beers matching the active filters). */
  prices: BeerPrice[];
  minPrice: number;
}

export function VenueCard({
  venue,
  isSelected,
  onSelect,
  beerTypeLabels,
  prices,
  minPrice,
}: VenueCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 transition ${
        isSelected
          ? "bg-amber-500/20 border-l-4 border-amber-500"
          : "hover:bg-stone-800/80 border-l-4 border-transparent"
      }`}
    >
      <p className="font-semibold text-stone-100">{venue.name}</p>
      <p className="text-stone-500 text-sm">{venue.neighborhood || venue.city}</p>
      <div className="flex flex-wrap gap-2 mt-2">
        {prices.length === 0 ? (
          <span className="text-xs px-2 py-0.5 rounded bg-stone-800 text-stone-500">
            Preços não informados
          </span>
        ) : (
          prices.slice(0, 3).map((p, i) => (
            <span
              key={`price-${i}`}
              className="text-xs px-2 py-0.5 rounded bg-stone-800 text-stone-400"
            >
              {p.label?.trim()
                ? `${p.label} R$ ${p.priceBRL.toFixed(2)}`
                : `${beerTypeLabels[p.type]} R$ ${p.priceBRL.toFixed(2)}`}
            </span>
          ))
        )}
      </div>
      <p className="text-amber-400 font-medium text-sm mt-1">
        {Number.isFinite(minPrice) ? `A partir de R$ ${minPrice.toFixed(2)}` : "—"}
      </p>
      {venueFreshnessLabel(venue.beerPrices) && (
        <p className="text-xs text-stone-500">{venueFreshnessLabel(venue.beerPrices)}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {venue.hasHappyHour && <span className="text-amber-600">🎉 Happy hour</span>}
        {venue.transmitsFootball === true && <span className="text-stone-400">⚽ Futebol</span>}
        {venue.acceptsReservations === true && <span className="text-stone-400">📅 Reserva</span>}
        {venue.hasOutdoorArea === true && <span className="text-stone-400">🌳 Área externa</span>}
        {(venue.ratingCount ?? 0) >= MIN_RATINGS_TO_SHOW && (
          <span className="text-stone-400">{ratingLabel(venue)}</span>
        )}
      </div>
    </button>
  );
}
