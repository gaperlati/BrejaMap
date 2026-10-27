"use client";

import type { Venue, BeerType } from "@/types";

interface VenueCardProps {
  venue: Venue;
  isSelected: boolean;
  onSelect: () => void;
  beerTypeLabels: Record<BeerType, string>;
  minPrice: number;
}

export function VenueCard({
  venue,
  isSelected,
  onSelect,
  beerTypeLabels,
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
        {venue.beerPrices.length === 0 ? (
          <span className="text-xs px-2 py-0.5 rounded bg-stone-800 text-stone-500">
            Preços não informados
          </span>
        ) : (
          venue.beerPrices.slice(0, 3).map((p, i) => (
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
      {venue.hasHappyHour && (
        <span className="inline-block mt-1 text-xs text-amber-600">
          🎉 Happy hour
        </span>
      )}
    </button>
  );
}
