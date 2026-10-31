/**
 * Optional venue attributes (football, reservations, outdoor area, opening hours): request
 * validation and the mapping to the `p_attributes` argument of the write functions in
 * supabase/migrations/005_price_freshness_and_venue_tags.sql.
 *
 * Contract: an absent key leaves the stored value unchanged, null clears it (back to unknown).
 * Free of Next.js imports so it can be tested with `node --test`.
 */

import type { VenueAttributes, VenueAttributesPatch } from "../types";
import { parseOpeningHours } from "./opening-hours";

export const BOOLEAN_ATTRIBUTES = ["transmitsFootball", "acceptsReservations", "hasOutdoorArea"] as const;

const COLUMN: Record<keyof VenueAttributes, string> = {
  transmitsFootball: "transmits_football",
  acceptsReservations: "accepts_reservations",
  hasOutdoorArea: "has_outdoor_area",
  openingHours: "opening_hours",
};

export type AttributesParse = { ok: true; patch: VenueAttributesPatch } | { ok: false; field: string };

/** Reads the attribute keys of a JSON body (absent = unchanged, null = clear). */
export function parseVenueAttributesPatch(body: Record<string, unknown>): AttributesParse {
  const patch: VenueAttributesPatch = {};
  for (const field of BOOLEAN_ATTRIBUTES) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "boolean") return { ok: false, field };
    patch[field] = value;
  }
  if (body.openingHours !== undefined) {
    const hours = parseOpeningHours(body.openingHours);
    if (!hours.ok) return { ok: false, field: "openingHours" };
    patch.openingHours = hours.value;
  }
  return { ok: true, patch };
}

/** `p_attributes` for the write functions: only the keys present in the patch. */
export function toRpcAttributes(patch: VenueAttributesPatch | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!patch) return out;
  for (const key of Object.keys(COLUMN) as (keyof VenueAttributes)[]) {
    if (patch[key] !== undefined) out[COLUMN[key]] = patch[key];
  }
  return out;
}

/**
 * The patch an editor should send: only attributes the user changed from `initial`
 * (so an untouched field never overwrites someone else's newer answer).
 */
export function diffVenueAttributes(initial: VenueAttributes, edited: VenueAttributes): VenueAttributesPatch {
  const patch: VenueAttributesPatch = {};
  for (const field of BOOLEAN_ATTRIBUTES) {
    if (initial[field] !== edited[field]) patch[field] = edited[field] ?? null;
  }
  if (JSON.stringify(initial.openingHours ?? null) !== JSON.stringify(edited.openingHours ?? null)) {
    patch.openingHours = edited.openingHours ?? null;
  }
  return patch;
}

/** Applies a patch to a venue locally (null clears), e.g. when the backend is not configured. */
export function applyVenueAttributesPatch<T extends VenueAttributes>(venue: T, patch: VenueAttributesPatch): T {
  const next = { ...venue };
  for (const key of Object.keys(COLUMN) as (keyof VenueAttributes)[]) {
    if (!(key in patch) || patch[key] === undefined) continue;
    if (patch[key] === null) delete next[key];
    else (next as Record<string, unknown>)[key] = patch[key];
  }
  return next;
}
