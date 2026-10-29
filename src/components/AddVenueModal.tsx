"use client";

import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Venue, BeerType, BeerPrice } from "@/types";
import { SAO_CARLOS_CENTER } from "@/data/venues";
import { getAccessToken, getSupabaseBrowser } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/use-auth-user";
import { useVenueLocation } from "@/lib/use-venue-location";
import {
  LOW_ACCURACY_M,
  canConfirmLocation,
  hasEditedAddressDiverged,
  isLocationReadyToSave,
  isPinInsideServiceArea,
  locationPreviewSubtitle,
  locationPreviewTitle,
  pickerZoom,
  pinSourceLabel,
  venueLocationPayload,
  type AddressField,
} from "@/lib/venue-location";
import { LoginCard } from "@/components/LoginCard";
import { VenueLocationSearch } from "@/components/VenueLocationSearch";
import type { PickerMapStatus } from "@/components/VenueLocationMap";

const VenueLocationMap = dynamic(
  () => import("@/components/VenueLocationMap").then((m) => m.VenueLocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-stone-900 text-sm text-stone-500">
        Carregando mapa...
      </div>
    ),
  }
);

const BEER_TYPES: { value: BeerType; label: string }[] = [
  { value: "chope", label: "Chope" },
  { value: "long_neck", label: "Long neck" },
  { value: "lata", label: "Lata" },
  { value: "garrafa", label: "Garrafa" },
  { value: "outro", label: "Outro" },
];

type PriceRow = { type: BeerType; label: string; priceBRL: number };

const initialPriceRow = (): PriceRow => ({ type: "chope", label: "", priceBRL: 0 });

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50";

interface AddVenueModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Rejects with a user-facing message when saving fails. `accessToken` is the signed-in
   * user's token (creating a bar requires login), or null when login isn't available.
   */
  onSubmit: (venue: Omit<Venue, "id" | "createdAt">, accessToken: string | null) => Promise<void>;
  /** Main map center/zoom when the modal opened: where the location pin starts. */
  initialLat?: number;
  initialLng?: number;
  initialZoom?: number;
}

/** Mounted only while open, so closing (or saving) always starts the next bar from scratch. */
export function AddVenueModal(props: AddVenueModalProps) {
  if (!props.isOpen) return null;
  return <AddVenueDialog {...props} />;
}

