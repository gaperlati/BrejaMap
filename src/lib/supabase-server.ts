/**
 * Server-side Supabase client for API routes.
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (never expose service role to the client).
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceRoleKey) {
  console.warn(
    "Supabase: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for API routes. Map data will be empty."
  );
}

export const supabase =
  url && serviceRoleKey
    ? createClient(url, serviceRoleKey, { auth: { persistSession: false } })
    : null;

/** venues columns that have a database default (nullable or `default false`). */
type VenueDefaultedColumns =
  | "external_id"
  | "prices_unverified"
  | "needs_review"
  | "created_by"
  | "last_edited_by"
  | "last_edited_at";

export type Database = {
  public: {
    Tables: {
      venues: {
        Row: {
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
          external_id: string | null;
          prices_unverified: boolean;
          needs_review: boolean;
          created_by: string | null;
          last_edited_by: string | null;
          last_edited_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["venues"]["Row"], "id" | "created_at" | VenueDefaultedColumns> & {
          id?: string;
          created_at?: string;
        } & Partial<Pick<Database["public"]["Tables"]["venues"]["Row"], VenueDefaultedColumns>>;
        Update: Partial<Database["public"]["Tables"]["venues"]["Insert"]>;
      };
      beer_prices: {
        Row: {
          id: string;
          venue_id: string;
          type: string;
          label: string;
          price_brl: number;
          volume_ml: number | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["beer_prices"]["Row"], "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["beer_prices"]["Insert"]>;
      };
    };
  };
};
