"use client";

import type { OpeningHours, VenueAttributes } from "@/types";
import { WEEKDAYS, WEEKDAY_LABELS } from "@/lib/opening-hours";

const BOOLEAN_FIELDS: { key: "transmitsFootball" | "acceptsReservations" | "hasOutdoorArea"; label: string }[] = [
  { key: "transmitsFootball", label: "Transmite futebol" },
  { key: "acceptsReservations", label: "Aceita reserva" },
  { key: "hasOutdoorArea", label: "Área externa / terraço" },
];

const SELECT_CLASS = "mt-1 w-full rounded-lg border border-stone-700 bg-stone-900 p-2 text-sm text-stone-100";
const TIME_CLASS = "rounded-lg border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-100 disabled:opacity-40";

/** Starting point when the user turns hours on: every day 18:00–00:00, to be adjusted. */
function defaultHours(): OpeningHours {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: "18:00", close: "00:00" }]])) as OpeningHours;
}

/** True when the hours have at least one open day (the API rejects an all-closed week). */
export function hasAnyOpenDay(hours: OpeningHours | undefined): boolean {
  return !!hours && WEEKDAYS.some((d) => (hours[d]?.length ?? 0) > 0);
}

interface VenueAttributesEditorProps {
  value: VenueAttributes;
  onChange: (value: VenueAttributes) => void;
}

/**
 * Optional facts about the bar. Each one is "Sim", "Não" or "Não sei" (unknown); opening hours
 * are one interval per day in São Paulo time (closing at or before opening = after midnight).
 */
export function VenueAttributesEditor({ value, onChange }: VenueAttributesEditorProps) {
  const hours = value.openingHours;
  const setDay = (day: (typeof WEEKDAYS)[number], open: string | null, close?: string) => {
    const next: OpeningHours = { ...hours };
    if (open === null) delete next[day];
    else next[day] = [{ open, close: close ?? "00:00" }];
    onChange({ ...value, openingHours: next });
  };

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 block text-sm font-medium text-stone-300">Sobre o bar (opcional)</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {BOOLEAN_FIELDS.map(({ key, label }) => (
          <label key={key} className="text-sm text-stone-400">
            {label}
            <select
              className={SELECT_CLASS}
              value={value[key] === undefined ? "" : String(value[key])}
              onChange={(e) =>
                onChange({ ...value, [key]: e.target.value === "" ? undefined : e.target.value === "true" })
              }
            >
              <option value="">Não sei</option>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </label>
        ))}
      </div>

      <div className="rounded-lg border border-stone-700 bg-stone-900/40 p-3">
        <label className="flex items-center gap-2 text-sm text-stone-300">
          <input
            type="checkbox"
            checked={hours !== undefined}
            onChange={(e) => onChange({ ...value, openingHours: e.target.checked ? defaultHours() : undefined })}
            className="rounded border-stone-600 bg-stone-800 text-amber-500"
          />
          Informar horário de funcionamento
        </label>
        {hours !== undefined && (
          <div className="mt-3 space-y-2">
            {WEEKDAYS.map((day) => {
              const interval = hours[day]?.[0];
              return (
                <div key={day} className="flex flex-wrap items-center gap-2 text-sm text-stone-300">
                  <label className="flex w-28 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!interval}
                      onChange={(e) => setDay(day, e.target.checked ? "18:00" : null)}
                      className="rounded border-stone-600 bg-stone-800 text-amber-500"
                    />
                    {WEEKDAY_LABELS[day]}
                  </label>
                  {interval ? (
                    <>
                      <input
                        type="time"
                        value={interval.open}
                        onChange={(e) => e.target.value && setDay(day, e.target.value, interval.close)}
                        aria-label={`${WEEKDAY_LABELS[day]}: abre às`}
                        className={TIME_CLASS}
                      />
                      <span aria-hidden>–</span>
                      <input
                        type="time"
                        value={interval.close}
                        onChange={(e) => e.target.value && setDay(day, interval.open, e.target.value)}
                        aria-label={`${WEEKDAY_LABELS[day]}: fecha às`}
                        className={TIME_CLASS}
                      />
                      {interval.open === interval.close && (
                        <span className="text-xs text-red-300">Abertura e fechamento iguais</span>
                      )}
                    </>
                  ) : (
                    <span className="text-stone-500">Fechado</span>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-stone-500">
              Horário de Brasília; 18:00–02:00 fecha na madrugada seguinte.
            </p>
            {!hasAnyOpenDay(hours) && (
              <p className="text-xs text-red-300">Marque ao menos um dia aberto ou desmarque o horário.</p>
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** Whether the hours in the editor can be saved. */
export function openingHoursValid(hours: OpeningHours | undefined): boolean {
  if (hours === undefined) return true;
  return (
    hasAnyOpenDay(hours) &&
    WEEKDAYS.every((d) => (hours[d] ?? []).every((i) => i.open !== i.close))
  );
}
