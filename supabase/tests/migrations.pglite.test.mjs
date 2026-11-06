// Applies every supabase/migrations/*.sql file, in order, to a disposable in-memory Postgres
// (PGlite, no server) with a minimal Supabase bootstrap (anon / authenticated / service_role
// roles, auth.users, auth.uid() and Supabase's default grants), then checks the database
// invariants the API relies on: RLS and grants, RPC permissions, atomic writes and price
// freshness. It never connects to a real database.
//
// PGlite is not a project dependency. Install it anywhere outside the repo and point to it:
//   npm install --prefix <dir> @electric-sql/pglite
//   npm run test:db

import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  SKIP_REASON as skip,
  USER_A,
  USER_B,
  asRole as asRoleIn,
  migrationFiles,
  openMigratedDb,
  readMigration,
} from "./pglite-db.mjs";

// Functions the browser (anon/authenticated) may call directly through PostgREST. Everything
// else in public must be service_role only.
const CLIENT_CALLABLE_FUNCTIONS = new Set([]);

// Every SQL function that the API calls must exist with service_role EXECUTE.
const REQUIRED_RPCS = ["create_venue_with_prices", "update_venue_and_prices", "confirm_beer_price", "venue_rating_summaries"];

const OLD_TS = "2020-01-01T00:00:00+00:00";

let db;

async function rows(sql, params) {
  return (await db.query(sql, params)).rows;
}

const asRole = (role, sub, fn) => asRoleIn(db, role, sub, fn);

async function createVenue(prices, extra = {}) {
  const result = await asRole("service_role", null, () =>
    rows(
      `select public.create_venue_with_prices(
         p_name => 'Bar Teste', p_address => 'Rua A, 1', p_neighborhood => 'Centro',
         p_city => 'São Carlos', p_state => 'SP', p_lat => -22.0, p_lng => -47.9,
         p_prices => $1::jsonb, p_created_by => $2::uuid ${extra.sql ?? ""}) as r`,
      [JSON.stringify(prices), USER_A]
    )
  );
  return result[0].r;
}

async function updateVenue(venueId, args) {
  const names = Object.keys(args);
  const sql = `select public.update_venue_and_prices(p_venue_id => $1::uuid${names
    .map((n, i) => `, ${n} => $${i + 2}`)
    .join("")}) as r`;
  const values = names.map((n) => (n === "p_prices" ? JSON.stringify(args[n]) : args[n]));
  return (await asRole("service_role", null, () => rows(sql, [venueId, ...values])))[0].r;
}

async function confirmPrice(venueId, priceId) {
  return (
    await asRole("service_role", null, () =>
      rows("select public.confirm_beer_price($1::uuid, $2::uuid) as r", [venueId, priceId])
    )
  )[0].r;
}

async function pricesOf(venueId) {
  return rows(
    "select id, type, label, price_brl::text as price, volume_ml, updated_at from public.beer_prices where venue_id = $1 order by label",
    [venueId]
  );
}

const CHOPE = { type: "chope", label: "Chope Pilsen", price_brl: 12.5, volume_ml: 300 };
const LATA = { type: "lata", label: "Lata Original", price_brl: 8, volume_ml: 350 };

before(async () => {
  if (skip) return;
  db = await openMigratedDb();
});

test("latest migration can be re-applied", { skip }, async () => {
  const latest = migrationFiles.at(-1);
  await db.exec(readMigration(latest));
});

test("every public table has RLS on and no TRUNCATE for browser roles", { skip }, async () => {
  const tables = await rows(
    `select c.relname, c.relrowsecurity,
       (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')`
  );
  assert.ok(tables.length > 0);
  for (const t of tables) {
    assert.equal(t.relrowsecurity, true, `RLS disabled on public.${t.relname}`);
    for (const role of ["anon", "authenticated"]) {
      const [{ truncate }] = await rows(
        `select has_table_privilege($1, $2, 'TRUNCATE') as truncate`,
        [role, `public.${t.relname}`]
      );
      assert.equal(truncate, false, `${role} can TRUNCATE public.${t.relname}`);
    }
  }
});

