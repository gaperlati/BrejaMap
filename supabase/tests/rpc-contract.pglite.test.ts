// API <-> database contract: the real argument builders and payload parsers in src/lib run
// against the real migrated functions (PGlite, see pglite-db.mjs), through a fake client that
// calls functions with named arguments the way PostgREST does, as service_role.
//
//   npm run test:db

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SKIP_REASON as skip, USER_A, USER_B, asRole, openMigratedDb } from "./pglite-db.mjs";
import {
  buildCreateVenueArgs,
  buildUpdateVenueArgs,
  runVenueWrite,
  type RpcClient,
} from "../../src/lib/venue-writes";
import { diffVenueAttributes, parseVenueAttributesPatch } from "../../src/lib/venue-attributes";
import { fetchRatingSummaries } from "../../src/lib/venue-ratings";
import type { BeerPrice, Venue } from "../../src/types";

/** The slice of PGlite used here (pglite-db.mjs is untyped JS). */
type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};
let db: Db;

/** PostgREST-like rpc: named args cast to the declared parameter types, called as service_role. */
function pgClient(): RpcClient {
  return {
    async rpc(fn, args) {
      try {
        const sigs = await db.query<{ names: string[]; types: string[]; retset: boolean }>(
          `select p.proargnames as names,
             array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
             p.proretset as retset
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = $1`,
          [fn]
        );
        if (sigs.rows.length !== 1) return { data: null, error: { code: "PGRST202", message: `${fn}: ${sigs.rows.length} overloads` } };
        const { names, types, retset } = sigs.rows[0];
        const keys = Object.keys(args);
        for (const k of keys) {
          if (!names.includes(k)) return { data: null, error: { code: "PGRST202", message: `${fn} has no ${k}` } };
        }
        const params = keys.map((k) => {
          const v = args[k];
          const type = types[names.indexOf(k)];
          return type === "jsonb" && v !== null ? JSON.stringify(v) : v;
        });
        const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}::${types[names.indexOf(k)]}`).join(", ")})`;
        const res = await asRole(db, "service_role", null, () =>
          db.query<Record<string, unknown>>(retset ? `select * from ${call}` : `select ${call} as r`, params)
        );
        return { data: retset ? res.rows : res.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { code: (e as { code?: string }).code, message: (e as Error).message } };
      }
    },
  };
}

const prices: BeerPrice[] = [
  { type: "chope", label: "Chope Pilsen", priceBRL: 12.9, volumeMl: 300 },
  { type: "lata", label: "Lata Original", priceBRL: 8 },
];

async function createFromApi(attributesBody: Record<string, unknown> = {}): Promise<Venue> {
  const attrs = parseVenueAttributesPatch(attributesBody);
  assert.ok(attrs.ok, "attribute body rejected by the API parser");
  const result = await runVenueWrite(
    pgClient(),
    "create_venue_with_prices",
    buildCreateVenueArgs({
      name: "Bar Contrato",
      address: "Rua B, 2",
      neighborhood: "Centro",
      city: "São Carlos",
      state: "SP",
      lat: -22.01,
      lng: -47.89,
      hasHappyHour: false,
      happyHourDetails: "",
      beerPrices: prices,
      createdBy: USER_A,
      attributes: attrs.patch,
    })
  );
  assert.ok(result.ok, `create failed: ${JSON.stringify(result)}`);
  return result.venue;
}

before(async () => {
  if (skip) return;
  db = (await openMigratedDb()) as Db;
});

test("create: API args are accepted and the payload maps back with attributes and freshness", { skip }, async () => {
  const venue = await createFromApi({
    transmitsFootball: true,
    hasOutdoorArea: false,
    openingHours: { fri: [{ open: "18:00", close: "02:00" }] },
  });
  assert.equal(venue.transmitsFootball, true);
  assert.equal(venue.hasOutdoorArea, false);
  assert.equal(venue.acceptsReservations, undefined);
  assert.deepEqual(venue.openingHours, { fri: [{ open: "18:00", close: "02:00" }] });
  assert.equal(venue.beerPrices.length, 2);
  for (const p of venue.beerPrices) {
    assert.ok(p.id, "price id not mapped");
    assert.ok(p.updatedAt && Number.isFinite(Date.parse(p.updatedAt)), "price updatedAt not mapped");
  }
  const lata = venue.beerPrices.find((p) => p.type === "lata");
  assert.equal(lata?.volumeMl, undefined);
  assert.equal(venue.beerPrices.find((p) => p.type === "chope")?.priceBRL, 12.9);
});

