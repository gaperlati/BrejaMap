import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import {
  sanitizeBeerPrices,
  cleanString,
  isUuid,
  writesBlockedResponse,
  rateLimitedResponse,
  MAX_HAPPY_HOUR_DETAILS_LEN,
} from "@/lib/venue-server";
import { buildUpdateVenueArgs, runVenueWrite } from "@/lib/venue-writes";
import { parseVenueAttributesPatch } from "@/lib/venue-attributes";
import { fetchRatingSummaries, withRating } from "@/lib/venue-ratings";
import {
  authenticateRequest,
  clientIp,
  rateLimitSalt,
  updateRateLimitChecks,
} from "@/lib/write-guards";

/**
 * PATCH /api/venues/[id] - Update venue (beer prices, happy hour, attributes). Attribute keys
 * (transmitsFootball, acceptsReservations, hasOutdoorArea, openingHours) are optional: absent =
 * unchanged, null = back to unknown.
 * Login is optional: a valid Bearer token only records who edited. Rate-limited per IP and per
 * (IP, venue) (429); the venue's prices are marked unverified.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const blocked = writesBlockedResponse();
  if (blocked) return blocked;

  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "Invalid venue id" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.hasHappyHour !== undefined && typeof body.hasHappyHour !== "boolean") {
    return NextResponse.json({ error: "Invalid hasHappyHour" }, { status: 400 });
  }
  if (body.happyHourDetails != null && typeof body.happyHourDetails !== "string") {
    return NextResponse.json({ error: "Invalid happyHourDetails" }, { status: 400 });
  }

  const attributes = parseVenueAttributesPatch(body);
  if (!attributes.ok) {
    return NextResponse.json({ error: `Invalid ${attributes.field}` }, { status: 400 });
  }

  const wantsPriceUpdate = Array.isArray(body.beerPrices) && body.beerPrices.length > 0;
  const beerPrices = wantsPriceUpdate ? sanitizeBeerPrices(body.beerPrices) : [];
  if (wantsPriceUpdate && beerPrices.length === 0) {
    return NextResponse.json(
      { error: "At least one valid beer price is required" },
      { status: 400 }
    );
  }

  const limited = await rateLimitedResponse(
    supabase,
    updateRateLimitChecks(clientIp(request.headers), id, rateLimitSalt())
  );
  if (limited) return limited;

  // An invalid or expired token is not an error here: the edit is simply anonymous.
  const authorization = request.headers.get("authorization");
  const user = authorization ? await authenticateRequest(supabase, authorization) : null;

  // Everything is validated above; one atomic call updates happy hour and replaces prices,
  // and changes nothing (404) when the venue does not exist.
  const result = await runVenueWrite(
    supabase,
    "update_venue_and_prices",
    buildUpdateVenueArgs(
      id,
      {
        hasHappyHour: typeof body.hasHappyHour === "boolean" ? body.hasHappyHour : undefined,
        happyHourDetails: cleanString(body.happyHourDetails, MAX_HAPPY_HOUR_DETAILS_LEN),
        beerPrices,
        attributes: attributes.patch,
      },
      user?.id ?? null
    )
  );

  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: wantsPriceUpdate ? "Failed to update beer prices" : "Failed to update venue" },
      { status: 500 }
    );
  }

  const ratings = await fetchRatingSummaries(supabase, [id]);
  return NextResponse.json({ venue: withRating(result.venue, ratings.get(id)) });
}
