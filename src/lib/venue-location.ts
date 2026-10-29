/**
 * Location step of "Adicionar bar": where the pin is, how it got there, whether the user
 * confirmed it, and the address fields derived from it.
 *
 * Kept free of React/Next/browser imports so it can be tested with `node --test`.
 *
 * Rules:
 * - The pin starts at the main map's center, but a bar is never saved there silently:
 *   the user must confirm the point ("Confirmar local"), and any later move clears that.
 * - Address fields follow the pin. Moving it clears every field the user didn't type,
 *   so a failed or pending lookup never leaves the previous point's street/city behind.
 * - Each pin move bumps `revision`; a reverse-geocode answer for an older revision is
 *   ignored (stale request).
 */

import { isInsideSpState } from "./geo";
import type { PlaceDetails } from "./geocode";

export type LatLng = { lat: number; lng: number };

/** How the pin got to its current position. */
export type PinSource = "initial" | "map" | "search" | "device";

export type AddressField = keyof PlaceDetails;

export const ADDRESS_FIELDS: AddressField[] = ["address", "neighborhood", "city", "state"];

/** "pending": the address of the current pin is being looked up (or about to be). */
export type GeocodeStatus = "pending" | "done" | "error";

export interface VenueLocationState {
  pin: LatLng;
  source: PinSource;
  /** Device accuracy in meters when `source === "device"`. */
  accuracyM: number | null;
  confirmed: boolean;
  /** Bumped on every pin move; tags reverse-geocode requests. */
  revision: number;
  geocodeStatus: GeocodeStatus;
  /** Address found for the current pin (null until found, or when nothing was found). */
  details: PlaceDetails | null;
  /** Current address field values (auto-filled from `details` unless edited). */
  fields: PlaceDetails;
  /** Fields the user typed; pin moves and lookups leave them alone. */
  edited: Record<AddressField, boolean>;
}

export type VenueLocationAction =
  | { type: "pinMoved"; pin: LatLng; source: PinSource; accuracyM?: number | null; details?: PlaceDetails }
  | { type: "geocodeSucceeded"; revision: number; details: PlaceDetails | null }
  | { type: "geocodeFailed"; revision: number }
  | { type: "retryGeocode" }
  | { type: "confirm" }
  | { type: "unconfirm" }
  | { type: "editField"; field: AddressField; value: string }
  | { type: "useDetectedAddress" };

const EMPTY_FIELDS: PlaceDetails = { address: "", neighborhood: "", city: "", state: "" };
const NOT_EDITED: Record<AddressField, boolean> = {
  address: false,
  neighborhood: false,
  city: false,
  state: false,
};

/** Map moves smaller than this (≈ 1 m) are rounding noise, not a new point. */
const SAME_POINT_DEG = 1e-5;

export function samePoint(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < SAME_POINT_DEG && Math.abs(a.lng - b.lng) < SAME_POINT_DEG;
}

export function initialVenueLocation(center: LatLng): VenueLocationState {
  return {
    pin: center,
    source: "initial",
    accuracyM: null,
    confirmed: false,
    revision: 0,
    geocodeStatus: "pending",
    details: null,
    fields: { ...EMPTY_FIELDS },
    edited: { ...NOT_EDITED },
  };
}

/** Overwrites the fields the user didn't edit with `details` (or blanks when null). */
export function mergeAddressFields(
  fields: PlaceDetails,
  edited: Record<AddressField, boolean>,
  details: PlaceDetails | null
): PlaceDetails {
  const next = { ...fields };
  for (const f of ADDRESS_FIELDS) {
    if (!edited[f]) next[f] = details?.[f] ?? "";
  }
  return next;
}

export function venueLocationReducer(
  state: VenueLocationState,
  action: VenueLocationAction
): VenueLocationState {
  switch (action.type) {
    case "pinMoved": {
      // A search pick is an explicit "this is the address": it replaces typed fields too.
      const edited = action.source === "search" ? { ...NOT_EDITED } : state.edited;
      // The map reports its center after every programmatic pan too: same point, no-op.
      if (
        !action.details &&
        samePoint(action.pin, state.pin) &&
        (action.source === "map" || action.source === state.source)
      ) {
        return state;
      }
      const details = action.details ?? null;
      return {
        ...state,
        pin: action.pin,
        source: action.source,
        accuracyM: action.source === "device" ? action.accuracyM ?? null : null,
        confirmed: false,
        revision: state.revision + 1,
        geocodeStatus: action.details ? "done" : "pending",
        details,
        edited,
        fields: mergeAddressFields(state.fields, edited, details),
      };
    }
    case "geocodeSucceeded":
      if (action.revision !== state.revision) return state;
      return {
        ...state,
        geocodeStatus: "done",
        details: action.details,
        fields: mergeAddressFields(state.fields, state.edited, action.details),
      };
    case "geocodeFailed":
      if (action.revision !== state.revision) return state;
      return { ...state, geocodeStatus: "error", details: null };
    case "retryGeocode":
      return state.geocodeStatus === "error" ? { ...state, geocodeStatus: "pending" } : state;
    case "confirm":
      return canConfirmLocation(state) ? { ...state, confirmed: true } : state;
    case "unconfirm":
      return state.confirmed ? { ...state, confirmed: false } : state;
    case "editField":
      return {
        ...state,
        fields: { ...state.fields, [action.field]: action.value },
        edited: { ...state.edited, [action.field]: true },
      };
    case "useDetectedAddress":
      return {
        ...state,
        edited: { ...NOT_EDITED },
        fields: mergeAddressFields(state.fields, NOT_EDITED, state.details),
      };
  }
}

