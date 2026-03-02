export type BeerType = "chope" | "long_neck" | "lata" | "garrafa" | "outro";

export interface BeerPrice {
  type: BeerType;
  label: string;
  priceBRL: number;
  volumeMl?: number;
}

export interface Venue {
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
  /** Preços adicionados por usuário – exibir aviso */
  userAdded?: boolean;
  /** Veio do OpenStreetMap – sem preços até alguém adicionar */
  fromOsm?: boolean;
  /** Veio do Google Places – sem preços até alguém adicionar */
  fromGoogle?: boolean;
}

export type SortOption = "price_asc" | "price_desc" | "distance" | "name";
export type PriceFilter = number | null; // max price in BRL
