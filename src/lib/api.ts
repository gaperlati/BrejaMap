/**
 * Client-side API: fetch venues in bounds from our backend (no Google Places on the client).
 */

import type { Bounds } from "@/lib/geo";

export type ApiError = Error & { status?: number };

/** User-facing (pt-BR) message for a failed create/update call. */
export function saveErrorMessage(e: unknown): string {
  const err = e as ApiError;
  if (err?.status === 403) {
    return "Adicionar e editar bares está temporariamente desativado. Volte em breve!";
  }
  if (err?.status === 400) {
    if (err.message?.includes("São Paulo state")) {
      return "Por enquanto só aceitamos bares no estado de São Paulo.";
    }
    return "Não foi possível salvar: verifique os dados e tente novamente.";
  }
  if (err?.status === 404) return "Este bar não existe mais.";
  return "Erro ao salvar. Verifique sua conexão e tente novamente.";
}

export interface VenueFromAPI {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  beerPrices: { type: string; label: string; priceBRL: number; volumeMl?: number }[];
  hasHappyHour: boolean;
  happyHourDetails?: string;
  photoUrl?: string;
  createdAt: string;
  userAdded?: boolean;
  fromOsm?: boolean;
  fromGoogle?: boolean;
}

export async function fetchVenuesInBounds(bounds: Bounds): Promise<VenueFromAPI[]> {
  const params = new URLSearchParams({
    bounds: [bounds.south, bounds.west, bounds.north, bounds.east].join(","),
  });
  const res = await fetch(`/api/venues?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body.error as string) || `API error: ${res.status}`) as ApiError;
    err.status = res.status;
    throw err;
  }
  return body.venues ?? [];
}

/** POST /api/venues - Create a new venue. Returns the created venue. */
export async function createVenue(venue: {
  name: string;
  address?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  lat: number;
  lng: number;
  beerPrices: { type: string; label: string; priceBRL: number; volumeMl?: number }[];
  hasHappyHour?: boolean;
  happyHourDetails?: string;
}): Promise<VenueFromAPI> {
  const res = await fetch("/api/venues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(venue),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body.error as string) || `API error: ${res.status}`) as ApiError;
    err.status = res.status;
    throw err;
  }
  return body.venue;
}

/** PATCH /api/venues/[id] - Update venue (prices, happy hour). Returns updated venue. */
export async function updateVenuePrices(
  id: string,
  data: {
    beerPrices: { type: string; label: string; priceBRL: number; volumeMl?: number }[];
    hasHappyHour?: boolean;
    happyHourDetails?: string;
  }
): Promise<VenueFromAPI> {
  const res = await fetch(`/api/venues/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body.error as string) || `API error: ${res.status}`) as ApiError;
    err.status = res.status;
    throw err;
  }
  return body.venue;
}
