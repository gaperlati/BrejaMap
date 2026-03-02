"use client";

import { useState, useEffect } from "react";
import type { Venue, BeerType, BeerPrice } from "@/types";

const BEER_TYPES: { value: BeerType; label: string }[] = [
  { value: "chope", label: "Chope" },
  { value: "long_neck", label: "Long neck" },
  { value: "lata", label: "Lata" },
  { value: "garrafa", label: "Garrafa" },
  { value: "outro", label: "Outro" },
];

interface AddPricesModalProps {
  isOpen: boolean;
  venue: Venue | null;
  onClose: () => void;
  onSubmit: (venue: Venue) => void;
}

export function AddPricesModal({
  isOpen,
  venue,
  onClose,
  onSubmit,
}: AddPricesModalProps) {
  const [prices, setPrices] = useState<BeerPrice[]>([]);
  const [hasHappyHour, setHasHappyHour] = useState(false);
  const [happyHourDetails, setHappyHourDetails] = useState("");

  useEffect(() => {
    if (venue) {
      setPrices([...venue.beerPrices]);
      setHasHappyHour(venue.hasHappyHour);
      setHappyHourDetails(venue.happyHourDetails ?? "");
    }
  }, [venue, isOpen]);

  const addPrice = (type: BeerType, label: string, priceBRL: number) => {
    setPrices((prev) => {
      const filtered = prev.filter((p) => p.type !== type);
      return [...filtered, { type, label, priceBRL }];
    });
  };

  const removePrice = (type: BeerType) => {
    setPrices((prev) => prev.filter((p) => p.type !== type));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!venue || prices.length === 0) return;
    onSubmit({
      ...venue,
      beerPrices: prices,
      hasHappyHour,
      happyHourDetails: hasHappyHour ? happyHourDetails.trim() || undefined : undefined,
      userAdded: true,
    });
    onClose();
  };

  if (!isOpen || !venue) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-stone-800 border border-stone-600 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-stone-600 flex items-center justify-between sticky top-0 bg-stone-800 z-10">
          <h2 className="text-lg font-semibold text-amber-400">
            Adicionar preços – {venue.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-stone-400 hover:text-stone-200"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <p className="text-stone-400 text-sm">
            Informe os preços que você conhece. Pode adicionar um ou mais tipos.
          </p>

          <div>
            <p className="block text-sm font-medium text-stone-400 mb-2">
              Preços de cerveja * (ao menos um)
            </p>
            {BEER_TYPES.map(({ value, label }) => {
              const current = prices.find((p) => p.type === value);
              return (
                <div key={value} className="flex items-center gap-2 mb-2">
                  <span className="w-24 text-sm text-stone-400">{label}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="R$"
                    value={current?.priceBRL ?? ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v) && v >= 0) addPrice(value, label, v);
                      else removePrice(value);
                    }}
                    className="flex-1 px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 w-24"
                  />
                  <span className="text-stone-500 text-sm">R$</span>
                </div>
              );
            })}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hasHappyHour}
              onChange={(e) => setHasHappyHour(e.target.checked)}
              className="rounded border-stone-600 bg-stone-800 text-amber-500"
            />
            <span className="text-sm text-stone-300">Tem happy hour</span>
          </label>

          {hasHappyHour && (
            <div>
              <label className="block text-sm font-medium text-stone-400 mb-1">
                Detalhes do happy hour
              </label>
              <input
                type="text"
                value={happyHourDetails}
                onChange={(e) => setHappyHourDetails(e.target.value)}
                placeholder="Ex: Seg–Sex 17h–20h: chope R$ 6"
                className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100"
              />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={prices.length === 0}
              className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-medium hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Salvar preços
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
