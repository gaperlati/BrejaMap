"use client";

import type { Venue, BeerType } from "@/types";

interface VenueSheetProps {
  venue: Venue | null;
  onClose: () => void;
  beerTypeLabels: Record<BeerType, string>;
  getMinPrice: (v: Venue) => number;
  onAddPrices?: (venue: Venue) => void;
}

export function VenueSheet({
  venue,
  onClose,
  beerTypeLabels,
  getMinPrice,
  onAddPrices,
}: VenueSheetProps) {
  if (!venue) return null;

  const minPrice = getMinPrice(venue);
  const hasPrices = venue.beerPrices.length > 0 && Number.isFinite(minPrice);
  const fullAddress = [venue.address, venue.neighborhood, venue.city, venue.state]
    .filter(Boolean)
    .join(", ");
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue.lat + "," + venue.lng)}`;

  return (
    <>
      <div
        className="fixed inset-0 z-[9000] bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[9001] bg-stone-900 border-t border-stone-700 rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto animate-slide-up"
        role="dialog"
        aria-label="Detalhes do bar"
      >
        <div className="sticky top-0 bg-stone-900 flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 rounded-full bg-stone-600" aria-hidden />
        </div>

        {venue.userAdded && (
          <div className="mx-4 mb-3 py-2.5 px-3 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-sm">
            Preços não verificados (adicionado por um usuário)
          </div>
        )}

        {venue.fromOsm && (
          <div className="mx-4 mb-3 py-2.5 px-3 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-200 text-sm">
            Dados do OpenStreetMap. Preços não informados – adicione se souber.
          </div>
        )}

        {venue.fromGoogle && (
          <div className="mx-4 mb-3 py-2.5 px-3 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm">
            Dados do Google Maps. Preços não informados – adicione se souber.
          </div>
        )}

        <div className="px-4 pb-6">
          <h2 className="text-xl font-bold text-stone-100">{venue.name}</h2>
          <p className="text-stone-400 text-sm mt-0.5">{fullAddress}</p>

          <div className="flex flex-wrap gap-2 mt-3">
            <span className="px-2.5 py-1 rounded-md bg-stone-700 text-stone-300 text-xs">
              {venue.beerPrices.length === 0
                ? "Preços não informados"
                : `${venue.beerPrices.length} cerveja${venue.beerPrices.length !== 1 ? "s" : ""} servida${venue.beerPrices.length !== 1 ? "s" : ""}`}
            </span>
            {venue.hasHappyHour && (
              <span className="px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-400 text-xs">
                Happy hour
              </span>
            )}
            {venue.beerPrices.slice(0, 3).map((p, i) => (
              <span
                key={`price-${i}`}
                className="px-2.5 py-1 rounded-md bg-stone-700 text-stone-300 text-xs"
              >
                {p.label?.trim()
                  ? `${p.label} R$ ${p.priceBRL.toFixed(2)}`
                  : `${beerTypeLabels[p.type]} R$ ${p.priceBRL.toFixed(2)}`}
              </span>
            ))}
          </div>

          <p className="text-amber-400 font-semibold mt-3">
            {hasPrices ? `A partir de R$ ${minPrice.toFixed(2)}` : "—"}
          </p>
          {venue.hasHappyHour && venue.happyHourDetails && (
            <p className="text-stone-400 text-sm mt-1">
              🎉 {venue.happyHourDetails}
            </p>
          )}

          <div
            className="mt-5 -mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
            role="toolbar"
            aria-label="Ações do bar"
          >
            {onAddPrices && (
              <button
                type="button"
                onClick={() => onAddPrices(venue)}
                className="flex min-h-[2.75rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-amber-500 px-2.5 py-2.5 text-xs font-medium text-stone-950 transition hover:bg-amber-400 sm:min-w-0 sm:flex-1 sm:gap-2 sm:px-3 sm:py-3 sm:text-sm"
              >
                <span aria-hidden className="shrink-0">
                  🍺
                </span>
                {venue.beerPrices.length === 0 ? "Adicionar preços" : "Editar preços"}
              </button>
            )}
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[2.75rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-stone-700 px-2.5 py-2.5 text-xs font-medium text-stone-100 transition hover:bg-stone-600 sm:min-w-0 sm:flex-1 sm:gap-2 sm:px-3 sm:py-3 sm:text-sm"
            >
              <span aria-hidden className="shrink-0">
                🚶
              </span>
              Como chegar
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
