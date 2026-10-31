"use client";

import { useState, useEffect } from "react";
import type { Venue, VenueAttributes, VenueAttributesPatch } from "@/types";
import { PriceRowsEditor } from "@/components/PriceRowsEditor";
import { VenueAttributesEditor, openingHoursValid } from "@/components/VenueAttributes";
import { priceRowsToPrices, toPriceRows, type PriceRow } from "@/lib/price-rows";
import { diffVenueAttributes } from "@/lib/venue-attributes";

/** What the editor saves: the edited venue plus only the attributes the user changed. */
export type VenuePricesEdit = { venue: Venue; attributes: VenueAttributesPatch };

function attributesOf(venue: Venue): VenueAttributes {
  return {
    transmitsFootball: venue.transmitsFootball,
    acceptsReservations: venue.acceptsReservations,
    hasOutdoorArea: venue.hasOutdoorArea,
    openingHours: venue.openingHours,
  };
}

interface AddPricesModalProps {
  isOpen: boolean;
  venue: Venue | null;
  onClose: () => void;
  /** Rejects with a user-facing message when saving fails; the parent closes the modal on success. */
  onSubmit: (edit: VenuePricesEdit) => Promise<void>;
}

export function AddPricesModal({
  isOpen,
  venue,
  onClose,
  onSubmit,
}: AddPricesModalProps) {
  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [attributes, setAttributes] = useState<VenueAttributes>({});
  const [hasHappyHour, setHasHappyHour] = useState(false);
  const [happyHourDetails, setHappyHourDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The parent passes a snapshot taken when the editor opened, so this only resets on open.
  useEffect(() => {
    if (venue && isOpen) {
      setSaveError(null);
      setPriceRows(toPriceRows(venue.beerPrices));
      setAttributes(attributesOf(venue));
      setHasHappyHour(venue.hasHappyHour);
      setHappyHourDetails(venue.happyHourDetails ?? "");
    }
  }, [venue, isOpen]);

  const beerPrices = priceRowsToPrices(priceRows);
  const hoursValid = openingHoursValid(attributes.openingHours);
  const canSave = beerPrices.length > 0 && hoursValid && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venue || !canSave) return;
    setSaving(true);
    setSaveError(null);
    const changes = diffVenueAttributes(attributesOf(venue), attributes);
    try {
      await onSubmit({
        venue: {
          ...venue,
          ...attributes,
          beerPrices,
          hasHappyHour,
          happyHourDetails: hasHappyHour ? happyHourDetails.trim() || undefined : undefined,
          pricesUnverified: true,
        },
        attributes: changes,
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
        role="dialog"
        aria-modal="true"
        aria-label={`Editar preços – ${venue.name}`}
        className="app-scrollbar bg-stone-800 border border-stone-600 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-stone-600 flex items-center justify-between sticky top-0 bg-stone-800 z-10">
          <h2 className="text-lg font-semibold text-amber-400">
            {venue.beerPrices.length === 0 ? "Adicionar preços" : "Editar preços"} – {venue.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1 rounded text-stone-400 hover:text-stone-200"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <fieldset>
            <legend className="block text-sm font-medium text-stone-400 mb-2">
              Preços de cerveja * (ao menos um)
            </legend>
            <PriceRowsEditor rows={priceRows} onChange={setPriceRows} disabled={saving} />
          </fieldset>

          <VenueAttributesEditor value={attributes} onChange={setAttributes} />

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
              disabled={!canSave}
              className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-medium hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