test("tables without policies are fully closed to anon and authenticated", { skip }, async () => {
  const tables = await rows(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)`
  );
  await createVenue([CHOPE]);
  for (const { relname } of tables) {
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const [{ ok }] = await rows(`select has_table_privilege($1, $2, $3) as ok`, [
          role,
          `public.${relname}`,
          priv,
        ]);
        assert.equal(ok, false, `${role} has ${priv} on public.${relname}`);
      }
      await asRole(role, role === "authenticated" ? USER_A : null, () =>
        assert.rejects(rows(`select * from public.${relname} limit 1`), /permission denied/)
      );
    }
  }
});

test("public functions are service_role only (unless allow-listed)", { skip }, async () => {
  const fns = await rows(
    `select p.oid::regprocedure::text as sig, p.proname, p.prosecdef, p.proconfig
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'`
  );
  assert.ok(fns.length > 0);
  for (const f of fns) {
    const [{ anon, authed, service }] = await rows(
      `select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as authed,
              has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as service`,
      [f.sig]
    );
    if (!CLIENT_CALLABLE_FUNCTIONS.has(f.proname)) {
      assert.equal(anon, false, `anon can execute ${f.sig}`);
      assert.equal(authed, false, `authenticated can execute ${f.sig}`);
    }
    assert.equal(service, true, `service_role cannot execute ${f.sig}`);
    if (f.prosecdef) {
      assert.ok(
        (f.proconfig ?? []).some((c) => c.startsWith("search_path=")),
        `SECURITY DEFINER ${f.sig} has no fixed search_path`
      );
    }
  }
});

test("only the latest signature of each write RPC exists", { skip }, async () => {
  for (const name of REQUIRED_RPCS) {
    const overloads = await rows(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [name]
    );
    assert.equal(overloads.length, 1, `${name} overloads: ${overloads.map((o) => o.sig).join("; ")}`);
  }
});

test("browser roles cannot call write RPCs", { skip }, async () => {
  const venue = await createVenue([CHOPE]);
  const priceId = venue.beer_prices[0].id;
  for (const role of ["anon", "authenticated"]) {
    await asRole(role, role === "authenticated" ? USER_A : null, async () => {
      await assert.rejects(
        rows("select public.confirm_beer_price($1::uuid, $2::uuid)", [venue.venue.id, priceId]),
        /permission denied/
      );
      await assert.rejects(
        rows("select public.update_venue_and_prices(p_venue_id => $1::uuid, p_replace_prices => true, p_prices => '[]'::jsonb)", [
          venue.venue.id,
        ]),
        /permission denied/
      );
    });
  }
});

test("new prices get updated_at; existing rows were backfilled", { skip }, async () => {
  const venue = await createVenue([CHOPE, LATA]);
  for (const p of venue.beer_prices) assert.ok(p.updated_at, "updated_at missing on new price");
  const [{ missing }] = await rows("select count(*)::int as missing from public.beer_prices where updated_at is null");
  assert.equal(missing, 0);
});

test("replacing prices keeps the timestamp of unchanged prices and resets changed ones", { skip }, async () => {
  const venue = await createVenue([CHOPE, LATA]);
  const venueId = venue.venue.id;
  await rows("update public.beer_prices set updated_at = $2 where venue_id = $1", [venueId, OLD_TS]);

  const result = await updateVenue(venueId, {
    p_replace_prices: true,
    p_prices: [CHOPE, { ...LATA, price_brl: 9 }],
  });
  assert.equal(result.beer_prices.length, 2);
  const after = await pricesOf(venueId);
  const chope = after.find((p) => p.label === CHOPE.label);
  const lata = after.find((p) => p.label === LATA.label);
  assert.equal(new Date(chope.updated_at).toISOString(), new Date(OLD_TS).toISOString(), "unchanged price lost its timestamp");
  assert.ok(new Date(lata.updated_at) > new Date(OLD_TS), "changed price kept the old timestamp");
  assert.equal(lata.price, "9.00");

  // Edits that do not touch prices leave every price timestamp alone.
  await updateVenue(venueId, { p_update_happy_hour: true, p_has_happy_hour: true, p_happy_hour_details: "18h" });
  const again = await pricesOf(venueId);
  assert.deepEqual(
    again.map((p) => [p.id, new Date(p.updated_at).toISOString()]),
    after.map((p) => [p.id, new Date(p.updated_at).toISOString()])
  );
});

test("a changed volume counts as a changed price", { skip }, async () => {
  const venue = await createVenue([CHOPE]);
  await rows("update public.beer_prices set updated_at = $2 where venue_id = $1", [venue.venue.id, OLD_TS]);
  await updateVenue(venue.venue.id, { p_replace_prices: true, p_prices: [{ ...CHOPE, volume_ml: 500 }] });
  const [p] = await pricesOf(venue.venue.id);
  assert.ok(new Date(p.updated_at) > new Date(OLD_TS));
});

