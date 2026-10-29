"use client";

import { useEffect, useId, useRef, useState } from "react";
import { distanceKm } from "@/lib/geo";
import {
  formatDistanceLabel,
  formatNominatimResult,
  placeDetailsFromNominatim,
  searchAddressNear,
  type NominatimResult,
  type PlaceDetails,
} from "@/lib/geocode";
import type { LatLng } from "@/lib/venue-location";
import { PRECISE_PIN_ZOOM } from "@/lib/use-venue-location";

const SEARCH_DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 3;

type SearchStatus = "idle" | "loading" | "done" | "error";

interface VenueLocationSearchProps {
  /** Where the pin is now: results near it come first, with their distance. */
  near: LatLng;
  onSelect: (point: LatLng, details: PlaceDetails, zoom: number) => void;
}

/**
 * Optional address search of "Adicionar bar". Results are listed inline (no floating
 * dropdown) so long street names stay readable on small screens.
 */
export function VenueLocationSearch({ near, onSelect }: VenueLocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [scope, setScope] = useState<"nearby" | "wide">("nearby");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const listId = useId();
  /** Label written into the input after a pick; it must not trigger a new search. */
  const pickedLabelRef = useRef<string | null>(null);
  const nearRef = useRef(near);
  useEffect(() => {
    nearRef.current = near;
  }, [near]);

  const trimmed = query.trim();

  // Debounced search; each new query aborts the previous request, so only the latest
  // answer is ever shown.
  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH || trimmed === pickedLabelRef.current) {
      setStatus("idle");
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      setStatus("loading");
      searchAddressNear(trimmed, nearRef.current, { signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found.results);
          setScope(found.scope);
          setActiveIndex(-1);
          setStatus("done");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus("error");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [trimmed]);

  const select = (r: NominatimResult) => {
    const point = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    const formatted = formatNominatimResult(r);
    // Streets and places: zoom in close so the pin can be nudged to the right door.
    onSelect(
      point,
      placeDetailsFromNominatim(r),
      formatted.zoom >= 16 ? PRECISE_PIN_ZOOM : formatted.zoom
    );
    pickedLabelRef.current = formatted.shortLabel.trim();
    setQuery(formatted.shortLabel);
    setOpen(false);
    setResults([]);
    setStatus("idle");
  };

  const showPanel = open && trimmed.length >= MIN_QUERY_LENGTH && status !== "idle";
  const listVisible = showPanel && status === "done" && results.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (showPanel) {
        // Close the results, not the whole dialog.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!listVisible) {
      // Enter must never submit the bar form from the search field.
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[activeIndex >= 0 ? activeIndex : 0]);
    }
  };

  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" aria-hidden>
          🔍
        </span>
        <input
          type="text"
          role="combobox"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar rua ou lugar (opcional)"
          aria-label="Buscar endereço do bar (opcional)"
          aria-autocomplete="list"
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-activedescendant={listVisible && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          enterKeyHint="search"
          autoComplete="off"
          className="w-full rounded-lg border border-stone-700 bg-stone-900 py-2 pl-9 pr-20 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
        {status === "loading" && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-500">
            Buscando...
          </span>
        )}
        {status !== "loading" && query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
            aria-label="Limpar busca"
          >
            Limpar
          </button>
        )}
      </div>

      {showPanel && (
        <div className="mt-2 overflow-hidden rounded-lg border border-stone-700 bg-stone-900" aria-live="polite">
          {status === "loading" && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-stone-500">Buscando endereços perto do mapa...</p>
          )}
          {status === "error" && (
            <p className="px-3 py-2 text-xs text-red-300">
              A busca falhou. Você pode marcar o local direto no mapa.
            </p>
          )}
          {status === "done" && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-stone-400">
              Nenhum endereço encontrado. Sem problema: arraste o mapa até o pino ficar no bar — o endereço é opcional.
            </p>
          )}
          {status === "done" && results.length > 0 && scope === "wide" && (
            <p className="border-b border-stone-700/60 px-3 py-2 text-xs text-amber-200/90">
              Nada com esse nome perto do mapa. Resultados de outras cidades:
            </p>
          )}
          {listVisible && (
            <ul id={listId} role="listbox" aria-label="Endereços encontrados" className="max-h-60 overflow-y-auto">
              {results.map((r, index) => {
                const formatted = formatNominatimResult(r);
                const km = distanceKm(near, { lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
                const active = index === activeIndex;
                return (
                  <li
                    key={r.place_id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={active}
                    // mousedown keeps focus in the input (no blur race before the click).
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(r)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex cursor-pointer items-start gap-3 border-b border-stone-700/50 px-3 py-2.5 last:border-0 ${
                      active ? "bg-stone-700" : "hover:bg-stone-800"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-stone-100 [overflow-wrap:anywhere]">{formatted.title}</span>
                      {formatted.subtitle && (
                        <span className="block text-xs text-stone-400 [overflow-wrap:anywhere]">{formatted.subtitle}</span>
                      )}
                    </span>
                    <span className="shrink-0 pt-0.5 text-xs text-stone-500">{formatDistanceLabel(km)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {status === "done" && results.length > 0 && (
            <p className="border-t border-stone-700/60 px-3 py-2 text-xs text-stone-500">
              Não achou a rua certa? Ignore a busca e arraste o mapa até o bar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
