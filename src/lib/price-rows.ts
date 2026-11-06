/**
 * Editable price rows shared by "Adicionar bar" and "Editar preços".
 * Free of React imports so it can be tested with `node --test`.
 */

import type { BeerPrice, BeerType } from "../types";
import { MAX_BEER_PRICES } from "./price-validation";
import { BEER_TYPE_LABELS } from "./venue-state";

export type PriceRow = { type: BeerType; label: string; priceBRL: number; volumeMl?: number };

export const emptyPriceRow = (): PriceRow => ({ type: "chope", label: "", priceBRL: 0 });

/** Rows for the editor (one empty row when there is no price yet); keeps the volume. */
export function toPriceRows(prices: BeerPrice[]): PriceRow[] {
  if (prices.length === 0) return [emptyPriceRow()];
  return prices.map((p) => ({
    type: p.type,
    label: p.label,
    priceBRL: p.priceBRL,
    ...(p.volumeMl != null ? { volumeMl: p.volumeMl } : {}),
  }));
}

/** Rows with a price, as prices to save (blank brand falls back to the type's name). */
export function priceRowsToPrices(rows: PriceRow[]): BeerPrice[] {
  return rows
    .filter((row) => row.priceBRL > 0)
    .map((row) => ({
      type: row.type,
      label: row.label.trim() || BEER_TYPE_LABELS[row.type],
      priceBRL: row.priceBRL,
      ...(row.volumeMl != null && row.volumeMl > 0 ? { volumeMl: row.volumeMl } : {}),
    }));
}

const rowKey = (r: { type: string; label: string; priceBRL: number; volumeMl?: number }) =>
  `${r.type}|${r.label.trim().toLowerCase()}|${r.priceBRL.toFixed(2)}|${r.volumeMl ?? ""}`;

/**
 * Adds prices read from a menu photo to the form: blank rows (no price, no brand) are dropped,
 * existing rows are kept as typed, identical prices are not repeated and the list is capped at
 * MAX_BEER_PRICES. Always leaves at least one row.
 */
export function mergeImportedPrices(rows: PriceRow[], imported: BeerPrice[]): PriceRow[] {
  const kept = rows.filter((r) => r.priceBRL > 0 || r.label.trim() !== "");
  const seen = new Set(kept.map(rowKey));
  const added: PriceRow[] = [];
  for (const p of imported) {
    const row: PriceRow = toPriceRows([p])[0];
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(row);
  }
  const merged = [...kept, ...added].slice(0, MAX_BEER_PRICES);
  return merged.length > 0 ? merged : [emptyPriceRow()];
}