test("confirming a price bumps only that price", { skip }, async () => {
  const venue = await createVenue([CHOPE, LATA]);
  const venueId = venue.venue.id;
  await rows("update public.beer_prices set updated_at = $2 where venue_id = $1", [venueId, OLD_TS]);
  const target = (await pricesOf(venueId)).find((p) => p.label === CHOPE.label);

  const result = await confirmPrice(venueId, target.id);
  assert.ok(result, "confirm returned null for a current price");
  const after = await pricesOf(venueId);
  for (const p of after) {
    if (p.id === target.id) assert.ok(new Date(p.updated_at) > new Date(OLD_TS), "confirmed price not bumped");
    else assert.equal(new Date(p.updated_at).toISOString(), new Date(OLD_TS).toISOString(), "other price bumped");
  }
  const returned = result.beer_prices.find((p) => p.id === target.id);
  assert.ok(new Date(returned.updated_at) > new Date(OLD_TS), "payload does not reflect the confirmation");
});

test("stale, foreign and unknown ids cannot confirm anything", { skip }, async () => {
  const venue = await createVenue([CHOPE]);
  const other = await createVenue([LATA]);
  const venueId = venue.venue.id;
  const staleId = venue.beer_prices[0].id;

  await updateVenue(venueId, { p_replace_prices: true, p_prices: [{ ...CHOPE, price_brl: 14 }] });
  await rows("update public.beer_prices set updated_at = $1", [OLD_TS]);
  const snapshot = await rows("select id, updated_at from public.beer_prices order by id");

  assert.equal(await confirmPrice(venueId, staleId), null, "stale price id confirmed the replacement");
  assert.equal(await confirmPrice(venueId, other.beer_prices[0].id), null, "price of another venue confirmed");
  assert.equal(await confirmPrice(other.venue.id, (await pricesOf(venueId))[0].id), null, "cross-venue confirm");
  assert.equal(await confirmPrice("00000000-0000-4000-8000-0000000000ff", staleId), null);
  assert.deepEqual(await rows("select id, updated_at from public.beer_prices order by id"), snapshot);
});

test("invalid replacement is atomic: nothing changes", { skip }, async () => {
  const venue = await createVenue([CHOPE]);
  const venueId = venue.venue.id;
  const before = await pricesOf(venueId);
  const [venueBefore] = await rows("select * from public.venues where id = $1", [venueId]);

  for (const bad of [[{ ...CHOPE, price_brl: -1 }], [{ ...CHOPE, type: "barril" }], [CHOPE, { ...LATA, label: null }]]) {
    await assert.rejects(
      updateVenue(venueId, {
        p_update_happy_hour: true,
        p_has_happy_hour: true,
        p_happy_hour_details: "should roll back",
        p_replace_prices: true,
        p_prices: bad,
      })
    );
  }
  await assert.rejects(updateVenue(venueId, { p_replace_prices: true, p_prices: [] }), /non-empty/);
  assert.deepEqual(await pricesOf(venueId), before);
  assert.deepEqual(await rows("select * from public.venues where id = $1", [venueId]), [venueBefore]);
});

test("invalid creation leaves no orphan venue", { skip }, async () => {
  const [{ n: before }] = await rows("select count(*)::int as n from public.venues");
  await assert.rejects(createVenue([{ ...CHOPE, price_brl: -5 }]));
  await assert.rejects(createVenue([]));
  const [{ n: after }] = await rows("select count(*)::int as n from public.venues");
  assert.equal(after, before);
});

