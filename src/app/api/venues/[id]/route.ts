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
 * PATCH /api/venues/[id] - Update venue (e.g. add/edit beer prices, happy hour).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing venue id" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: { beerPrices?: BeerPrice[]; hasHappyHour?: boolean; happyHourDetails?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.hasHappyHour !== undefined) {
    const { error: updateError } = await supabase
      .from("venues")
      .update({
        has_happy_hour: body.hasHappyHour,
        happy_hour_details: body.happyHourDetails ?? null,
      })
      .eq("id", id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  if (body.beerPrices && Array.isArray(body.beerPrices) && body.beerPrices.length > 0) {
    await supabase.from("beer_prices").delete().eq("venue_id", id);

    const rows = body.beerPrices.map((p) => ({
      venue_id: id,
      type: p.type,
      label: p.label,
      price_brl: p.priceBRL,
      volume_ml: p.volumeMl ?? null,
    }));
    const { error: insertError } = await supabase.from("beer_prices").insert(rows);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const { data: venueRow, error: fetchError } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !venueRow) {
    return NextResponse.json(
      { error: fetchError?.message ?? "Venue not found" },
      { status: fetchError ? 500 : 404 }
    );
  }

  const { data: priceRows } = await supabase
    .from("beer_prices")
    .select("*")
    .eq("venue_id", id);

  const venue = rowToVenue(venueRow as VenueRow, (priceRows ?? []) as BeerPriceRow[]);
  return NextResponse.json({ venue });
}
