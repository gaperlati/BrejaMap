"use client";

import type { BeerType } from "@/types";
import { MenuPhotoImport } from "@/components/MenuPhotoImport";
import { MAX_BEER_PRICES } from "@/lib/price-validation";
import { emptyPriceRow, mergeImportedPrices, type PriceRow } from "@/lib/price-rows";
import { BEER_TYPE_LABELS } from "@/lib/venue-state";

const BEER_TYPES = Object.entries(BEER_TYPE_LABELS) as [BeerType, string][];

const FIELD_CLASS = "rounded-lg bg-stone-900 border border-stone-700 text-stone-100 text-sm";

interface PriceRowsEditorProps {
  rows: PriceRow[];
  onChange: (update: (rows: PriceRow[]) => PriceRow[]) => void;
  disabled?: boolean;
}

/** Type + brand + price (+ optional ml) rows, with "Ler cardápio por foto" on top. */
export function PriceRowsEditor({ rows, onChange, disabled }: PriceRowsEditorProps) {
  const updateRow = (index: number, updates: Partial<PriceRow>) =>
    onChange((prev) => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)));
  const removeRow = (index: number) =>
    onChange((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  return (
    <div>
      <MenuPhotoImport
        disabled={disabled}
        onImport={(prices) => onChange((prev) => mergeImportedPrices(prev, prices))}
      />
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={`price-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_auto] gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_6.5rem_4.5rem_auto]"
          >
            <select
              value={row.type}
              onChange={(e) => updateRow(index, { type: e.target.value as BeerType })}
              aria-label={`Tipo da cerveja ${index + 1}`}
              className={`px-2 py-2 ${FIELD_CLASS}`}
            >
              {BEER_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={row.label}
              maxLength={60}
              onChange={(e) => updateRow(index, { label: e.target.value })}
              placeholder="Marca (ex: Brahma)"
              aria-label={`Marca da cerveja ${index + 1}`}
              className={`order-last col-span-4 px-3 py-2 placeholder-stone-500 sm:order-none sm:col-span-1 ${FIELD_CLASS}`}
            />
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-stone-500" aria-hidden>
                R$
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={row.priceBRL || ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  updateRow(index, { priceBRL: !Number.isNaN(v) && v >= 0 ? v : 0 });
                }}
                placeholder="0,00"
                aria-label={`Preço da cerveja ${index + 1} em reais`}
                className={`w-full pl-8 pr-2 py-2 ${FIELD_CLASS}`}
              />
            </div>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={row.volumeMl ?? ""}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                updateRow(index, { volumeMl: Number.isInteger(v) && v > 0 ? v : undefined });
              }}
              placeholder="ml"
              aria-label={`Volume da cerveja ${index + 1} em ml (opcional)`}
              className={`w-full px-2 py-2 ${FIELD_CLASS}`}
            />
            <button
              type="button"
              onClick={() => removeRow(index)}
              disabled={rows.length <= 1}
              className="p-2 rounded text-stone-500 hover:text-stone-300 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`Remover cerveja ${index + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {rows.length < MAX_BEER_PRICES && (
        <button
          type="button"
          onClick={() => onChange((prev) => [...prev, emptyPriceRow()])}
          className="mt-3 text-sm text-amber-400 hover:text-amber-300"
        >
          + Adicionar cerveja
        </button>
      )}
    </div>
  );
}
