import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { Venue } from "@/types";
import {
  type VenueRow,
  type BeerPriceRow,
  rowToVenue,
  sanitizeBeerPrices,
  cleanString,
  isInsideSpState,
  writesBlockedResponse,
  authRequiredResponse,
  rateLimitedResponse,
  MAX_NAME_LEN,
  MAX_ADDRESS_FIELD_LEN,
  MAX_HAPPY_HOUR_DETAILS_LEN,
  MAX_BOUNDS_SPAN_DEG,
  MAX_VENUES_PER_REQUEST,
} from "@/lib/venue-server";
import { buildCreateVenueArgs, runVenueWrite } from "@/lib/venue-writes";
import {
  authenticateRequest,
  clientIp,
  createRateLimitChecks,
  rateLimitSalt,
} from "@/lib/write-guards";

function venueDedupKey(venue: Venue): string {
  const normalizedName = venue.name.trim().toLowerCase();
  // ~1m precision to collapse duplicated rows for same place
  const latKey = venue.lat.toFixed(5);
  const lngKey = venue.lng.toFixed(5);
  return `${normalizedName}|${latKey}|${lngKey}`;
}

function pickPreferredVenue(current: Venue, candidate: Venue): Venue {
  // Prefer user-added rows, then rows with beer prices, then most recent row.
  const score = (v: Venue): number =>
    (v.userAdded ? 100 : 0) + (v.beerPrices.length > 0 ? 10 : 0) + Date.parse(v.createdAt);
  return score(candidate) >= score(current) ? candidate : current;
}

/**
 * GET /api/venues?bounds=south,west,north,east
 * Returns venues in the given bounding box from our database.
 * Lightweight: no client-side Google Places calls.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bounds = searchParams.get("bounds");
  if (!bounds) {
    return NextResponse.json(
      { error: "Missing bounds (south,west,north,east)" },
      { status: 400 }
    );
  }
  const [south, west, north, east] = bounds.split(",").map(Number);
  if (
    [south, west, north, east].some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
    south > north ||
    west > east
  ) {
    return NextResponse.json({ error: "Invalid bounds" }, { status: 400 });
  }
  // Refuse huge areas so a single request can't dump the whole table.
  if (north - south > MAX_BOUNDS_SPAN_DEG || east - west > MAX_BOUNDS_SPAN_DEG) {
    return NextResponse.json({ error: "Bounds too large; zoom in" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Database not configured", venues: [] },
      { status: 503 }
    );
  }

  const { data: venueRows, error: venuesError } = await supabase
    .from("venues")
    .select("*")
    .gte("lat", south)
    .lte("lat", north)
    .gte("lng", west)
    .lte("lng", east)
    .order("created_at", { ascending: true })
    .limit(MAX_VENUES_PER_REQUEST);

  if (venuesError) {
    console.error("Supabase venues error:", venuesError);
    return NextResponse.json(
      { error: "Failed to load venues", venues: [] },
      { status: 500 }
    );
  }

  const ids = (venueRows ?? []).map((r: VenueRow) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ venues: [] });
  }

  const { data: priceRows, error: pricesError } = await supabase
    .from("beer_prices")
    .select("*")
    .in("venue_id", ids);

  if (pricesError) {
    console.error("Supabase beer_prices error:", pricesError);
    return NextResponse.json(
      { error: "Failed to load venues", venues: [] },
      { status: 500 }
    );
  }

  const mappedVenues: Venue[] = (venueRows ?? []).map((row: VenueRow) =>
    rowToVenue(row, (priceRows ?? []) as BeerPriceRow[])
  );
  const dedupedByPlace = new Map<string, Venue>();
  for (const venue of mappedVenues) {
    const key = venueDedupKey(venue);
    const current = dedupedByPlace.get(key);
    dedupedByPlace.set(key, current ? pickPreferredVenue(current, venue) : venue);
  }
  const venues = Array.from(dedupedByPlace.values());

  return NextResponse.json({ venues });
}

/**
 * POST /api/venues - Create a new venue (e.g. from "Adicionar bar").
 * Requires a signed-in user (`Authorization: Bearer <access_token>`, else 401) and is
 * rate-limited per user and per IP (429).
 */
export async function POST(request: NextRequest) {
  const blocked = writesBlockedResponse();
  if (blocked) return blocked;

  if (!supabase) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const user = await authenticateRequest(supabase, request.headers.get("authorization"));
  if (!user) return authRequiredResponse();

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const lat = body.lat;
  const lng = body.lng;

  if (name.length < 2 || name.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }
  if (!isInsideSpState(lat, lng)) {
    return NextResponse.json(
      { error: "Location must be in São Paulo state" },
      { status: 400 }
    );
  }

  const beerPrices = sanitizeBeerPrices(body.beerPrices);
  if (beerPrices.length === 0) {
    return NextResponse.json(
      { error: "At least one valid beer price is required" },
      { status: 400 }
    );
  }

  const hasHappyHour = body.hasHappyHour === true;
  const happyHourDetails = cleanString(body.happyHourDetails, MAX_HAPPY_HOUR_DETAILS_LEN);

  // Counted only once the request is valid, right before touching the venue tables.
  const limited = await rateLimitedResponse(
    supabase,
    createRateLimitChecks(clientIp(request.headers), user.id, rateLimitSalt())
  );
  if (limited) return limited;

  // Venue and prices are inserted in one transaction: no price-less venue is left behind.
  const result = await runVenueWrite(
    supabase,
    "create_venue_with_prices",
    buildCreateVenueArgs({
      name,
      address: cleanString(body.address, MAX_ADDRESS_FIELD_LEN) || "Endereço não informado",
      neighborhood: cleanString(body.neighborhood, MAX_ADDRESS_FIELD_LEN),
      city: cleanString(body.city, MAX_ADDRESS_FIELD_LEN),
      state: cleanString(body.state, MAX_ADDRESS_FIELD_LEN) || "SP",
      lat,
      lng,
      hasHappyHour,
      happyHourDetails,
      beerPrices,
      createdBy: user.id,
    })
  );

  if (!result.ok) {
    return NextResponse.json({ error: "Failed to create venue" }, { status: 500 });
  }

  return NextResponse.json({ venue: result.venue }, { status: 201 });
}
