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

const SAO_PAULO_CENTER = { lat: -23.5505, lng: -46.6333 };

interface AddVenueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (venue: Omit<Venue, "id" | "createdAt">) => void;
  /** Map center when modal opened; used as default location if user doesn't search address. */
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
  const [prices, setPrices] = useState<BeerPrice[]>([]);

  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<NominatimResult[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
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
  };

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
    if (!name.trim() || prices.length === 0) return;
    onSubmit({
      name: name.trim(),
      address: address.trim() || "Endereço não informado",
      neighborhood: neighborhood.trim() || "São Paulo",
      city: city.trim() || "São Paulo",
      state: state.trim() || "SP",
      lat,
      lng,
      beerPrices: prices,
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
    setHasHappyHour(false);
    setHappyHourDetails("");
    setPrices([]);
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
            <p className="text-xs text-stone-500 mb-2">
              Busque o endereço para preencher o pin no mapa e os campos abaixo. Se não buscar, usamos o centro atual do mapa.
            </p>
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
                      if (!Number.isNaN(v) && v >= 0)
                        addPrice(value, label, v);
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
              onClick={handleClose}
              className="px-4 py-2 rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim() || prices.length === 0}
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