function AddVenueDialog({
  onClose,
  onSubmit,
  initialLat = SAO_CARLOS_CENTER.lat,
  initialLng = SAO_CARLOS_CENTER.lng,
  initialZoom,
}: AddVenueModalProps) {
  const [name, setName] = useState("");
  const [hasHappyHour, setHasHappyHour] = useState(false);
  const [happyHourDetails, setHappyHourDetails] = useState("");
  const [priceRows, setPriceRows] = useState<PriceRow[]>([initialPriceRow()]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState<PickerMapStatus>("loading");
  const [startCenter] = useState(() => ({ lat: initialLat, lng: initialLng }));
  const [startZoom] = useState(() => pickerZoom(initialZoom));
  const auth = useAuthUser();
  /** Login is configured and nobody is signed in: show the login card instead of the form. */
  const needsLogin = auth.configured && !auth.user;
  const location = useVenueLocation(startCenter);
  const loc = location.state;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Backdrop closes only when the press also started on it (not a map drag released outside). */
  const pressStartedOnBackdropRef = useRef(false);

  // Escape closes; focus moves into the dialog for keyboard and screen-reader users.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const mapAvailable = mapStatus === "ready";
  const insideServiceArea = isPinInsideServiceArea(loc);
  const confirmable = canConfirmLocation(loc, mapAvailable);
  const lookingUpAddress = loc.geocodeStatus === "pending";

  /** First reason "Salvar bar" is disabled, shown under the button. */
  const saveBlocker =
    name.trim().length < 2
      ? "Informe o nome do bar."
      : !loc.confirmed
        ? "Confirme o local do bar no mapa."
        : !isLocationReadyToSave(loc)
          ? "Aguarde o endereço do local..."
          : validBeerPrices().length === 0
            ? "Adicione ao menos um preço."
            : null;
  const canSubmit = !saveBlocker && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || needsLogin) return;
    setSaving(true);
    setSaveError(null);
    try {
      const accessToken = await getAccessToken();
      // On success the parent closes (unmounts) the dialog, which resets the form.
      await onSubmit({
        name: name.trim(),
        ...venueLocationPayload(loc),
        beerPrices: validBeerPrices(),
        hasHappyHour,
        happyHourDetails: hasHappyHour ? happyHourDetails.trim() : undefined,
      }, accessToken);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar. Tente novamente.");
      setSaving(false);
    }
  };

  const editField = (field: AddressField, value: string) =>
    location.dispatch({ type: "editField", field, value });

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      onPointerDown={(e) => {
        pressStartedOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdropRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[100dvh] w-full max-w-lg flex-col rounded-t-xl border border-stone-600 bg-stone-800 shadow-2xl focus:outline-none sm:max-h-[90vh] sm:rounded-xl"
      >
        <div className="flex flex-none items-center justify-between border-b border-stone-600 p-4">
          <h2 id={titleId} className="text-lg font-semibold text-amber-400">
            Adicionar bar
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-stone-400 hover:text-stone-200"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {auth.loading ? (
          <p className="p-4 text-sm text-stone-400">Carregando...</p>
        ) : needsLogin ? (
          <div className="overflow-y-auto p-4">
            <LoginCard />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
              {auth.user && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-xs text-stone-400">
                  <span className="min-w-0 truncate">
                    Conectado como <span className="text-stone-200">{auth.user.email ?? "usuário"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => getSupabaseBrowser()?.auth.signOut()}
                    className="shrink-0 text-amber-400 hover:text-amber-300"
                  >
                    Sair
                  </button>
                </div>
              )}

              <div>
                <label htmlFor={`${titleId}-name`} className="block text-sm font-medium text-stone-300 mb-1">
                  Nome do bar *
                </label>
                <input
                  id={`${titleId}-name`}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="Ex: Bar do Zé"
                  className={INPUT_CLASS}
                />
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-stone-300">Onde fica o bar? *</legend>
                <p className="text-xs text-stone-400">
                  Arraste o mapa até o pino ficar em cima do bar (ou toque no local) e confirme.
                </p>

                <button
                  type="button"
                  onClick={location.locateDevice}
                  disabled={location.locating}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-sm text-stone-100 hover:bg-stone-700 disabled:opacity-60"
                >
                  <span aria-hidden>📍</span>
                  {location.locating ? "Buscando sua localização..." : "Usar minha localização"}
                </button>
                {location.deviceError && (
                  <p role="alert" className="text-xs text-amber-300">
                    {location.deviceError}
                  </p>
                )}

                <VenueLocationSearch near={loc.pin} onSelect={location.selectSearchResult} />

                <div
                  role="group"
                  aria-label="Mapa para posicionar o bar. Arraste o mapa (ou use as setas do teclado) para mover o local sob o pino."
                  className="relative h-56 overflow-hidden rounded-lg border border-stone-700 sm:h-64"
                >
                  <VenueLocationMap
                    initialCenter={startCenter}
                    initialZoom={startZoom}
                    focus={location.focus}
                    onMoveStart={location.handleMapMoveStart}
                    onIdle={location.handleMapIdle}
                    onStatusChange={setMapStatus}
                  />
                </div>

                <div
                  className={`rounded-lg border p-3 ${
                    loc.confirmed ? "border-emerald-700 bg-emerald-950/30" : "border-stone-700 bg-stone-900/60"
                  }`}
                >
                  <div aria-live="polite">
                    <p className="text-xs text-stone-500">{pinSourceLabel(loc.source, loc.accuracyM)}</p>
                    <p className="mt-0.5 text-sm font-medium text-stone-100 [overflow-wrap:anywhere]">
                      {lookingUpAddress && !loc.fields.address ? "Buscando endereço..." : locationPreviewTitle(loc.fields)}
                    </p>
                    {locationPreviewSubtitle(loc.fields) && (
                      <p className="text-xs text-stone-400 [overflow-wrap:anywhere]">
                        {locationPreviewSubtitle(loc.fields)}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[11px] text-stone-500">
                      {loc.pin.lat.toFixed(6)}, {loc.pin.lng.toFixed(6)}
                    </p>
                    {loc.geocodeStatus === "error" && (
                      <p className="mt-1 text-xs text-amber-300">
                        Não conseguimos identificar o endereço deste ponto. O local vale mesmo assim; se quiser, preencha abaixo.{" "}
                        <button
                          type="button"
                          onClick={() => location.dispatch({ type: "retryGeocode" })}
                          className="text-amber-400 underline hover:text-amber-300"
                        >
                          Tentar de novo
                        </button>
                      </p>
                    )}
                    {loc.source === "device" && loc.accuracyM != null && loc.accuracyM > LOW_ACCURACY_M && (
                      <p className="mt-1 text-xs text-amber-300">
                        A localização do aparelho está imprecisa. Confira se o pino está no bar.
                      </p>
                    )}
                    {!insideServiceArea && (
                      <p className="mt-1 text-xs text-red-300">
                        Este ponto fica fora do estado de SP. Por enquanto só aceitamos bares em SP.
                      </p>
                    )}
                    {!mapAvailable && loc.source === "initial" && insideServiceArea && (
                      <p className="mt-1 text-xs text-stone-400">
                        Sem o mapa, use sua localização ou busque o endereço para escolher o local.
                      </p>
                    )}
                  </div>

                  {loc.confirmed ? (
                    <p className="mt-2 flex items-center gap-1 text-sm text-emerald-300">
                      <span aria-hidden>✓</span> Local confirmado. Mexeu no mapa? Confirme de novo.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => location.dispatch({ type: "confirm" })}
                      disabled={!confirmable}
                      className="mt-3 w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Confirmar local
                    </button>
                  )}
                </div>

                <details className="group rounded-lg border border-stone-700 bg-stone-900/40">
                  <summary className="cursor-pointer list-none px-3 py-2 text-sm text-stone-300 hover:text-stone-100">
                    <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>
                      ▸
                    </span>
                    Corrigir endereço (opcional)
                  </summary>
                  <div className="space-y-3 px-3 pb-3">
                    <p className="text-xs text-stone-500">
                      Preenchido a partir do pino. Ex.: inclua o número. O que você digitar aqui é mantido se mover o pino.
                    </p>
                    <div>
                      <label htmlFor={`${titleId}-address`} className="block text-xs font-medium text-stone-400 mb-1">
                        Endereço
                      </label>
                      <input
                        id={`${titleId}-address`}
                        type="text"
                        value={loc.fields.address}
                        onChange={(e) => editField("address", e.target.value)}
                        placeholder="Rua e número"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`${titleId}-neighborhood`} className="block text-xs font-medium text-stone-400 mb-1">
                          Bairro
                        </label>
                        <input
                          id={`${titleId}-neighborhood`}
                          type="text"
                          value={loc.fields.neighborhood}
                          onChange={(e) => editField("neighborhood", e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label htmlFor={`${titleId}-city`} className="block text-xs font-medium text-stone-400 mb-1">
                          Cidade
                        </label>
                        <input
                          id={`${titleId}-city`}
                          type="text"
                          value={loc.fields.city}
                          onChange={(e) => editField("city", e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>
                    {hasEditedAddressDiverged(loc) && (
                      <button
                        type="button"
                        onClick={() => location.dispatch({ type: "useDetectedAddress" })}
                        className="text-xs text-amber-400 hover:text-amber-300"
                      >
                        Usar o endereço do pino
                      </button>
                    )}
                  </div>
                </details>
              </fieldset>

              <fieldset>
                <legend className="block text-sm font-medium text-stone-300 mb-1">
                  Preços de cerveja * (adicione ao menos um)
                </legend>
                <p className="text-xs text-stone-500 mb-3">
                  Tipo, marca (ex: Brahma, Heineken) e preço. Use &quot;Adicionar cerveja&quot; para mais opções.
                </p>
                <div className="space-y-3">
                  {priceRows.map((row, index) => (
                    <div
                      key={`price-${index}`}
                      className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_6.5rem_auto]"
                    >
                      <select
                        value={row.type}
                        onChange={(e) =>
                          updatePriceRow(index, { type: e.target.value as BeerType })
                        }
                        aria-label={`Tipo da cerveja ${index + 1}`}
                        className="px-2 py-2 rounded-lg bg-stone-900 border border-stone-700 text-stone-100 text-sm"
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
                        aria-label={`Marca da cerveja ${index + 1}`}
                        className="order-last col-span-3 px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 text-stone-100 text-sm placeholder-stone-500 sm:order-none sm:col-span-1"
                      />
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-stone-500" aria-hidden>
                          R$
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.01}
                          value={row.priceBRL || ""}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            updatePriceRow(index, {
                              priceBRL: !Number.isNaN(v) && v >= 0 ? v : 0,
                            });
                          }}
                          placeholder="0,00"
                          aria-label={`Preço da cerveja ${index + 1} em reais`}
                          className="w-full pl-8 pr-2 py-2 rounded-lg bg-stone-900 border border-stone-700 text-stone-100 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removePriceRow(index)}
                        disabled={priceRows.length <= 1}
                        className="p-2 rounded text-stone-500 hover:text-stone-300 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label={`Remover cerveja ${index + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addPriceRow}
                  className="mt-3 text-sm text-amber-400 hover:text-amber-300"
                >
                  + Adicionar cerveja
                </button>
              </fieldset>

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
                  <label htmlFor={`${titleId}-hh`} className="block text-sm font-medium text-stone-400 mb-1">
                    Detalhes do happy hour
                  </label>
                  <input
                    id={`${titleId}-hh`}
                    type="text"
                    value={happyHourDetails}
                    onChange={(e) => setHappyHourDetails(e.target.value)}
                    placeholder="Ex: Seg–Sex 17h–20h: chope R$ 6"
                    className={INPUT_CLASS}
                  />
                </div>
              )}

              {saveError && (
                <p role="alert" className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
                  {saveError}
                </p>
              )}
            </div>

            <div className="flex-none border-t border-stone-600 bg-stone-800 p-4 safe-area-pb sm:rounded-b-xl">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="flex-1 px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-medium hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Salvando..." : "Salvar bar"}
                </button>
              </div>
              {saveBlocker && !saving && (
                <p className="mt-2 text-xs text-stone-400" aria-live="polite">
                  {saveBlocker}
                </p>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
