/**
 * "Ainda é esse preço? Sim": POST /api/venues/[id]/confirm { priceId }. No login; rate-limited
 * per IP and per (IP, venue). 404 when the price no longer belongs to the venue (it was edited
 * meanwhile and got a new id), so a stale page never refreshes a price it did not show.
 */

import { isUuid } from "../ids";
import { fetchRatingSummaries, withRating } from "../venue-ratings";
import { runVenueWrite } from "../venue-writes";
import { clientIp, confirmRateLimitChecks, rateLimitSalt } from "../write-guards";
import { json, notConfigured, rateLimited, readJsonObject, writesBlocked, type HandlerDeps } from "./common";

export async function confirmPrice(deps: HandlerDeps, request: Request, venueId: string): Promise<Response> {
  const blocked = writesBlocked(deps.env);
  if (blocked) return blocked;

  const priceId = (await readJsonObject(request))?.priceId;
  if (!isUuid(venueId) || typeof priceId !== "string" || !isUuid(priceId)) {
    return json({ error: "Invalid venue or price id" }, 400);
  }
  if (!deps.db) return notConfigured();

  const limited = await rateLimited(
    deps.db,
    confirmRateLimitChecks(clientIp(request.headers), venueId, rateLimitSalt(deps.env))
  );
  if (limited) return limited;

  const result = await runVenueWrite(deps.db, "confirm_beer_price", { p_venue_id: venueId, p_price_id: priceId });
  if (!result.ok) {
    return result.reason === "not_found"
      ? json({ error: "Price not found" }, 404)
      : json({ error: "Failed to confirm price" }, 500);
  }
  const ratings = await fetchRatingSummaries(deps.db, [venueId]);
  return json({ venue: withRating(result.venue, ratings.get(venueId)) });
}
