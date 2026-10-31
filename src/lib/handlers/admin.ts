/**
 * Moderation handlers. Deny by default: only a confirmed e-mail listed in ADMIN_EMAILS
 * (server-only env) passes `isAdmin`; with ADMIN_EMAILS unset everyone gets 403.
 */

import { isUuid } from "../ids";
import { rowToVenue, type BeerPriceRow, type VenueRow } from "../venue-rows";
import { isAdmin } from "../write-guards";
import { forbidden, json, notConfigured, readJsonObject, requestUser, type HandlerDeps } from "./common";

export const MAX_REVIEW_QUEUE = 100;

/** GET /api/admin/review-queue - Venues flagged for review, most recently edited first. */
export async function getReviewQueue(deps: HandlerDeps, request: Request): Promise<Response> {
  if (!deps.db) return notConfigured();
  if (!isAdmin(await requestUser(deps.db, request), deps.env)) return forbidden();

  const { data, error } = await deps.db
    .from("venues")
    .select("*, beer_prices(*)")
    .eq("needs_review", true)
    .order("last_edited_at", { ascending: false, nullsFirst: false })
    .limit(MAX_REVIEW_QUEUE);
  if (error) {
    console.error("Supabase review queue error:", error);
    return json({ error: "Failed to load review queue" }, 500);
  }
  type Row = VenueRow & { beer_prices: BeerPriceRow[] | null };
  const venues = ((data ?? []) as unknown as Row[]).map((row) => ({
    ...rowToVenue(row, row.beer_prices ?? []),
    lastEditedAt: row.last_edited_at ?? null,
  }));
  return json({ venues });
}

/**
 * POST /api/admin/venues/[id]/resolve { action } - "dismiss" clears needs_review (prices stay
 * "não verificados"); "verify" also clears prices_unverified (a moderator checked the prices).
 */
export async function resolveReview(deps: HandlerDeps, request: Request, venueId: string): Promise<Response> {
  if (!deps.db) return notConfigured();
  if (!isAdmin(await requestUser(deps.db, request), deps.env)) return forbidden();
  if (!isUuid(venueId)) return json({ error: "Invalid venue id" }, 400);

  const action = (await readJsonObject(request))?.action;
  if (action !== "dismiss" && action !== "verify") return json({ error: "Invalid action" }, 400);

  const changes =
    action === "verify" ? { needs_review: false, prices_unverified: false } : { needs_review: false };
  const { data, error } = await deps.db.from("venues").update(changes).eq("id", venueId).select("id");
  if (error) {
    console.error("Supabase resolve review error:", error);
    return json({ error: "Failed to resolve" }, 500);
  }
  if (!data || data.length === 0) return json({ error: "Venue not found" }, 404);
  return json({ ok: true });
}
