"use client";

import type { PriceFilter, BeerType, SortOption } from "@/types";

interface FilterBarProps {
  maxPrice: PriceFilter;
  onMaxPriceChange: (v: PriceFilter) => void;
  beerType: BeerType | "";
  onBeerTypeChange: (v: BeerType | "") => void;
  neighborhood: string;
  onNeighborhoodChange: (v: string) => void;
  neighborhoods: string[];
  happyHourOnly: boolean;
  onHappyHourOnlyChange: (v: boolean) => void;
  sort: SortOption;
  onSortChange: (v: SortOption) => void;
  sortOptions: { value: SortOption; label: string }[];
}

export function FilterBar({
  maxPrice,
  onMaxPriceChange,
  beerType,
  onBeerTypeChange,
  neighborhood,
  onNeighborhoodChange,
  neighborhoods,
  happyHourOnly,
  onHappyHourOnlyChange,
  sort,
  onSortChange,
  sortOptions,
}: FilterBarProps) {
  return (
    <div className="p-3 border-b border-stone-800 space-y-3 bg-stone-900/50">
      <div>
        <label className="block text-xs font-medium text-stone-500 mb-1">
          Preço máximo (R$)
        </label>
        <input
          type="number"
          min={0}
          step={0.5}
          placeholder="Qualquer"
          value={maxPrice ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onMaxPriceChange(v === "" ? null : Math.max(0, parseFloat(v) || 0));
          }}
          className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-500 mb-1">
          Tipo de cerveja
        </label>
        <select
          value={beerType}
          onChange={(e) => onBeerTypeChange((e.target.value || "") as BeerType | "")}
          className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          <option value="">Todos</option>
          <option value="chope">Chope</option>
          <option value="long_neck">Long neck</option>
          <option value="lata">Lata</option>
          <option value="garrafa">Garrafa</option>
          <option value="outro">Outro</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-500 mb-1">
          Bairro
        </label>
        <select
          value={neighborhood}
          onChange={(e) => onNeighborhoodChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          <option value="">Todos</option>
          {neighborhoods.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={happyHourOnly}
          onChange={(e) => onHappyHourOnlyChange(e.target.checked)}
          className="rounded border-stone-600 bg-stone-800 text-amber-500 focus:ring-amber-500"
        />
        <span className="text-sm text-stone-300">Apenas happy hour</span>
      </label>

      <div>
        <label className="block text-xs font-medium text-stone-500 mb-1">
          Ordenar
        </label>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
