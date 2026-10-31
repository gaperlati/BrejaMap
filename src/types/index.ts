export type BeerType = "chope" | "long_neck" | "lata" | "garrafa" | "outro";

export interface BeerPrice {
  /** Database id; absent for prices not saved yet. */
  id?: string;
  /** ISO time the price was last entered or confirmed in BrejaMap (not when it was observed). */
  updatedAt?: string;
  type: BeerType;
  label: string;
  priceBRL: number;
  volumeMl?: number;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** One opening interval, "HH:MM" 24h. `close` <= `open` means it closes after midnight. */
export interface OpeningInterval {
  open: string;
  close: string;
}

/** Weekly hours in São Paulo time; a missing or empty day means closed that day. */
export type OpeningHours = Partial<Record<Weekday, OpeningInterval[]>>;

/** Optional venue facts; undefined means unknown (nobody informed it). */
export interface VenueAttributes {
  transmitsFootball?: boolean;
  acceptsReservations?: boolean;
  hasOutdoorArea?: boolean;
  openingHours?: OpeningHours;
}

/**
 * Attribute changes sent to the API: absent key = unchanged, null = clear (back to unknown).
 */
export type VenueAttributesPatch = {
  [K in keyof VenueAttributes]?: VenueAttributes[K] | null;
};

export interface Venue extends VenueAttributes {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  beerPrices: BeerPrice[];
  hasHappyHour: boolean;
  happyHourDetails?: string;
  photoUrl?: string;
  createdAt: string;
  /** Community rating (1–5) average and count; absent when nobody rated. */
  ratingAvg?: number;
  ratingCount?: number;
  /** Bar cadastrado por usuário – exibir aviso de preços não verificados */
  userAdded?: boolean;
  /** Preços ou happy hour editados pela comunidade – exibir aviso de preços não verificados */
  pricesUnverified?: boolean;
  /** Veio do OpenStreetMap – sem preços até alguém adicionar */
  fromOsm?: boolean;
  /** Veio do Google Places – sem preços até alguém adicionar */
  fromGoogle?: boolean;
}

export type SortOption = "price_asc" | "price_desc" | "distance" | "name" | "rating";
export type PriceFilter = number | null; // max price in BRL
