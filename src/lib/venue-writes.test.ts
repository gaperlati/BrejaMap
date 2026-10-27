/**
 * Tests for the atomic venue write helpers (no database): run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BeerPrice } from "@/types";
import {
  buildCreateVenueArgs,
  buildUpdateVenueArgs,
  parseVenueRpcPayload,
  runVenueWrite,
  toRpcPrices,
  type RpcClient,
} from "./venue-writes";
import { loadVenuesErrorMessage, type ApiError } from "./api";

const VENUE_ID = "11111111-2222-4333-8444-555555555555";

const PRICES: BeerPrice[] = [
  { type: "chope", label: "Brahma", priceBRL: 9.9, volumeMl: 300 },
  { type: "lata", label: "Skol", priceBRL: 6 },
];

const VENUE_ROW = {
  id: VENUE_ID,
  name: "Bar do Centro",
  address: "Rua Episcopal, 100",
  neighborhood: "Centro",
  city: "São Carlos",
  state: "SP",
  lat: -22.0175,
  lng: -47.8908,
  has_happy_hour: true,
  happy_hour_details: "17h–19h",
  photo_url: null,
  created_at: "2026-10-01T12:00:00Z",
  user_added: true,
  source: "user",
  external_id: null,
};

const PRICE_ROWS = [
  {
    id: "p1",
    venue_id: VENUE_ID,
    type: "chope",
    label: "Brahma",
    price_brl: 9.9,
    volume_ml: 300,
    created_at: "2026-10-01T12:00:00Z",
  },
  {
    id: "p2",
    venue_id: VENUE_ID,
    type: "lata",
    label: "Skol",
    price_brl: 6,
    volume_ml: null,
    created_at: "2026-10-01T12:00:00Z",
  },
];

function fakeClient(response: { data: unknown; error: unknown } | Error) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (response instanceof Error) throw response;
      return response;
    },
  };
  return { client, calls };
}

function silenceConsoleError(t: { mock: { method: (obj: object, name: string, impl: () => void) => unknown } }) {
  t.mock.method(console, "error", () => {});
}

test("toRpcPrices maps camelCase prices to table columns", () => {
  assert.deepEqual(toRpcPrices(PRICES), [
    { type: "chope", label: "Brahma", price_brl: 9.9, volume_ml: 300 },
    { type: "lata", label: "Skol", price_brl: 6, volume_ml: null },
  ]);
});

test("buildUpdateVenueArgs: prices only leaves happy hour untouched", () => {
  const args = buildUpdateVenueArgs(VENUE_ID, { happyHourDetails: "", beerPrices: PRICES });
  assert.equal(args.p_venue_id, VENUE_ID);
  assert.equal(args.p_update_happy_hour, false);
  assert.equal(args.p_replace_prices, true);
  assert.equal((args.p_prices as unknown[]).length, 2);
});

test("buildUpdateVenueArgs: happy hour only does not replace prices", () => {
  const args = buildUpdateVenueArgs(VENUE_ID, {
    hasHappyHour: true,
    happyHourDetails: "17h–19h",
    beerPrices: [],
  });
  assert.equal(args.p_update_happy_hour, true);
  assert.equal(args.p_has_happy_hour, true);
  assert.equal(args.p_happy_hour_details, "17h–19h");
  assert.equal(args.p_replace_prices, false);
  assert.deepEqual(args.p_prices, []);
});

test("buildUpdateVenueArgs: turning happy hour off clears the details", () => {
  const args = buildUpdateVenueArgs(VENUE_ID, {
    hasHappyHour: false,
    happyHourDetails: "ignored",
    beerPrices: [],
  });
  assert.equal(args.p_update_happy_hour, true);
  assert.equal(args.p_has_happy_hour, false);
  assert.equal(args.p_happy_hour_details, null);
});

test("buildCreateVenueArgs passes every column and nulls empty happy hour details", () => {
  const args = buildCreateVenueArgs({
    name: "Bar Novo",
    address: "Endereço não informado",
    neighborhood: "",
    city: "São Carlos",
    state: "SP",
    lat: -22.01,
    lng: -47.89,
    hasHappyHour: true,
    happyHourDetails: "",
    beerPrices: PRICES,
  });
  assert.equal(args.p_name, "Bar Novo");
  assert.equal(args.p_lat, -22.01);
  assert.equal(args.p_has_happy_hour, true);
  assert.equal(args.p_happy_hour_details, null);
  assert.equal((args.p_prices as unknown[]).length, 2);
});

test("parseVenueRpcPayload maps the venue and its prices", () => {
  const venue = parseVenueRpcPayload({ venue: VENUE_ROW, beer_prices: PRICE_ROWS });
  assert.ok(venue);
  assert.equal(venue.id, VENUE_ID);
  assert.equal(venue.hasHappyHour, true);
  assert.equal(venue.happyHourDetails, "17h–19h");
  assert.equal(venue.photoUrl, undefined);
  assert.deepEqual(venue.beerPrices, [
    { type: "chope", label: "Brahma", priceBRL: 9.9, volumeMl: 300 },
    { type: "lata", label: "Skol", priceBRL: 6, volumeMl: undefined },
  ]);
});

test("parseVenueRpcPayload rejects malformed payloads", () => {
  assert.equal(parseVenueRpcPayload("oops"), null);
  assert.equal(parseVenueRpcPayload({ venue: null, beer_prices: [] }), null);
  assert.equal(parseVenueRpcPayload({ venue: VENUE_ROW }), null);
});

test("runVenueWrite: success makes exactly one rpc call", async () => {
  const { client, calls } = fakeClient({ data: { venue: VENUE_ROW, beer_prices: PRICE_ROWS }, error: null });
  const args = buildUpdateVenueArgs(VENUE_ID, { happyHourDetails: "", beerPrices: PRICES });
  const result = await runVenueWrite(client, "update_venue_and_prices", args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "update_venue_and_prices");
  assert.deepEqual(calls[0].args, args);
  assert.ok(result.ok);
  assert.equal(result.venue.beerPrices.length, 2);
});

test("runVenueWrite: null payload means the venue does not exist", async () => {
  const { client } = fakeClient({ data: null, error: null });
  const result = await runVenueWrite(client, "update_venue_and_prices", {});
  assert.deepEqual(result, { ok: false, reason: "not_found" });
});

test("runVenueWrite: database errors are reported without the raw message", async (t) => {
  silenceConsoleError(t);
  const { client } = fakeClient({
    data: null,
    error: { code: "23514", message: 'new row violates check constraint "beer_prices_price_brl_check"' },
  });
  const result = await runVenueWrite(client, "update_venue_and_prices", {});
  assert.deepEqual(result, { ok: false, reason: "db_error" });
});

test("runVenueWrite: missing migration is a db_error", async (t) => {
  silenceConsoleError(t);
  const { client } = fakeClient({ data: null, error: { code: "PGRST202", message: "not found" } });
  const result = await runVenueWrite(client, "create_venue_with_prices", {});
  assert.deepEqual(result, { ok: false, reason: "db_error" });
});

test("runVenueWrite: a thrown network error is a db_error", async (t) => {
  silenceConsoleError(t);
  const { client } = fakeClient(new TypeError("fetch failed"));
  const result = await runVenueWrite(client, "create_venue_with_prices", {});
  assert.deepEqual(result, { ok: false, reason: "db_error" });
});

test("runVenueWrite: unexpected payload is a db_error", async (t) => {
  silenceConsoleError(t);
  const { client } = fakeClient({ data: { something: "else" }, error: null });
  const result = await runVenueWrite(client, "create_venue_with_prices", {});
  assert.deepEqual(result, { ok: false, reason: "db_error" });
});

function apiError(status: number | undefined, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  return err;
}

test("loadVenuesErrorMessage never shows raw server text", () => {
  assert.match(loadVenuesErrorMessage(apiError(503, "Database not configured")), /Backend não configurado/);
  assert.match(loadVenuesErrorMessage(apiError(400, "Bounds too large; zoom in")), /aproxime o mapa/);
  const generic = "Não foi possível carregar os bares. Verifique sua conexão e tente novamente.";
  assert.equal(loadVenuesErrorMessage(apiError(500, "Failed to load venues")), generic);
  assert.equal(loadVenuesErrorMessage(apiError(500, "<html>Cloudflare</html>")), generic);
  assert.equal(loadVenuesErrorMessage(new TypeError("Failed to fetch")), generic);
});
