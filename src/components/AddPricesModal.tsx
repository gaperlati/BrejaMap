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

type PriceRow = { type: BeerType; label: string; priceBRL: number };

const initialPriceRow = (): PriceRow => ({ type: "chope", label: "", priceBRL: 0 });

function toPriceRows(prices: BeerPrice[]): PriceRow[] {
  if (prices.length === 0) return [initialPriceRow()];
  return prices.map((p) => ({ type: p.type, label: p.label, priceBRL: p.priceBRL }));
}

interface AddPricesModalProps {
  isOpen: boolean;
  venue: Venue | null;
  onClose: () => void;
  /** Rejects with a user-facing message when saving fails; the parent closes the modal on success. */
  onSubmit: (venue: Venue) => Promise<void>;
}

export function AddPricesModal({
  isOpen,
  venue,
  onClose,
  onSubmit,
}: AddPricesModalProps) {
  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [hasHappyHour, setHasHappyHour] = useState(false);
  const [happyHourDetails, setHappyHourDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (venue && isOpen) {
      setSaveError(null);
      setPriceRows(toPriceRows(venue.beerPrices));
      setHasHappyHour(venue.hasHappyHour);
      setHappyHourDetails(venue.happyHourDetails ?? "");
    }
  }, [venue, isOpen]);

  const addPriceRow = () => {
    setPriceRows((prev) => [...prev, initialPriceRow()]);
  };

  const updatePriceRow = (index: number, updates: Partial<PriceRow>) => {
    setPriceRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...updates } : row))
    );
  };

  const removePriceRow = (index: number) => {
    setPriceRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const validBeerPrices = (): BeerPrice[] => {
    return priceRows
      .filter((row) => row.priceBRL > 0)
      .map((row) => ({
        type: row.type,
        label: row.label.trim() || BEER_TYPES.find((t) => t.value === row.type)!.label,
        priceBRL: row.priceBRL,
      }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const beerPrices = validBeerPrices();
    if (!venue || beerPrices.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit({
        ...venue,
        beerPrices,
        hasHappyHour,
        happyHourDetails: hasHappyHour ? happyHourDetails.trim() || undefined : undefined,
        pricesUnverified: true,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
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
          <div>
            <p className="block text-sm font-medium text-stone-400 mb-2">
              Preços de cerveja * (ao menos um)
            </p>
            {priceRows.map((row, index) => (
              <div key={`price-${index}`} className="flex flex-wrap items-center gap-2 mb-3">
                <select
                  value={row.type}
                  onChange={(e) =>
                    updatePriceRow(index, { type: e.target.value as BeerType })
                  }
                  className="px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 text-sm w-28"
                >
                  {BEER_TYPES.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => updatePriceRow(index, { label: e.target.value })}
                  placeholder="Marca (ex: Brahma)"
                  className="flex-1 min-w-[100px] px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 text-sm placeholder-stone-500"
                />
                <div className="flex items-center gap-1">
                  <span className="text-stone-500 text-sm">R$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={row.priceBRL || ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      updatePriceRow(index, {
                        priceBRL: !Number.isNaN(v) && v >= 0 ? v : 0,
                      });
                    }}
                    placeholder="0"
                    className="w-20 px-2 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removePriceRow(index)}
                  disabled={priceRows.length <= 1}
                  className="p-2 rounded text-stone-500 hover:text-stone-300 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Remover cerveja"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addPriceRow}
              className="text-sm text-amber-400 hover:text-amber-300"
            >
              + Adicionar cerveja
            </button>
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

          {saveError && (
            <p role="alert" className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
              {saveError}
            </p>
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
              disabled={validBeerPrices().length === 0 || saving}
              className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-medium hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Salvando..." : "Salvar preços"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
