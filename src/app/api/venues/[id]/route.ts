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

  // Safety for deploy: block public write operations until Supabase Auth/RLS is in place.
  // To re-enable writes, set `USER_EDITS_ENABLED=true` in the production environment.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.USER_EDITS_ENABLED !== "true"
  ) {
    return NextResponse.json(
      { error: "User edits are disabled in production" },
      { status: 403 }
    );
  }

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

  const ALLOWED_BEER_TYPES: BeerType[] = ["chope", "long_neck", "lata", "garrafa", "outro"];
  const maxBeerPrices = 20;
  const maxHappyHourDetailsLen = 160;

  if (body.hasHappyHour !== undefined) {
    if (typeof body.hasHappyHour !== "boolean") {
      return NextResponse.json({ error: "Invalid hasHappyHour" }, { status: 400 });
    }
    if (body.happyHourDetails != null && typeof body.happyHourDetails !== "string") {
      return NextResponse.json({ error: "Invalid happyHourDetails" }, { status: 400 });
    }

    const happyHourDetails = body.happyHourDetails?.trim() ?? "";
    const { error: updateError } = await supabase
      .from("venues")
      .update({
        has_happy_hour: body.hasHappyHour,
        happy_hour_details:
          body.hasHappyHour && happyHourDetails
            ? happyHourDetails.slice(0, maxHappyHourDetailsLen)
            : null,
      })
      .eq("id", id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  if (body.beerPrices && Array.isArray(body.beerPrices) && body.beerPrices.length > 0) {
    const sanitizedBeerPrices: BeerPrice[] = body.beerPrices
      .slice(0, maxBeerPrices)
      .flatMap((p) => {
        if (!p || typeof p !== "object") return [];
        const type = p.type as BeerType;
        if (!ALLOWED_BEER_TYPES.includes(type)) return [];
        const label = (p.label ?? "").trim();
        const priceBRL = Number(p.priceBRL);
        const volumeMl = p.volumeMl == null ? undefined : Number(p.volumeMl);

        if (label.length < 1 || label.length > 60) return [];
        if (!Number.isFinite(priceBRL) || priceBRL <= 0 || priceBRL > 5000) return [];
        if (volumeMl != null && (!Number.isFinite(volumeMl) || volumeMl < 0 || volumeMl > 5000)) return [];

        return [
          {
            type,
            label,
            priceBRL,
            ...(volumeMl != null ? { volumeMl } : {}),
          } as BeerPrice,
        ];
      });

    if (sanitizedBeerPrices.length === 0) {
      return NextResponse.json(
        { error: "At least one valid beer price is required" },
        { status: 400 }
      );
    }

    await supabase.from("beer_prices").delete().eq("venue_id", id);

    const rows = sanitizedBeerPrices.map((p) => ({
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
