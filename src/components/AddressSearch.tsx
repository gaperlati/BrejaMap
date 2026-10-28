"use client";

import { useState, useRef, useCallback } from "react";
import { formatNominatimResult, searchAddress, type NominatimResult } from "@/lib/geocode";

interface AddressSearchProps {
  onSelectLocation: (lat: number, lng: number, zoom: number) => void;
  placeholder?: string;
  /** Results closer to this point rank higher (user location or map center). */
  biasLocation?: { lat: number; lng: number };
}

export function AddressSearch({
  onSelectLocation,
  placeholder = "Buscar endereço ou cidade...",
  biasLocation,
}: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchAddress(q, { biasLocation });
      setResults(data);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [biasLocation]);

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(value), 400);
  };

  const handleSelect = (r: NominatimResult) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    const formatted = formatNominatimResult(r);
    onSelectLocation(lat, lng, formatted.zoom);
    setQuery(formatted.shortLabel);
    setResults([]);
    setOpen(false);
  };

  const handleBlur = () => {
    setTimeout(() => setOpen(false), 200);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative flex items-center">
        <span className="absolute left-3 text-stone-500 pointer-events-none" aria-hidden>
          🔍
        </span>
        <input
          type="text"
          role="combobox"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full pl-9 pr-4 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-sm font-sans"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="address-results"
        />
        {loading && (
          <span className="absolute right-3 text-stone-500 text-xs">
            Buscando...
          </span>
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          id="address-results"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 py-1 rounded-lg bg-stone-800 border border-stone-700 shadow-xl z-[10000] max-h-60 overflow-y-auto"
        >
          {results.map((r) => {
            const formatted = formatNominatimResult(r);
            return (
              <li
                key={r.place_id}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => handleSelect(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSelect(r);
                }}
                className="px-4 py-2.5 text-sm text-stone-200 hover:bg-stone-700 cursor-pointer border-b border-stone-700/50 last:border-0"
              >
                <span className="block font-medium text-stone-100 truncate">
                  {formatted.title}
                </span>
                {formatted.subtitle && (
                  <span className="block text-xs text-stone-500 truncate">
                    {formatted.subtitle}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