test("update: editing one price through the API keeps the other price's id and timestamp", { skip }, async () => {
  const venue = await createFromApi();
  await db.query("update public.beer_prices set updated_at = '2020-01-01Z' where venue_id = $1", [venue.id]);
  const edited = venue.beerPrices.map((p) => (p.type === "lata" ? { ...p, priceBRL: 9.5 } : p));
  const result = await runVenueWrite(
    pgClient(),
    "update_venue_and_prices",
    buildUpdateVenueArgs(venue.id, { happyHourDetails: "", beerPrices: edited }, USER_B)
  );
  assert.ok(result.ok);
  const chopeBefore = venue.beerPrices.find((p) => p.type === "chope")!;
  const chopeAfter = result.venue.beerPrices.find((p) => p.type === "chope")!;
  const lataAfter = result.venue.beerPrices.find((p) => p.type === "lata")!;
  assert.equal(chopeAfter.id, chopeBefore.id);
  assert.equal(new Date(chopeAfter.updatedAt!).getUTCFullYear(), 2020, "unchanged price was refreshed");
  assert.notEqual(lataAfter.id, venue.beerPrices.find((p) => p.type === "lata")!.id);
  assert.ok(new Date(lataAfter.updatedAt!).getUTCFullYear() > 2020);
  assert.equal(result.venue.pricesUnverified, true);
});

test("update: an attribute diff from the editor clears and sets through the API", { skip }, async () => {
  const venue = await createFromApi({ transmitsFootball: true, acceptsReservations: true });
  const patch = diffVenueAttributes(venue, { ...venue, transmitsFootball: undefined, hasOutdoorArea: true });
  const result = await runVenueWrite(
    pgClient(),
    "update_venue_and_prices",
    buildUpdateVenueArgs(venue.id, { happyHourDetails: "", beerPrices: [], attributes: patch })
  );
  assert.ok(result.ok);
  assert.equal(result.venue.transmitsFootball, undefined, "cleared attribute still set");
  assert.equal(result.venue.acceptsReservations, true, "untouched attribute changed");
  assert.equal(result.venue.hasOutdoorArea, true);
  assert.equal(result.venue.beerPrices.length, 2, "attribute-only edit touched prices");
});

test("confirm: current id refreshes, stale id maps to not_found", { skip }, async () => {
  const venue = await createFromApi();
  const stale = venue.beerPrices.find((p) => p.type === "lata")!;
  const edited = venue.beerPrices.map((p) => (p.type === "lata" ? { ...p, priceBRL: 7 } : p));
  const upd = await runVenueWrite(pgClient(), "update_venue_and_prices", buildUpdateVenueArgs(venue.id, { happyHourDetails: "", beerPrices: edited }));
  assert.ok(upd.ok);

  const staleResult = await runVenueWrite(pgClient(), "confirm_beer_price", { p_venue_id: venue.id, p_price_id: stale.id });
  assert.deepEqual(staleResult, { ok: false, reason: "not_found" });

  const current = upd.venue.beerPrices.find((p) => p.type === "chope")!;
  await db.query("update public.beer_prices set updated_at = '2020-01-01Z' where id = $1", [current.id]);
  const ok = await runVenueWrite(pgClient(), "confirm_beer_price", { p_venue_id: venue.id, p_price_id: current.id });
  assert.ok(ok.ok);
  const confirmed = ok.venue.beerPrices.find((p) => p.id === current.id)!;
  assert.ok(new Date(confirmed.updatedAt!).getUTCFullYear() > 2020);
});

test("ratings: summaries map to numbers for the requested venues only", { skip }, async () => {
  const a = await createFromApi();
  const b = await createFromApi();
  await db.query(
    "insert into public.ratings (user_id, venue_id, score) values ($1, $3, 4), ($2, $3, 5), ($1, $4, 2)",
    [USER_A, USER_B, a.id, b.id]
  );
  const map = await fetchRatingSummaries(pgClient(), [a.id]);
  assert.deepEqual([...map.entries()], [[a.id, { avg: 4.5, count: 2 }]]);
});