export function isPinInsideServiceArea(state: Pick<VenueLocationState, "pin">): boolean {
  return isInsideSpState(state.pin.lat, state.pin.lng);
}

/**
 * Whether "Confirmar local" is allowed. Without a map, the starting point is just the
 * main map's center and the user never saw it, so they must search or use their location.
 */
export function canConfirmLocation(
  state: Pick<VenueLocationState, "pin" | "source">,
  mapAvailable = true
): boolean {
  if (!isPinInsideServiceArea(state)) return false;
  return mapAvailable || state.source !== "initial";
}

/** Location part of "Salvar bar": confirmed, and the address lookup isn't in flight. */
export function isLocationReadyToSave(
  state: Pick<VenueLocationState, "confirmed" | "geocodeStatus" | "pin">
): boolean {
  return state.confirmed && state.geocodeStatus !== "pending" && isPinInsideServiceArea(state);
}

/** True when some typed field differs from what the lookup found for the current pin. */
export function hasEditedAddressDiverged(state: VenueLocationState): boolean {
  if (!state.details) return false;
  return ADDRESS_FIELDS.some(
    (f) => state.edited[f] && state.fields[f].trim() !== state.details![f].trim()
  );
}

/** Values sent to POST /api/venues (empty state falls back to "SP" like the server). */
export function venueLocationPayload(state: VenueLocationState): PlaceDetails & LatLng {
  return {
    lat: state.pin.lat,
    lng: state.pin.lng,
    address: state.fields.address.trim(),
    neighborhood: state.fields.neighborhood.trim(),
    city: state.fields.city.trim(),
    state: state.fields.state.trim() || "SP",
  };
}

/** Headline of the location preview: street, else neighborhood/city, else a neutral label. */
export function locationPreviewTitle(fields: PlaceDetails): string {
  return fields.address.trim() || fields.neighborhood.trim() || fields.city.trim() || "Endereço não identificado";
}

/** "Vila Prado · São Carlos - SP", skipping what the title already shows. */
export function locationPreviewSubtitle(fields: PlaceDetails): string {
  const title = locationPreviewTitle(fields);
  const city = fields.city.trim();
  const state = fields.state.trim();
  const cityLabel = city && state ? `${city} - ${state}` : city || state;
  return [fields.neighborhood.trim(), cityLabel]
    .filter((part) => part && part !== title)
    .join(" · ");
}

export function pinSourceLabel(source: PinSource, accuracyM: number | null): string {
  switch (source) {
    case "initial":
      return "Centro do mapa (ainda não ajustado)";
    case "map":
      return "Marcado no mapa";
    case "search":
      return "Resultado da busca";
    case "device":
      return accuracyM != null
        ? `Sua localização (precisão de ~${Math.round(accuracyM)} m)`
        : "Sua localização";
  }
}

/** Device fixes worse than this get an "adjust the pin" hint. */
export const LOW_ACCURACY_M = 100;

/** Zoom of the picker map: close enough to place the pin on the right building. */
export function pickerZoom(mainMapZoom: number | undefined): number {
  const z = Number.isFinite(mainMapZoom) ? (mainMapZoom as number) : 0;
  return Math.min(19, Math.max(17, Math.round(z)));
}

export type GeolocationErrorCode = "unsupported" | "insecure" | "denied" | "unavailable" | "timeout";

/** Maps a `GeolocationPositionError.code` (1, 2, 3) to our codes. */
export function geolocationErrorCode(code: number | undefined): GeolocationErrorCode {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

export function geolocationErrorMessage(code: GeolocationErrorCode): string {
  switch (code) {
    case "unsupported":
      return "Seu navegador não informa a localização. Ajuste o pino no mapa ou busque o endereço.";
    case "insecure":
      return "A localização só funciona em conexão segura (https). Ajuste o pino no mapa ou busque o endereço.";
    case "denied":
      return "Permissão de localização negada. Libere nas configurações do navegador ou ajuste o pino no mapa.";
    case "timeout":
      return "Demorou para achar sua localização. Tente de novo ou ajuste o pino no mapa.";
    case "unavailable":
      return "Não foi possível obter sua localização agora. Ajuste o pino no mapa ou busque o endereço.";
  }
}
