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
 */
export async function POST(request: NextRequest) {
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

  if (
    !body.name ||
    typeof body.lat !== "number" ||
    typeof body.lng !== "number"
  ) {
    return NextResponse.json(
      { error: "name, lat, lng required" },
      { status: 400 }
    );
  }

  const name = body.name.trim();
  const lat = body.lat;
  const lng = body.lng;
  const happyHourDetails = (body.happyHourDetails ?? "").trim();

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Invalid name length" }, { status: 400 });
  }

  const ALLOWED_BEER_TYPES: BeerType[] = ["chope", "long_neck", "lata", "garrafa", "outro"];
  const maxBeerPrices = 20;
  const maxHappyHourDetailsLen = 160;

  const sanitizedBeerPrices: { type: BeerType; label: string; priceBRL: number; volumeMl?: number }[] = Array.isArray(body.beerPrices)
    ? body.beerPrices.slice(0, maxBeerPrices).flatMap((p) => {
        if (!p || typeof p !== "object") return [];
        const type = p.type as BeerType;
        if (!ALLOWED_BEER_TYPES.includes(type)) return [];
        const label = (p.label ?? "").trim();
        const priceBRL = Number(p.priceBRL);
        const volumeMl =
          p.volumeMl == null ? undefined : Number(p.volumeMl);

        if (label.length < 1 || label.length > 60) return [];
        if (!Number.isFinite(priceBRL) || priceBRL <= 0 || priceBRL > 5000) return [];
        if (volumeMl != null && (!Number.isFinite(volumeMl) || volumeMl < 0 || volumeMl > 5000)) return [];

        return [
          {
            type,
            label,
            priceBRL,
            ...(volumeMl != null ? { volumeMl } : {}),
          },
        ];
      })
    : [];

  if (sanitizedBeerPrices.length === 0) {
    return NextResponse.json(
      { error: "At least one valid beer price is required" },
      { status: 400 }
    );
  }

  const { data: venueRow, error: insertVenueError } = await supabase
    .from("venues")
    .insert({
      name,
      address: (body.address ?? "").trim() || "Endereço não informado",
      neighborhood: (body.neighborhood ?? "").trim() || "São Paulo",
      city: (body.city ?? "").trim() || "São Paulo",
      state: (body.state ?? "").trim() || "SP",
      lat,
      lng,
      has_happy_hour: body.hasHappyHour ?? false,
      happy_hour_details:
        (body.hasHappyHour ?? false) && happyHourDetails
          ? happyHourDetails.slice(0, maxHappyHourDetailsLen)
          : null,
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
  if (sanitizedBeerPrices.length > 0) {
    const rows = sanitizedBeerPrices.map((p) => ({
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

  const venue = rowToVenue(
    venueRow as VenueRow,
    (priceRows ?? []) as BeerPriceRow[]
  );
  return NextResponse.json({ venue });
}
