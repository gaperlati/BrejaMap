"use client";

import { useId } from "react";
import type { PriceFilter, BeerType, SortOption } from "@/types";
import { FilterSelect } from "./FilterSelect";
import type { TagFilters } from "@/lib/use-venue-filters";

interface FilterBarProps {
  activeFilterCount: number;
  onClearFilters: () => void;
  tagFilters: TagFilters;
  onTagFilterChange: (key: keyof TagFilters, value: boolean) => void;
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
  activeFilterCount,
  onClearFilters,
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
  const priceId = useId();
  return (
    <div className="p-3 border-b border-stone-800 space-y-3 bg-stone-900/50">
      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={onClearFilters}
          className="text-sm text-amber-400 underline underline-offset-2 hover:text-amber-300"
        >
          Limpar filtros ({activeFilterCount})
        </button>
      )}
      <div>
        <label htmlFor={priceId} className="block text-xs font-medium text-stone-500 mb-1">
          Preço máximo (R$)
        </label>
        <input
          id={priceId}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.5}
          placeholder="Qualquer"
          value={maxPrice ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onMaxPriceChange(v === "" ? null : Math.max(0, parseFloat(v) || 0));
          }}
          className="filter-price-input w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
      </div>

      <FilterSelect
        label="Tipo de cerveja"
        value={beerType}
        onChange={(value) => onBeerTypeChange(value as BeerType | "")}
        options={[
          { value: "", label: "Todos" },
          { value: "chope", label: "Chope" },
          { value: "long_neck", label: "Long neck" },
          { value: "lata", label: "Lata" },
          { value: "garrafa", label: "Litrão" },
          { value: "outro", label: "Outro" },
        ]}
      />

      <FilterSelect
        label="Bairro"
        value={neighborhood}
        onChange={onNeighborhoodChange}
        options={[{ value: "", label: "Todos" }, ...neighborhoods.map((name) => ({ value: name, label: name }))]}
      />

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={happyHourOnly}
          onChange={(e) => onHappyHourOnlyChange(e.target.checked)}
          className="rounded border-stone-600 bg-stone-800 text-amber-500 focus:ring-amber-500"
        />
        <span className="text-sm text-stone-300">Apenas happy hour</span>
      </label>


      <FilterSelect
        label="Ordenar"
        value={sort}
        onChange={(value) => onSortChange(value as SortOption)}
        options={sortOptions}
      />
    </div>
  );
}
