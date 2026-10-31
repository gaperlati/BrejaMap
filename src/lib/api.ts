/**
 * Client-side API: fetch venues in bounds from our backend (no Google Places on the client).
 */

import type { Bounds } from "@/lib/geo";
import type { BeerPrice, Venue, VenueAttributesPatch } from "@/types";

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

/** Price as sent by the API (type is validated server-side but kept loose here). */
export type PriceFromAPI = Omit<BeerPrice, "type"> & { type: string };

export type VenueFromAPI = Omit<Venue, "beerPrices"> & { beerPrices: PriceFromAPI[] };

type PriceInput = { type: string; label: string; priceBRL: number; volumeMl?: number };

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
  beerPrices: PriceInput[];
  hasHappyHour?: boolean;
  happyHourDetails?: string;
} & VenueAttributesPatch, accessToken?: string | null): Promise<VenueFromAPI> {
  const res = await fetch("/api/venues", {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(venue),
  });
  const body = await throwIfNotOk(res);
  return body.venue as VenueFromAPI;
}

/**
 * PATCH /api/venues/[id] - Update venue (prices, happy hour, attributes). Returns updated venue.
 * Attribute keys left out stay unchanged; null clears them.
 * Login is optional; when an access token is given the edit is attributed to that user.
 */
export async function updateVenuePrices(
  id: string,
  data: {
    beerPrices: PriceInput[];
    hasHappyHour?: boolean;
    happyHourDetails?: string;
  } & VenueAttributesPatch,
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

/** User-facing (pt-BR) message for a failed "Ainda é esse preço? Sim". */
export function confirmErrorMessage(e: unknown): string {
  const status = (e as ApiError)?.status;
  if (status === 404) return "Este preço mudou. Feche e abra o bar para ver a versão atual.";
  if (status === 429) return "Você já confirmou preços demais por agora. Tente mais tarde.";
  if (status === 403) return saveErrorMessage(e);
  return "Não foi possível confirmar. Verifique sua conexão e tente novamente.";
}

/** POST /api/venues/[id]/confirm - "Ainda é esse preço? Sim". Returns the updated venue. */
export async function confirmVenuePrice(venueId: string, priceId: string): Promise<VenueFromAPI> {
  const res = await fetch(`/api/venues/${encodeURIComponent(venueId)}/confirm`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ priceId }),
  });
  const body = await throwIfNotOk(res);
  return body.venue as VenueFromAPI;
}

/** User-facing (pt-BR) message for a failed menu photo reading. */
export function menuPhotoErrorMessage(e: unknown): string {
  const err = e as ApiError;
  if (err?.name === "AbortError") return "Leitura cancelada.";
  switch (err?.status) {
    case 401:
      return "Entre na sua conta para ler o cardápio por foto.";
    case 403:
      return "Ler cardápio por foto está temporariamente desativado.";
    case 413:
      return "A foto é grande demais. Tente uma foto menor.";
    case 415:
      return "Formato de imagem não suportado. Use JPG, PNG ou WebP.";
    case 429:
      return "Muitas leituras de cardápio por agora. Tente de novo mais tarde.";
    case 503:
      return "A leitura de cardápio por foto ainda não está disponível.";
    case 504:
      return "A leitura demorou demais. Tente uma foto mais nítida ou mais próxima.";
    default:
      return "Não foi possível ler o cardápio. Tente outra foto ou preencha à mão.";
  }
}

/** POST /api/menu-photo - Beer prices read from a menu photo (nothing is saved). */
export async function extractMenuPhotoPrices(
  image: Blob,
  accessToken: string | null,
  signal?: AbortSignal
): Promise<PriceFromAPI[]> {
  const res = await fetch("/api/menu-photo", {
    method: "POST",
    headers: {
      "Content-Type": image.type,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: image,
    signal,
  });
  const body = await throwIfNotOk(res);
  return (body.prices as PriceFromAPI[] | undefined) ?? [];
}

/** GET /api/favorites - The signed-in user's favorite venues. */
export async function fetchFavorites(accessToken: string): Promise<VenueFromAPI[]> {
  const res = await fetch("/api/favorites", { headers: jsonHeaders(accessToken) });
  const body = await throwIfNotOk(res);
  return (body.venues as VenueFromAPI[] | undefined) ?? [];
}

/** PUT/DELETE /api/favorites/[venueId]. */
export async function setFavorite(venueId: string, favorite: boolean, accessToken: string): Promise<void> {
  const res = await fetch(`/api/favorites/${encodeURIComponent(venueId)}`, {
    method: favorite ? "PUT" : "DELETE",
    headers: jsonHeaders(accessToken),
  });
  await throwIfNotOk(res);
}

export interface RatingState {
  /** The signed-in user's score, or null. */
  score: number | null;
  ratingAvg: number | null;
  ratingCount: number;
}

/** GET (score undefined), PUT (1..5) or DELETE (null) /api/venues/[id]/rating. */
export async function venueRating(
  venueId: string,
  accessToken: string,
  score?: number | null
): Promise<RatingState> {
  const res = await fetch(`/api/venues/${encodeURIComponent(venueId)}/rating`, {
    method: score === undefined ? "GET" : score === null ? "DELETE" : "PUT",
    headers: jsonHeaders(accessToken),
    ...(typeof score === "number" ? { body: JSON.stringify({ score }) } : {}),
  });
  const body = await throwIfNotOk(res);
  return {
    score: typeof body.score === "number" ? body.score : null,
    ratingAvg: typeof body.ratingAvg === "number" ? body.ratingAvg : null,
    ratingCount: typeof body.ratingCount === "number" ? body.ratingCount : 0,
  };
}

export type ReviewQueueVenue = VenueFromAPI & { lastEditedAt: string | null };

/** GET /api/admin/review-queue (403 unless the user is in ADMIN_EMAILS). */
export async function fetchReviewQueue(accessToken: string): Promise<ReviewQueueVenue[]> {
  const res = await fetch("/api/admin/review-queue", { headers: jsonHeaders(accessToken) });
  const body = await throwIfNotOk(res);
  return (body.venues as ReviewQueueVenue[] | undefined) ?? [];
}

/** POST /api/admin/venues/[id]/resolve. */
export async function resolveReview(
  venueId: string,
  action: "dismiss" | "verify",
  accessToken: string
): Promise<void> {
  const res = await fetch(`/api/admin/venues/${encodeURIComponent(venueId)}/resolve`, {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ action }),
  });
  await throwIfNotOk(res);
}
