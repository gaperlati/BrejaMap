/**
 * Small geo helpers shared by the client (bounds overscan, distance sorting).
 */

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

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km (haversine). */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Generous bounding box around São Paulo state. Writes outside it are rejected:
 * the app only targets SP, and it blocks junk coordinates (0,0 etc.).
 */
export const SP_STATE_BOUNDS: Bounds = { south: -25.5, north: -19.5, west: -53.3, east: -44.0 };

export function isInsideSpState(lat: number, lng: number): boolean {
  return (
    lat >= SP_STATE_BOUNDS.south &&
    lat <= SP_STATE_BOUNDS.north &&
    lng >= SP_STATE_BOUNDS.west &&
    lng <= SP_STATE_BOUNDS.east
  );
}
