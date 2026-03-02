/**
 * Fetch bars and pubs from Google Places API (New).
 * Uses the same API key as the map (Places API must be enabled in Google Cloud).
 */

import type { Venue } from "@/types";

const PLACES_SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Expand bounds by a factor (e.g. 1.25 = 25% overscan) so we fetch slightly outside the visible area. */
export function expandBounds(
  bounds: Bounds,
  factor: number = 1.25
): Bounds {
  const latCenter = (bounds.south + bounds.north) / 2;
  const lngCenter = (bounds.west + bounds.east) / 2;
  const halfLat = ((bounds.north - bounds.south) / 2) * factor;
  const halfLng = ((bounds.east - bounds.west) / 2) * factor;
  return {
    south: latCenter - halfLat,
    north: latCenter + halfLat,
    west: lngCenter - halfLng,
    east: lngCenter + halfLng,
  };
}

/** Compute center and radius (meters) from bounds for Places API circle. */
function boundsToCircle(bounds: Bounds): { latitude: number; longitude: number; radius: number } {
  const lat = (bounds.south + bounds.north) / 2;
  const lng = (bounds.west + bounds.east) / 2;
  const latSpan = (bounds.north - bounds.south) * 111320;
  const lngSpan = (bounds.east - bounds.west) * 111320 * Math.cos((lat * Math.PI) / 180);
  const radius = Math.min(50000, Math.max(500, (Math.max(latSpan, lngSpan) / 2) * 1.2));
  return { latitude: lat, longitude: lng, radius };
}

interface PlaceLocation {
  latitude?: number;
  longitude?: number;
}

interface PlaceDisplayName {
  text?: string;
}

interface GooglePlace {
  id?: string;
  displayName?: PlaceDisplayName;
  formattedAddress?: string;
  location?: PlaceLocation;
}

interface SearchNearbyResponse {
  places?: GooglePlace[];
}

function placeToVenue(place: GooglePlace): Venue | null {
  const loc = place.location;
  if (loc?.latitude == null || loc?.longitude == null) return null;
  const name = place.displayName?.text ?? place.formattedAddress ?? "Bar";
  const address = place.formattedAddress ?? "Endereço não informado";
  return {
    id: `google-${(place.id ?? "").replace(/^places\//, "") || crypto.randomUUID()}`,
    name,
    address,
    neighborhood: "—",
    city: "—",
    state: "—",
    lat: loc.latitude,
    lng: loc.longitude,
    beerPrices: [],
    hasHappyHour: false,
    createdAt: new Date().toISOString(),
    fromGoogle: true,
  };
}

/**
 * Fetch bars and pubs in the given bounds using Google Places API (New).
 */
export async function fetchBarsFromGoogle(bounds: Bounds, apiKey: string): Promise<Venue[]> {
  const { latitude, longitude, radius } = boundsToCircle(bounds);

  const body = {
    includedTypes: ["bar", "pub"],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude, longitude },
        radius,
      },
    },
    languageCode: "pt-BR",
  };

  const res = await fetch(PLACES_SEARCH_NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) {
      throw new Error("Muitas buscas no momento. Aguarde alguns segundos e tente de novo.");
    }
    if (res.status === 403) {
      throw new Error("Ative a Places API no Google Cloud para este projeto.");
    }
    throw new Error(err || `Places API error: ${res.status}`);
  }

  const data: SearchNearbyResponse = await res.json();
  const venues: Venue[] = [];
  for (const place of data.places ?? []) {
    const venue = placeToVenue(place);
    if (venue) venues.push(venue);
  }
  return venues;
}