test("venue attributes: absent keys keep, JSON null clears, bad input rolls back", { skip }, async () => {
  const venue = await createVenue([CHOPE], {
    sql: `, p_attributes => '{"transmits_football": true, "opening_hours": {"mon": [["18:00", "23:00"]]}}'::jsonb`,
  });
  const venueId = venue.venue.id;
  assert.equal(venue.venue.transmits_football, true);
  assert.equal(venue.venue.accepts_reservations, null);
  assert.deepEqual(venue.venue.opening_hours, { mon: [["18:00", "23:00"]] });

  const kept = await updateVenue(venueId, { p_attributes: JSON.stringify({ accepts_reservations: false }) });
  assert.equal(kept.venue.transmits_football, true, "absent attribute overwrote the stored value");
  assert.equal(kept.venue.accepts_reservations, false);

  const cleared = await updateVenue(venueId, { p_attributes: JSON.stringify({ transmits_football: null, opening_hours: null }) });
  assert.equal(cleared.venue.transmits_football, null, "JSON null did not clear");
  assert.equal(cleared.venue.opening_hours, null);

  const [snapshot] = await rows("select * from public.venues where id = $1", [venueId]);
  const pricesBefore = await pricesOf(venueId);
  for (const bad of [{ transmits_football: "yes" }, { opening_hours: [] }, { is_admin: true }, []]) {
    await assert.rejects(
      updateVenue(venueId, {
        p_replace_prices: true,
        p_prices: [{ ...CHOPE, price_brl: 99 }],
        p_attributes: JSON.stringify(bad),
      }),
      /22023|attribute|json object/
    );
  }
  assert.deepEqual(await rows("select * from public.venues where id = $1", [venueId]), [snapshot]);
  assert.deepEqual(await pricesOf(venueId), pricesBefore);
  await assert.rejects(createVenue([CHOPE], { sql: `, p_attributes => '{"opening_hours": "24h"}'::jsonb` }));
});

test("attribute-free, price-free update does not mark the venue as edited", { skip }, async () => {
  const venue = await createVenue([CHOPE]);
  await rows("update public.venues set prices_unverified = false, last_edited_at = null where id = $1", [venue.venue.id]);
  const r = await updateVenue(venue.venue.id, {});
  assert.equal(r.venue.prices_unverified, false);
  assert.equal(r.venue.last_edited_at, null);
});

test("resubmitting identical prices and happy hour does not mark the venue as edited", { skip }, async () => {
  const venue = await createVenue([CHOPE, LATA]);
  const id = venue.venue.id;
  await rows("update public.venues set prices_unverified = false, last_edited_at = null where id = $1", [id]);
  const same = await updateVenue(id, {
    p_update_happy_hour: true,
    p_has_happy_hour: false,
    p_replace_prices: true,
    p_prices: [LATA, CHOPE],
  });
  assert.equal(same.venue.prices_unverified, false);
  assert.equal(same.venue.last_edited_at, null);
  const changed = await updateVenue(id, { p_update_happy_hour: true, p_has_happy_hour: true, p_happy_hour_details: "18h" });
  assert.equal(changed.venue.prices_unverified, true);
  assert.notEqual(changed.venue.last_edited_at, null);
});

test("unchanged prices keep their id; duplicates are matched one-to-one", { skip }, async () => {
  const venue = await createVenue([CHOPE, LATA]);
  const venueId = venue.venue.id;
  const ids = Object.fromEntries((await pricesOf(venueId)).map((p) => [p.label, p.id]));
  await updateVenue(venueId, { p_replace_prices: true, p_prices: [CHOPE, CHOPE, { ...LATA, price_brl: 10 }] });
  const after = await pricesOf(venueId);
  const chopes = after.filter((p) => p.label === CHOPE.label);
  assert.equal(chopes.length, 2, "duplicate incoming price collapsed");
  assert.equal(chopes.filter((p) => p.id === ids[CHOPE.label]).length, 1, "unchanged price lost its id");
  assert.ok(!after.some((p) => p.id === ids[LATA.label]), "changed price kept its old id");
  assert.equal(after.length, 3);
  // A confirmation for the kept id still works after the edit.
  assert.ok(await confirmPrice(venueId, ids[CHOPE.label]));
});

