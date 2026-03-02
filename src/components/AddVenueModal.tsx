"use client";

import { useState } from "react";
import type { Venue, BeerType, BeerPrice } from "@/types";

const BEER_TYPES: { value: BeerType; label: string }[] = [
  { value: "chope", label: "Chope" },
  { value: "long_neck", label: "Long neck" },
  { value: "lata", label: "Lata" },
  { value: "garrafa", label: "Garrafa" },
  { value: "outro", label: "Outro" },
];

interface AddVenueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (venue: Omit<Venue, "id" | "createdAt">) => void;
}

export function AddVenueModal({
  isOpen,
  onClose,
  onSubmit,
}: AddVenueModalProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("São Paulo");
  const [state, setState] = useState("SP");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [hasHappyHour, setHasHappyHour] = useState(false);
  const [happyHourDetails, setHappyHourDetails] = useState("");
  const [prices, setPrices] = useState<BeerPrice[]>([]);

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
    const latNum = parseFloat(lat) || -23.5505;
    const lngNum = parseFloat(lng) || -46.6333;
    onSubmit({
      name: name.trim(),
      address: address.trim() || "Endereço não informado",
      neighborhood: neighborhood.trim() || "São Paulo",
      city: city.trim() || "São Paulo",
      state: state.trim() || "SP",
      lat: latNum,
      lng: lngNum,
      beerPrices: prices,
      hasHappyHour,
      happyHourDetails: hasHappyHour ? happyHourDetails.trim() : undefined,
    });
    resetForm();
  };

  const resetForm = () => {
    setName("");
    setAddress("");
    setNeighborhood("");
    setCity("São Paulo");
    setState("SP");
    setLat("");
    setLng("");
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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-stone-400 mb-1">
                Lat
              </label>
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-23.55"
                className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-400 mb-1">
                Lng
              </label>
              <input
                type="text"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-46.63"
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
