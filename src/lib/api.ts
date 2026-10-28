/**
 * Client-side API: fetch venues in bounds from our backend (no Google Places on the client).
 */

import type { Bounds } from "@/lib/geo";

export type ApiError = Error & { status?: number };

/** User-facing (pt-BR) message for a failed create/update call. */
export function saveErrorMessage(e: unknown): string {
  const err = e as ApiError;
  if (err?.status === 401) return "Faça login para adicionar um novo bar.";
  if (err?.status === 403) {
    return "Adicionar e editar bares está temporariamente desativado. Volte em breve!";
  }
  if (err?.status === 429) {
    return "Muitas alterações em pouco tempo. Aguarde alguns minutos e tente novamente.";
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

/** User-facing (pt-BR) message for a failed "Sinalizar preços incorretos". */
export function reportErrorMessage(e: unknown): string {
  const status = (e as ApiError)?.status;
  if (status === 403 || status === 404 || status === 429) return saveErrorMessage(e);
  return "Não foi possível enviar. Verifique sua conexão e tente novamente.";
}

/** User-facing (pt-BR) message for a failed GET /api/venues (map loading). */
export function loadVenuesErrorMessage(e: unknown): string {
  const err = e as ApiError;
  if (err?.status === 503) {
    return "Backend não configurado. Configure Supabase para carregar bares do mapa.";
  }
  if (err?.status === 400 && err.message?.includes("too large")) {
    return "Área muito grande: aproxime o mapa para buscar bares.";
  }
  return "Não foi possível carregar os bares. Verifique sua conexão e tente novamente.";
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
  pricesUnverified?: boolean;
  fromOsm?: boolean;
  fromGoogle?: boolean;
}

function jsonHeaders(accessToken?: string | null): HeadersInit {
  return accessToken
    ? { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }
    : { "Content-Type": "application/json" };
}

async function throwIfNotOk(res: Response): Promise<Record<string, unknown>> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body.error as string) || `API error: ${res.status}`) as ApiError;
    err.status = res.status;
    throw err;
  }
  return body;
}

export interface VenuesInBounds {
  venues: VenueFromAPI[];
  /** The area holds more venues than the API returned (it caps each response). */
  truncated: boolean;
}

export async function fetchVenuesInBounds(bounds: Bounds): Promise<VenuesInBounds> {
  const params = new URLSearchParams({
    bounds: [bounds.south, bounds.west, bounds.north, bounds.east].join(","),
  });
  const res = await fetch(`/api/venues?${params}`);
  const body = await throwIfNotOk(res);
  return {
    venues: (body.venues as VenueFromAPI[] | undefined) ?? [],
    truncated: body.truncated === true,
  };
}

/**
 * POST /api/venues - Create a new venue. Returns the created venue.
 * Requires the signed-in user's access token (the API answers 401 without it).
 */
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
}, accessToken?: string | null): Promise<VenueFromAPI> {
  const res = await fetch("/api/venues", {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(venue),
  });
  const body = await throwIfNotOk(res);
  return body.venue as VenueFromAPI;
}

/**
 * PATCH /api/venues/[id] - Update venue (prices, happy hour). Returns updated venue.
 * Login is optional; when an access token is given the edit is attributed to that user.
 */
export async function updateVenuePrices(
  id: string,
  data: {
    beerPrices: { type: string; label: string; priceBRL: number; volumeMl?: number }[];
    hasHappyHour?: boolean;
    happyHourDetails?: string;
  },
  accessToken?: string | null
): Promise<VenueFromAPI> {
  const res = await fetch(`/api/venues/${id}`, {
    method: "PATCH",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  const body = await throwIfNotOk(res);
  return body.venue as VenueFromAPI;
}

/** POST /api/venues/[id]/report - Flags the venue's prices for review. */
export async function reportVenuePrices(id: string): Promise<void> {
  const res = await fetch(`/api/venues/${encodeURIComponent(id)}/report`, { method: "POST" });
  await throwIfNotOk(res);
}
