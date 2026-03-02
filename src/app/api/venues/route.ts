import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { Venue, BeerPrice } from "@/types";
import type { BeerType } from "@/types";

type VenueRow = {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  has_happy_hour: boolean;
  happy_hour_details: string | null;
  photo_url: string | null;
  created_at: string;
  user_added: boolean;
  source: "user" | "google" | "osm";
};

type BeerPriceRow = {
  id: string;
  venue_id: string;
  type: string;
  label: string;
  price_brl: number;
  volume_ml: number | null;
  created_at: string;
};

function rowToVenue(row: VenueRow, prices: BeerPriceRow[]): Venue {
  const beerPrices: BeerPrice[] = prices
    .filter((p) => p.venue_id === row.id)
    .map((p) => ({
      type: p.type as BeerType,
      label: p.label,
      priceBRL: Number(p.price_brl),
      volumeMl: p.volume_ml ?? undefined,
    }));
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    lat: row.lat,
    lng: row.lng,
    beerPrices,
    hasHappyHour: row.has_happy_hour,
    happyHourDetails: row.happy_hour_details ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    createdAt: row.created_at,
    userAdded: row.user_added,
    fromOsm: row.source === "osm",
    fromGoogle: row.source === "google",
  };
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
    [south, west, north, east].some((n) => typeof n !== "number" || Number.isNaN(n))
  ) {
    return NextResponse.json({ error: "Invalid bounds" }, { status: 400 });
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
    .order("created_at", { ascending: true });

  if (venuesError) {
    console.error("Supabase venues error:", venuesError);
    return NextResponse.json(
      { error: venuesError.message, venues: [] },
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
      { error: pricesError.message, venues: [] },
      { status: 500 }
    );
  }

  const venues: Venue[] = (venueRows ?? []).map((row: VenueRow) =>
    rowToVenue(row, (priceRows ?? []) as BeerPriceRow[])
  );

  return NextResponse.json({ venues });
}

/**
 * POST /api/venues - Create a new venue (e.g. from "Adicionar bar").
 */
export async function POST(request: NextRequest) {
  if (!supabase) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: {
    name: string;
    address?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    lat: number;
    lng: number;
    beerPrices: { type: string; label: string; priceBRL: number; volumeMl?: number }[];
    hasHappyHour?: boolean;
    happyHourDetails?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name || typeof body.lat !== "number" || typeof body.lng !== "number") {
    return NextResponse.json(
      { error: "name, lat, lng required" },
      { status: 400 }
    );
  }

  const { data: venueRow, error: insertVenueError } = await supabase
    .from("venues")
    .insert({
      name: body.name.trim(),
      address: (body.address ?? "").trim() || "Endereço não informado",
      neighborhood: (body.neighborhood ?? "").trim() || "São Paulo",
      city: (body.city ?? "").trim() || "São Paulo",
      state: (body.state ?? "").trim() || "SP",
      lat: body.lat,
      lng: body.lng,
      has_happy_hour: body.hasHappyHour ?? false,
      happy_hour_details: body.happyHourDetails?.trim() || null,
      user_added: true,
      source: "user",
    })
    .select("*")
    .single();

  if (insertVenueError || !venueRow) {
    return NextResponse.json(
      { error: insertVenueError?.message ?? "Failed to create venue" },
      { status: 500 }
    );
  }

  const venueId = (venueRow as VenueRow).id;
  if (body.beerPrices?.length) {
    const rows = body.beerPrices.map((p) => ({
      venue_id: venueId,
      type: p.type,
      label: p.label,
      price_brl: p.priceBRL,
      volume_ml: p.volumeMl ?? null,
    }));
    await supabase.from("beer_prices").insert(rows);
  }

  const { data: priceRows } = await supabase
    .from("beer_prices")
    .select("*")
    .eq("venue_id", venueId);

  const venue = rowToVenue(venueRow as VenueRow, (priceRows ?? []) as BeerPriceRow[]);
  return NextResponse.json({ venue });
}
