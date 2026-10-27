export interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
  };
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "BrejaMap/1.0 (map app; contact optional)";

export async function searchAddress(
  query: string
): Promise<NominatimResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query.trim(),
    format: "json",
    addressdetails: "1",
    limit: "6",
    // The app only covers Brazil; restricting results avoids picking a homonym abroad.
    countrycodes: "br",
    "accept-language": "pt-BR",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data as NominatimResult[];
}
