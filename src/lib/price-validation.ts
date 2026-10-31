/**
 * Validation of beer prices coming from clients or from the menu-photo extraction.
 * Free of Next.js imports so it can be tested with `node --test`.
 */

import type { BeerPrice, BeerType } from "../types";

export const ALLOWED_BEER_TYPES: BeerType[] = ["chope", "long_neck", "lata", "garrafa", "outro"];
export const MAX_BEER_PRICES = 20;
export const MAX_PRICE_LABEL_LEN = 60;
/** No beer in a bar costs more than this; anything above is a typo or abuse. */
export const MAX_PRICE_BRL = 500;
export const MAX_VOLUME_ML = 5000;

/** Keeps only well-formed prices; returns [] when nothing valid was sent. */
export function sanitizeBeerPrices(input: unknown): BeerPrice[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_BEER_PRICES).flatMap((p): BeerPrice[] => {
    if (!p || typeof p !== "object") return [];
    const raw = p as Record<string, unknown>;
    const type = raw.type as BeerType;
    if (!ALLOWED_BEER_TYPES.includes(type)) return [];
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const priceBRL = Number(raw.priceBRL);
    const volumeMl = raw.volumeMl == null ? undefined : Number(raw.volumeMl);

    if (label.length < 1 || label.length > MAX_PRICE_LABEL_LEN) return [];
    if (!Number.isFinite(priceBRL) || priceBRL <= 0 || priceBRL > MAX_PRICE_BRL) return [];
    if (volumeMl != null && (!Number.isInteger(volumeMl) || volumeMl <= 0 || volumeMl > MAX_VOLUME_ML)) {
      return [];
    }
    return [{ type, label, priceBRL: Math.round(priceBRL * 100) / 100, ...(volumeMl != null ? { volumeMl } : {}) }];
  });
}
