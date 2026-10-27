import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import {
  sanitizeBeerPrices,
  cleanString,
  isUuid,
  writesBlockedResponse,
  MAX_HAPPY_HOUR_DETAILS_LEN,
} from "@/lib/venue-server";
import { buildUpdateVenueArgs, runVenueWrite } from "@/lib/venue-writes";

/**
 * PATCH /api/venues/[id] - Update venue (e.g. add/edit beer prices, happy hour).
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

  const wantsPriceUpdate = Array.isArray(body.beerPrices) && body.beerPrices.length > 0;
  const beerPrices = wantsPriceUpdate ? sanitizeBeerPrices(body.beerPrices) : [];
  if (wantsPriceUpdate && beerPrices.length === 0) {
    return NextResponse.json(
      { error: "At least one valid beer price is required" },
      { status: 400 }
    );
  }

  // Everything is validated above; one atomic call updates happy hour and replaces prices,
  // and changes nothing (404) when the venue does not exist.
  const result = await runVenueWrite(
    supabase,
    "update_venue_and_prices",
    buildUpdateVenueArgs(id, {
      hasHappyHour: typeof body.hasHappyHour === "boolean" ? body.hasHappyHour : undefined,
      happyHourDetails: cleanString(body.happyHourDetails, MAX_HAPPY_HOUR_DETAILS_LEN),
      beerPrices,
    })
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

  return NextResponse.json({ venue: result.venue });
}
