/**
 * Favorites and ratings handlers. Every query is scoped to the user id from the verified Bearer
 * token (never to an id sent by the client): the tables have RLS without policies, so this
 * scoping is what isolates one user's data from another's.
 */

import { isUuid } from "../ids";
import { rowToVenue, type BeerPriceRow, type VenueRow } from "../venue-rows";
import { fetchRatingSummaries } from "../venue-ratings";
import { favoriteRateLimitChecks, rateLimitSalt, ratingRateLimitChecks, type AuthUser } from "../write-guards";
import {
  authRequired,
  json,
  notConfigured,
  rateLimited,
  readJsonObject,
  requestUser,
  writesBlocked,
  type HandlerDeps,
} from "./common";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_FAVORITES_LISTED = 200;

/** Configured db + verified user (and a valid venue id when given), or an error response. */
async function guard(
  deps: HandlerDeps,
  request: Request,
  venueId?: string
): Promise<{ db: SupabaseClient; user: AuthUser } | Response> {
  if (venueId !== undefined && !isUuid(venueId)) return json({ error: "Invalid venue id" }, 400);
  if (!deps.db) return notConfigured();
  const user = await requestUser(deps.db, request);
  if (!user) return authRequired();
  return { db: deps.db, user };
}

const isFkViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23503";

/** GET /api/favorites - The signed-in user's favorite venues (newest first), with prices. */
export async function listFavorites(deps: HandlerDeps, request: Request): Promise<Response> {
  const g = await guard(deps, request);
  if (g instanceof Response) return g;

  const { data, error } = await g.db
    .from("favorites")
    .select("venue_id, created_at, venues(*, beer_prices(*))")
    .eq("user_id", g.user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_FAVORITES_LISTED);
  if (error) {
    console.error("Supabase favorites error:", error);
    return json({ error: "Failed to load favorites" }, 500);
  }
  type Row = { venues: (VenueRow & { beer_prices: BeerPriceRow[] | null }) | null };
  const venues = ((data ?? []) as unknown as Row[]).flatMap((row) =>
    row.venues ? [rowToVenue(row.venues, row.venues.beer_prices ?? [])] : []
  );
  return json({ venues });
}

/** PUT (favorite = true) / DELETE /api/favorites/[venueId]; both idempotent. */
export async function setFavorite(
  deps: HandlerDeps,
  request: Request,
  venueId: string,
  favorite: boolean
): Promise<Response> {
  const g = await guard(deps, request, venueId);
  if (g instanceof Response) return g;
  const limited = await rateLimited(g.db, favoriteRateLimitChecks(g.user.id, rateLimitSalt(deps.env)));
  if (limited) return limited;

  const { error } = favorite
    ? await g.db
        .from("favorites")
        .upsert({ user_id: g.user.id, venue_id: venueId }, { onConflict: "user_id,venue_id", ignoreDuplicates: true })
    : await g.db.from("favorites").delete().eq("user_id", g.user.id).eq("venue_id", venueId);
  if (error) {
    if (isFkViolation(error)) return json({ error: "Venue not found" }, 404);
    console.error("Supabase favorite write error:", error);
    return json({ error: "Failed to save favorite" }, 500);
  }
  return json({ favorite });
}

/** `{ score, ratingAvg, ratingCount }` (score = this user's, or null). */
async function ratingBody(db: SupabaseClient, venueId: string, score: number | null): Promise<Response> {
  const summary = (await fetchRatingSummaries(db, [venueId])).get(venueId);
  return json({ score, ratingAvg: summary?.avg ?? null, ratingCount: summary?.count ?? 0 });
}

/** GET /api/venues/[id]/rating - The signed-in user's score for the venue (null if none). */
export async function getRating(deps: HandlerDeps, request: Request, venueId: string): Promise<Response> {
  const g = await guard(deps, request, venueId);
  if (g instanceof Response) return g;
  const { data, error } = await g.db
    .from("ratings")
    .select("score")
    .eq("user_id", g.user.id)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) {
    console.error("Supabase rating read error:", error);
    return json({ error: "Failed to load rating" }, 500);
  }
  return ratingBody(g.db, venueId, (data as { score: number } | null)?.score ?? null);
}

/** PUT /api/venues/[id]/rating { score: 1..5 } (or DELETE with score = null). */
export async function setRating(
  deps: HandlerDeps,
  request: Request,
  venueId: string,
  remove: boolean
): Promise<Response> {
  const blocked = writesBlocked(deps.env);
  if (blocked) return blocked;
  const g = await guard(deps, request, venueId);
  if (g instanceof Response) return g;

  let score: number | null = null;
  if (!remove) {
    const raw = (await readJsonObject(request))?.score;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 5) {
      return json({ error: "Invalid score" }, 400);
    }
    score = raw;
  }

  const limited = await rateLimited(g.db, ratingRateLimitChecks(g.user.id, rateLimitSalt(deps.env)));
  if (limited) return limited;

  const { error } =
    score === null
      ? await g.db.from("ratings").delete().eq("user_id", g.user.id).eq("venue_id", venueId)
      : await g.db
          .from("ratings")
          .upsert(
            { user_id: g.user.id, venue_id: venueId, score, updated_at: new Date().toISOString() },
            { onConflict: "user_id,venue_id" }
          );
  if (error) {
    if (isFkViolation(error)) return json({ error: "Venue not found" }, 404);
    console.error("Supabase rating write error:", error);
    return json({ error: "Failed to save rating" }, 500);
  }
  return ratingBody(g.db, venueId, score);
}
