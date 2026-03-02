"use client";

type OsmLoadState = "idle" | "loading" | "error" | "success";

interface FilterChipsProps {
  happyHourOnly: boolean;
  onHappyHourOnlyChange: (v: boolean) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (v: boolean) => void;
  hasActiveFilters: boolean;
  onLoadOsmBars?: () => void;
  osmLoadState?: OsmLoadState;
  osmError?: string | null;
}

export function FilterChips({
  happyHourOnly,
  onHappyHourOnlyChange,
  filtersOpen,
  onFiltersOpenChange,
  hasActiveFilters,
  onLoadOsmBars,
  osmLoadState = "idle",
  osmError = null,
}: FilterChipsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-stone-500 text-sm shrink-0 mr-1">Cerveja</span>
        <button
          type="button"
          onClick={() => onHappyHourOnlyChange(!happyHourOnly)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition ${
            happyHourOnly
              ? "bg-amber-500 text-stone-950"
              : "bg-stone-700 text-stone-300 hover:bg-stone-600"
          }`}
        >
          🎉 Happy hour
        </button>
        <button
          type="button"
          onClick={() => onFiltersOpenChange(!filtersOpen)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition ${
            filtersOpen || hasActiveFilters
              ? "bg-amber-500 text-stone-950"
              : "bg-stone-700 text-stone-300 hover:bg-stone-600"
          }`}
        >
          <span aria-hidden>⚙</span>
          Filtros
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 rounded-full bg-stone-950" />
          )}
        </button>
        {onLoadOsmBars && (
          <button
            type="button"
            onClick={onLoadOsmBars}
            disabled={osmLoadState === "loading"}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition bg-sky-700/80 text-sky-100 hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Busca bares e restaurantes do Google Maps nesta área"
          >
            <span aria-hidden>🗺</span>
            {osmLoadState === "loading" ? "Carregando…" : "Buscar bares"}
          </button>
        )}
      </div>
      {osmError && (
        <p className="text-red-400 text-xs" role="alert">
          {osmError}
        </p>
      )}
    </div>
  );
}
