"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Venue, BeerType, BeerPrice } from "@/types";
import { searchAddress, type NominatimResult } from "@/lib/geocode";

const BEER_TYPES: { value: BeerType; label: string }[] = [
  { value: "chope", label: "Chope" },
  { value: "long_neck", label: "Long neck" },
  { value: "lata", label: "Lata" },
  { value: "garrafa", label: "Garrafa" },
  { value: "outro", label: "Outro" },
];

type PriceRow = { type: BeerType; label: string; priceBRL: number };

const initialPriceRow = (): PriceRow => ({ type: "chope", label: "", priceBRL: 0 });

const SAO_PAULO_CENTER = { lat: -23.5505, lng: -46.6333 };

interface AddVenueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (venue: Omit<Venue, "id" | "createdAt">) => void;
  /** Map center when modal opened. */
  initialLat?: number;
  initialLng?: number;
}

export function AddVenueModal({
  isOpen,
  onClose,
  onSubmit,
  initialLat = SAO_PAULO_CENTER.lat,
  initialLng = SAO_PAULO_CENTER.lng,
}: AddVenueModalProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("São Paulo");
  const [city, setCity] = useState("São Paulo");
  const [state, setState] = useState("SP");
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [hasHappyHour, setHasHappyHour] = useState(false);
  const [happyHourDetails, setHappyHourDetails] = useState("");
  const [priceRows, setPriceRows] = useState<PriceRow[]>([initialPriceRow()]);

  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<NominatimResult[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationSelected, setLocationSelected] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLat(initialLat);
      setLng(initialLng);
    }
  }, [isOpen, initialLat, initialLng]);

  const doLocationSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setLocationResults([]);
      return;
    }
    setLocationLoading(true);
    try {
      const data = await searchAddress(q);
      setLocationResults(data);
      setLocationOpen(true);
    } catch {
      setLocationResults([]);
    } finally {
      setLocationLoading(false);
    }
  }, []);

  const handleLocationChange = (value: string) => {
    setLocationQuery(value);
    setLocationSelected(false);
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!value.trim()) {
      setLocationResults([]);
      setLocationOpen(false);
      return;
    }
    locationDebounceRef.current = setTimeout(() => doLocationSearch(value), 400);
  };

  const handleLocationSelect = (r: NominatimResult) => {
    const latNum = parseFloat(r.lat);
    const lngNum = parseFloat(r.lon);
    if (!Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
      setLat(latNum);
      setLng(lngNum);
    }
    setAddress(r.display_name);
    const addr = r.address;
    if (addr) {
      setNeighborhood(addr.suburb ?? addr.road ?? "—");
      setCity(addr.city ?? addr.town ?? addr.village ?? "São Paulo");
      setState(addr.state ?? "SP");
    }
    setLocationQuery(r.display_name);
    setLocationResults([]);
    setLocationOpen(false);
    setLocationSelected(true);
  };

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const beerPrices = validBeerPrices();
    if (!name.trim() || beerPrices.length === 0) return;
    onSubmit({
      name: name.trim(),
      address: address.trim(),
      neighborhood: neighborhood.trim() || "São Paulo",
      city: city.trim() || "São Paulo",
      state: state.trim() || "SP",
      lat,
      lng,
      beerPrices,
      hasHappyHour,
      happyHourDetails: hasHappyHour ? happyHourDetails.trim() : undefined,
    });
    resetForm();
  };

  const resetForm = () => {
    setName("");
    setAddress("");
    setNeighborhood("São Paulo");
    setCity("São Paulo");
    setState("SP");
    setLat(initialLat);
    setLng(initialLng);
    setLocationQuery("");
    setLocationResults([]);
    setLocationOpen(false);
    setLocationSelected(false);
    setHasHappyHour(false);
    setHappyHourDetails("");
    setPriceRows([initialPriceRow()]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70"
      onClick={handleClose}
    >
      <div
        className="bg-stone-800 border border-stone-600 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-stone-600 flex items-center justify-between sticky top-0 bg-stone-800 z-10">
          <h2 className="text-lg font-semibold text-amber-400">
            Adicionar bar
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded text-stone-400 hover:text-stone-200"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-400 mb-1">
              Nome do bar *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-400 mb-1">
              Localização
            </label>
            <div className="relative">
              <input
                type="text"
                value={locationQuery}
                onChange={(e) => handleLocationChange(e.target.value)}
                onFocus={() => locationResults.length > 0 && setLocationOpen(true)}
                onBlur={() => setTimeout(() => setLocationOpen(false), 200)}
                placeholder="Buscar endereço..."
                className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 placeholder-stone-500"
              />
              {locationLoading && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 text-xs">
                  Buscando...
                </span>
              )}
              {locationOpen && locationResults.length > 0 && (
                <ul className="absolute top-full left-0 right-0 mt-1 py-1 rounded-lg bg-stone-800 border border-stone-700 shadow-xl z-50 max-h-48 overflow-y-auto">
                  {locationResults.map((r) => (
                    <li
                      key={r.place_id}
                      role="option"
                      onClick={() => handleLocationSelect(r)}
                      className="px-3 py-2 text-sm text-stone-200 hover:bg-stone-700 cursor-pointer border-b border-stone-700/50 last:border-0"
                    >
                      <span className="block truncate">{r.display_name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!locationSelected && locationQuery.trim().length > 0 && (
              <p className="text-xs text-amber-300 mt-2">
                Selecione um endereço da lista para salvar o bar.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-400 mb-1">
              Endereço
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-stone-400 mb-1">
                Bairro
              </label>
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-400 mb-1">
                Cidade
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100"
              />
            </div>
          </div>

          <div>
            <p className="block text-sm font-medium text-stone-400 mb-2">
              Preços de cerveja * (adicione ao menos um)
            </p>
            <p className="text-xs text-stone-500 mb-3">
              Tipo + marca (ex: Brahma, Heineken) + preço. Use &quot;Adicionar cerveja&quot; para mais opções.
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

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim() || validBeerPrices().length === 0}
              className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-medium hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Salvar bar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