test("favorites and ratings: constraints, cascades, summaries", { skip }, async () => {
  const v1 = (await createVenue([CHOPE])).venue.id;
  const v2 = (await createVenue([CHOPE])).venue.id;
  await rows("insert into public.favorites (user_id, venue_id) values ($1, $2), ($3, $2)", [USER_A, v1, USER_B]);
  await assert.rejects(rows("insert into public.favorites (user_id, venue_id) values ($1, $2)", [USER_A, v1]), /duplicate/);
  for (const score of [0, 6]) {
    await assert.rejects(
      rows("insert into public.ratings (user_id, venue_id, score) values ($1, $2, $3)", [USER_A, v2, score]),
      /check/
    );
  }
  await rows("insert into public.ratings (user_id, venue_id, score) values ($1, $2, 5), ($3, $2, 4), ($1, $4, 1)", [
    USER_A,
    v1,
    USER_B,
    v2,
  ]);
  await assert.rejects(
    rows("insert into public.ratings (user_id, venue_id, score) values ($1, $2, 3)", [USER_A, v1]),
    /duplicate/
  );
  const summaries = await asRole("service_role", null, () =>
    rows("select venue_id, rating_avg::text as avg, rating_count from public.venue_rating_summaries($1::uuid[]) order by rating_count desc", [[v1, v2]])
  );
  assert.deepEqual(summaries, [
    { venue_id: v1, avg: "4.5", rating_count: 2 },
    { venue_id: v2, avg: "1.0", rating_count: 1 },
  ]);
  const onlyV2 = await asRole("service_role", null, () =>
    rows("select venue_id from public.venue_rating_summaries($1::uuid[])", [[v2]])
  );
  assert.deepEqual(onlyV2, [{ venue_id: v2 }]);

  // Browser roles get nothing even for their own rows (no policies).
  await asRole("authenticated", USER_A, () =>
    assert.rejects(rows("select * from public.ratings where user_id = auth.uid()"), /permission denied/)
  );

  await rows("delete from public.venues where id = $1", [v1]);
  const [{ f, r }] = await rows(
    "select (select count(*)::int from public.favorites where venue_id = $1) as f, (select count(*)::int from public.ratings where venue_id = $1) as r",
    [v1]
  );
  assert.deepEqual({ f, r }, { f: 0, r: 0 });
  await rows("delete from auth.users where id = $1", [USER_B]);
  const [{ n }] = await rows("select count(*)::int as n from public.favorites where user_id = $1", [USER_B]);
  assert.equal(n, 0);
  await rows("insert into auth.users (id, email) values ($1, 'b@example.test')", [USER_B]);
});

test("update of a missing venue returns null and writes nothing", { skip }, async () => {
  const [{ n: before }] = await rows("select count(*)::int as n from public.beer_prices");
  const r = await updateVenue("00000000-0000-4000-8000-0000000000ee", { p_replace_prices: true, p_prices: [CHOPE] });
  assert.equal(r, null);
  const [{ n: after }] = await rows("select count(*)::int as n from public.beer_prices");
  assert.equal(after, before);
});

test("upgrade from the previous migration backfills updated_at from created_at", { skip }, async () => {
  const old = await openMigratedDb(migrationFiles.length - 1);
  try {
    await old.exec(`
      insert into public.venues (id, name, lat, lng, source) values ('10000000-0000-4000-8000-000000000001', 'Antigo', -22, -47, 'osm');
      insert into public.beer_prices (venue_id, type, label, price_brl, created_at)
        values ('10000000-0000-4000-8000-000000000001', 'chope', 'Chope', 10, '${OLD_TS}');
    `);
    await old.exec(readMigration(migrationFiles.at(-1)));
    const [p] = (await old.query("select created_at, updated_at from public.beer_prices")).rows;
    assert.equal(new Date(p.updated_at).toISOString(), new Date(OLD_TS).toISOString());
    const [v] = (await old.query("select * from public.venues")).rows;
    for (const col of ["transmits_football", "accepts_reservations", "has_outdoor_area", "opening_hours"]) {
      assert.ok(col in v, `venues.${col} missing after upgrade`);
      assert.equal(v[col], null, `venues.${col} is not unknown (null) for existing rows`);
    }
  } finally {
    await old.close();
  }
});

test("a real price correction clears needs_review; same prices, attributes or confirmation do not", { skip }, async () => {
  const venue = await createVenue([CHOPE, LATA]);
  const venueId = venue.venue.id;
  const flag = () => asRole("service_role", null, () => rows("select public.flag_venue_for_review($1::uuid)", [venueId]));
  const needsReview = async () =>
    (await rows("select needs_review from public.venues where id = $1", [venueId]))[0].needs_review;

  await flag();
  await updateVenue(venueId, { p_replace_prices: true, p_prices: [LATA, CHOPE] });
  assert.equal(await needsReview(), true, "re-saving the same prices is not a correction");
  await updateVenue(venueId, { p_attributes: JSON.stringify({ transmits_football: true }) });
  assert.equal(await needsReview(), true, "attribute edits do not answer a price report");
  await confirmPrice(venueId, (await pricesOf(venueId))[0].id);
  assert.equal(await needsReview(), true, "confirming does not clear a report");

  await updateVenue(venueId, { p_replace_prices: true, p_prices: [{ ...CHOPE, price_brl: 13 }, LATA] });
  assert.equal(await needsReview(), false, "changed price clears the report");
  await flag();
  await updateVenue(venueId, { p_replace_prices: true, p_prices: [LATA] });
  assert.equal(await needsReview(), false, "removing a price is a correction too");
});
