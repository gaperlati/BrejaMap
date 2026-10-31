/**
 * "Atualizado há X dias": how long ago a price was entered or confirmed in BrejaMap
 * (beer_prices.updated_at). Prices from before migration 005 carry the date they were added to
 * BrejaMap, which is not necessarily when the price was observed at the bar.
 * Free of React imports so it can be tested with `node --test`.
 */

import type { BeerPrice } from "../types";

const DAY_MS = 86_400_000;
/** Prices older than this are highlighted and invite a confirmation. */
export const STALE_PRICE_DAYS = 30;

/** Whole days since `updatedAt` (never negative), or null when the date is missing/invalid. */
export function daysSince(updatedAt: string | undefined, now: number = Date.now()): number | null {
  const timestamp = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS));
}

/** "Atualizado hoje", "Atualizado há 1 dia", "Atualizado há 12 dias", "Atualizado há 3 meses". */
export function freshnessLabel(updatedAt: string | undefined, now: number = Date.now()): string {
  const days = daysSince(updatedAt, now);
  if (days === null) return "Data de atualização desconhecida";
  if (days === 0) return "Atualizado hoje";
  if (days < 60) return `Atualizado há ${days} dia${days === 1 ? "" : "s"}`;
  return `Atualizado há ${Math.floor(days / 30)} meses`;
}

export function isPriceStale(updatedAt: string | undefined, now: number = Date.now()): boolean {
  const days = daysSince(updatedAt, now);
  return days !== null && days >= STALE_PRICE_DAYS;
}

/** Label of the most recent price update of a venue (list cards), or null without dates. */
export function venueFreshnessLabel(prices: BeerPrice[], now: number = Date.now()): string | null {
  const latest = prices
    .map((p) => (p.updatedAt ? Date.parse(p.updatedAt) : NaN))
    .filter(Number.isFinite)
    .reduce((max, t) => Math.max(max, t), -Infinity);
  return Number.isFinite(latest) ? freshnessLabel(new Date(latest).toISOString(), now) : null;
}
