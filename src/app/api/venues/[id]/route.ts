import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import {
  type VenueRow,
  type BeerPriceRow,
  rowToVenue,
  sanitizeBeerPrices,
  cleanString,
  isUuid,
  writesBlockedResponse,
  MAX_HAPPY_HOUR_DETAILS_LEN,
} from "@/lib/venue-server";

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

  // Validate everything before touching the database, and 404 on unknown ids.
  const { data: existing, error: existsError } = await supabase
    .from("venues")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existsError) {
    console.error("Supabase venue lookup error:", existsError);
    return NextResponse.json({ error: "Failed to load venue" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  if (typeof body.hasHappyHour === "boolean") {
    const happyHourDetails = cleanString(body.happyHourDetails, MAX_HAPPY_HOUR_DETAILS_LEN);
    const { error: updateError } = await supabase
      .from("venues")
      .update({
        has_happy_hour: body.hasHappyHour,
        happy_hour_details: body.hasHappyHour && happyHourDetails ? happyHourDetails : null,
      })
      .eq("id", id);
    if (updateError) {
      console.error("Supabase update venue error:", updateError);
      return NextResponse.json({ error: "Failed to update venue" }, { status: 500 });
    }
  }

  if (wantsPriceUpdate) {
    const { error: deleteError } = await supabase
      .from("beer_prices")
      .delete()
      .eq("venue_id", id);
    if (deleteError) {
      console.error("Supabase delete beer_prices error:", deleteError);
      return NextResponse.json({ error: "Failed to update beer prices" }, { status: 500 });
    }

    const { error: insertError } = await supabase.from("beer_prices").insert(
      beerPrices.map((p) => ({
        venue_id: id,
        type: p.type,
        label: p.label,
        price_brl: p.priceBRL,
        volume_ml: p.volumeMl ?? null,
      }))
    );
    if (insertError) {
      console.error("Supabase insert beer_prices error:", insertError);
      return NextResponse.json({ error: "Failed to update beer prices" }, { status: 500 });
    }
  }

  const { data: venueRow, error: fetchError } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !venueRow) {
    console.error("Supabase fetch venue error:", fetchError);
    return NextResponse.json({ error: "Failed to load venue" }, { status: 500 });
  }

  const { data: priceRows } = await supabase
    .from("beer_prices")
    .select("*")
    .eq("venue_id", id);

  const venue = rowToVenue(venueRow as VenueRow, (priceRows ?? []) as BeerPriceRow[]);
  return NextResponse.json({ venue });
}
