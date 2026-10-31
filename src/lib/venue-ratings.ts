/**
 * Community ratings (1–5): aggregate lookup through public.venue_rating_summaries
 * (supabase/migrations/005_price_freshness_and_venue_tags.sql) and display rules.
 * Free of Next.js imports so it can be tested with a fake client.
 */

import type { Venue } from "../types";
import type { RpcClient } from "./venue-writes";
import type { RatingSummary } from "./venue-rows";

/** Fewer ratings than this show "Poucas avaliações" instead of an average. */
export const MIN_RATINGS_TO_SHOW = 3;

/**
 * Rating average/count per venue id. Never throws: on any error (e.g. migration 005 not applied
 * yet) it logs and returns an empty map, so the map keeps loading without ratings.
 */
export async function fetchRatingSummaries(
  client: RpcClient,
  venueIds: string[]
): Promise<Map<string, RatingSummary>> {
  const out = new Map<string, RatingSummary>();
  if (venueIds.length === 0) return out;
  try {
    const { data, error } = await client.rpc("venue_rating_summaries", { p_venue_ids: venueIds });
    if (error || !Array.isArray(data)) {
      if (error) console.error("Supabase rpc venue_rating_summaries error:", error);
      return out;
    }
    for (const row of data as { venue_id?: unknown; rating_avg?: unknown; rating_count?: unknown }[]) {
      const avg = Number(row.rating_avg);
      const count = Number(row.rating_count);
      if (typeof row.venue_id === "string" && Number.isFinite(avg) && Number.isInteger(count) && count > 0) {
        out.set(row.venue_id, { avg, count });
      }
    }
  } catch (e) {
    console.error("Supabase rpc venue_rating_summaries threw:", e);
  }
  return out;
}

/** Copies a rating summary onto a venue (removes stale values when there is none). */
export function withRating(venue: Venue, summary: RatingSummary | undefined): Venue {
  const { ratingAvg: _avg, ratingCount: _count, ...rest } = venue;
  void _avg;
  void _count;
  return summary && summary.count > 0 ? { ...rest, ratingAvg: summary.avg, ratingCount: summary.count } : rest;
}

/** "★ 4,3 (12 avaliações)", "Poucas avaliações (2)" or "Sem avaliações". */
export function ratingLabel(venue: Pick<Venue, "ratingAvg" | "ratingCount">): string {
  const count = venue.ratingCount ?? 0;
  if (count === 0 || venue.ratingAvg == null) return "Sem avaliações";
  if (count < MIN_RATINGS_TO_SHOW) return `Poucas avaliações (${count})`;
  return `★ ${venue.ratingAvg.toFixed(1).replace(".", ",")} (${count} avaliações)`;
}

/** Sort key for "Melhor avaliação": venues under MIN_RATINGS_TO_SHOW go last. */
export function ratingSortValue(venue: Pick<Venue, "ratingAvg" | "ratingCount">): number {
  return (venue.ratingCount ?? 0) >= MIN_RATINGS_TO_SHOW && venue.ratingAvg != null ? venue.ratingAvg : -1;
}
