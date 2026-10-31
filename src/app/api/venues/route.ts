import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
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
  MAX_VENUE_CANDIDATES_PER_TIER,
} from "@/lib/venue-server";
import {
  collapseOsmNearDuplicates,
  dedupeVenuesByPlace,
  selectVenuesForBounds,
} from "@/lib/venue-selection";
import { buildCreateVenueArgs, runVenueWrite } from "@/lib/venue-writes";
import { parseVenueAttributesPatch } from "@/lib/venue-attributes";
import { fetchRatingSummaries, withRating } from "@/lib/venue-ratings";
import {
  authenticateRequest,
  clientIp,
  createRateLimitChecks,
  rateLimitSalt,
} from "@/lib/write-guards";

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

  // Prices come embedded with each venue (beer_prices.venue_id FK), so no `.in(venue_id, ...)`
  // list with hundreds of ids ever goes into the URL. One bounded query per priority tier:
  // priced venues, user-added venues, then the rest. Each returns at most
  // MAX_VENUE_CANDIDATES_PER_TIER rows plus an exact count, so the final ranking by
  // tier + distance happens here without ever loading an unbounded number of rows.
  const db = supabase;
  const inBounds = (select: string) =>
    db
      .from("venues")
      .select(select, { count: "exact" })
      .gte("lat", south)
      .lte("lat", north)
      .gte("lng", west)
      .lte("lng", east);
  const tierQueries = [
    inBounds("*, beer_prices!inner(*)"),
    inBounds("*, beer_prices(*)").eq("user_added", true),
    inBounds("*, beer_prices(*)").eq("user_added", false),
  ].map((query) =>
    query.order("created_at", { ascending: false }).limit(MAX_VENUE_CANDIDATES_PER_TIER)
  );
  const results = await Promise.all(tierQueries);

  const failed = results.find((r) => r.error);
  if (failed) {
    console.error("Supabase venues error:", failed.error);
    return NextResponse.json(
      { error: "Failed to load venues", venues: [] },
      { status: 500 }
    );
  }

  type VenueWithPricesRow = VenueRow & { beer_prices: BeerPriceRow[] | null };
  const rowsById = new Map<string, VenueWithPricesRow>();
  let moreInDatabase = false;
  for (const { data, count } of results) {
    const rows = (data ?? []) as unknown as VenueWithPricesRow[];
    if (count != null && count > rows.length) moreInDatabase = true;
    // Priced venues also show up in the user_added tiers; the first copy is as good as any.
    for (const row of rows) if (!rowsById.has(row.id)) rowsById.set(row.id, row);
  }

  const mappedVenues = Array.from(rowsById.values()).map((row) =>
    rowToVenue(row, row.beer_prices ?? [])
  );
  const { venues, truncated } = selectVenuesForBounds(
    collapseOsmNearDuplicates(dedupeVenuesByPlace(mappedVenues)),
    { south, west, north, east },
    MAX_VENUES_PER_REQUEST,
    moreInDatabase
  );

  // Ratings come from one aggregate call for the venues actually returned (none on failure).
  const ratings = await fetchRatingSummaries(db, venues.map((v) => v.id));
  return NextResponse.json({ venues: venues.map((v) => withRating(v, ratings.get(v.id))), truncated });
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

  const attributes = parseVenueAttributesPatch(body);
  if (!attributes.ok) {
    return NextResponse.json({ error: `Invalid ${attributes.field}` }, { status: 400 });
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
      attributes: attributes.patch,
      createdBy: user.id,
    })
  );

  if (!result.ok) {
    return NextResponse.json({ error: "Failed to create venue" }, { status: 500 });
  }

  return NextResponse.json({ venue: result.venue }, { status: 201 });
}
