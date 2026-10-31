/**
 * Route handler tests with a fake Supabase client (no database, no network): auth and user
 * scoping of favorites/ratings, admin default-deny, price confirmation and the menu-photo
 * pipeline with a mocked AI Gateway. Run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerDeps } from "./common";
import { listFavorites, setFavorite, getRating, setRating } from "./social";
import { getReviewQueue, resolveReview } from "./admin";
import { confirmPrice } from "./confirm-price";
import { readMenuPhoto } from "./menu-photo";
import { MAX_MENU_PHOTO_BYTES } from "../menu-photo";

const VENUE = "11111111-2222-4333-8444-555555555555";
const PRICE = "22222222-3333-4444-8555-666666666666";
const ALICE = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "alice@example.com", email_confirmed_at: "2026-01-01" };
const BOB = { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "bob@example.com", email_confirmed_at: null };

type Op = { table: string; calls: [string, unknown[]][] };
type Result = { data: unknown; error: unknown };

/**
 * Minimal stand-in for the service-role client: tokens map to users, `rpc` answers per function,
 * and every `from(table)...` chain is recorded and resolved with `tableResult(op)`.
 */
function fakeDb(options: {
  users?: Record<string, typeof ALICE | typeof BOB>;
  rpc?: Record<string, (args: Record<string, unknown>) => Result>;
  tableResult?: (op: Op) => Result;
} = {}) {
  const ops: Op[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    auth: {
      async getUser(token: string) {
        const user = options.users?.[token] ?? null;
        return { data: { user }, error: user ? null : { message: "invalid" } };
      },
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "consume_write_rate_limits") {
        return options.rpc?.[fn]?.(args) ?? { data: { allowed: true, retry_after_seconds: 0 }, error: null };
      }
      return options.rpc?.[fn]?.(args) ?? { data: [], error: null };
    },
    from(table: string) {
      const op: Op = { table, calls: [] };
      ops.push(op);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "upsert", "delete", "update", "maybeSingle"]) {
        builder[m] = (...args: unknown[]) => {
          op.calls.push([m, args]);
          return builder;
        };
      }
      builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(options.tableResult?.(op) ?? { data: [], error: null }).then(resolve, reject);
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, ops, rpcCalls };
}

const deps = (db: SupabaseClient | null, env: Record<string, string | undefined> = {}, fetchImpl?: typeof fetch): HandlerDeps => ({
  db,
  env: { RATE_LIMIT_SALT: "salt", ...env },
  fetchImpl,
});

function req(method: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const body =
    options.body === undefined ? undefined : options.body instanceof Uint8Array ? options.body : JSON.stringify(options.body);
  return new Request("http://localhost/api", { method, headers, body: body as BodyInit | undefined });
}

const eqArgs = (op: Op) => op.calls.filter(([m]) => m === "eq").map(([, a]) => a);

// --- Favorites ----------------------------------------------------------------------------------

test("favorites need a valid token (401) and a configured backend (503)", async () => {
  const { db, ops } = fakeDb({ users: { "alice-token": ALICE } });
  assert.equal((await listFavorites(deps(db), req("GET"))).status, 401);
  assert.equal((await listFavorites(deps(db), req("GET", { token: "forged" }))).status, 401);
  assert.equal((await setFavorite(deps(db), req("PUT", { token: "forged" }), VENUE, true)).status, 401);
  assert.equal((await listFavorites(deps(null), req("GET", { token: "alice-token" }))).status, 503);
  assert.equal(ops.length, 0, "no table access without a verified user");
});

test("favorites are always scoped to the token's user", async () => {
  const { db, ops } = fakeDb({
    users: { "alice-token": ALICE, "bob-token": BOB },
    tableResult: () => ({
      data: [{ venues: { id: VENUE, name: "Bar", lat: -22, lng: -47, source: "user", beer_prices: [] } }],
      error: null,
    }),
  });
  const res = await listFavorites(deps(db), req("GET", { token: "bob-token" }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { venues: unknown[] }).venues.length, 1);
  assert.deepEqual(eqArgs(ops[0]), [["user_id", BOB.id]]);

  await setFavorite(deps(db), req("PUT", { token: "alice-token", body: { userId: BOB.id } }), VENUE, true);
  const upsert = ops[1].calls.find(([m]) => m === "upsert")!;
  assert.deepEqual(upsert[1][0], { user_id: ALICE.id, venue_id: VENUE }, "body user ids are ignored");

  await setFavorite(deps(db), req("DELETE", { token: "alice-token" }), VENUE, false);
  assert.deepEqual(eqArgs(ops[2]), [["user_id", ALICE.id], ["venue_id", VENUE]]);
});

test("favorites: invalid id 400, missing venue 404, rate limit 429 before any write", async () => {
  const { db, ops } = fakeDb({
    users: { t: ALICE },
    tableResult: () => ({ data: null, error: { code: "23503" } }),
  });
  assert.equal((await setFavorite(deps(db), req("PUT", { token: "t" }), "not-a-uuid", true)).status, 400);
  assert.equal((await setFavorite(deps(db), req("PUT", { token: "t" }), VENUE, true)).status, 404);
  const limited = fakeDb({
    users: { t: ALICE },
    rpc: { consume_write_rate_limits: () => ({ data: { allowed: false, retry_after_seconds: 30 }, error: null }) },
  });
  const res = await setFavorite(deps(limited.db), req("PUT", { token: "t" }), VENUE, true);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "30");
  assert.equal(limited.ops.length, 0);
  assert.equal(ops.length, 1);
});

// --- Ratings ------------------------------------------------------------------------------------

test("ratings validate the score, scope to the user and return the new aggregate", async () => {
  const { db, ops, rpcCalls } = fakeDb({
    users: { t: ALICE },
    rpc: { venue_rating_summaries: () => ({ data: [{ venue_id: VENUE, rating_avg: 4.5, rating_count: 4 }], error: null }) },
  });
  for (const score of [0, 6, 3.5, "5", null]) {
    assert.equal((await setRating(deps(db), req("PUT", { token: "t", body: { score } }), VENUE, false)).status, 400);
  }
  assert.equal(ops.length, 0);
  const res = await setRating(deps(db), req("PUT", { token: "t", body: { score: 5, userId: BOB.id } }), VENUE, false);
  assert.deepEqual(await res.json(), { score: 5, ratingAvg: 4.5, ratingCount: 4 });
  const row = ops[0].calls.find(([m]) => m === "upsert")![1][0] as Record<string, unknown>;
  assert.equal(row.user_id, ALICE.id);
  assert.equal(row.venue_id, VENUE);
  assert.equal(row.score, 5);
  assert.deepEqual(rpcCalls.at(-1), { fn: "venue_rating_summaries", args: { p_venue_ids: [VENUE] } });

  const del = await setRating(deps(db), req("DELETE", { token: "t" }), VENUE, true);
  assert.equal(((await del.json()) as { score: unknown }).score, null);
  assert.deepEqual(eqArgs(ops[1]), [["user_id", ALICE.id], ["venue_id", VENUE]]);

  await getRating(deps(db), req("GET", { token: "t" }), VENUE);
  assert.deepEqual(eqArgs(ops[2]), [["user_id", ALICE.id], ["venue_id", VENUE]]);
});

test("ratings: login required and kill switch respected", async () => {
  const { db } = fakeDb({ users: { t: ALICE } });
  assert.equal((await setRating(deps(db), req("PUT", { body: { score: 4 } }), VENUE, false)).status, 401);
  assert.equal((await getRating(deps(db), req("GET"), VENUE)).status, 401);
  const prod = { NODE_ENV: "production" };
  assert.equal((await setRating(deps(db, prod), req("PUT", { token: "t", body: { score: 4 } }), VENUE, false)).status, 403);
  assert.equal(
    (await setRating(deps(db, { ...prod, USER_EDITS_ENABLED: "true" }), req("PUT", { token: "t", body: { score: 4 } }), VENUE, false)).status,
    200
  );
});

// --- Admin --------------------------------------------------------------------------------------

test("admin routes deny by default, deny unconfirmed e-mails and allow listed moderators", async () => {
  const { db, ops } = fakeDb({
    users: { alice: ALICE, bob: BOB },
    tableResult: (op) =>
      op.calls.some(([m]) => m === "update") ? { data: [{ id: VENUE }], error: null } : { data: [], error: null },
  });
  assert.equal((await getReviewQueue(deps(db), req("GET", { token: "alice" }))).status, 403, "ADMIN_EMAILS unset");
  const env = { ADMIN_EMAILS: "ALICE@example.com,bob@example.com" };
  assert.equal((await getReviewQueue(deps(db, env), req("GET"))).status, 403);
  assert.equal((await getReviewQueue(deps(db, env), req("GET", { token: "bob" }))).status, 403, "unconfirmed");
  assert.equal(
    (await resolveReview(deps(db, env), req("POST", { token: "bob", body: { action: "verify" } }), VENUE)).status,
    403
  );
  assert.equal(ops.length, 0, "no table access before the admin check passes");

  assert.equal((await getReviewQueue(deps(db, env), req("GET", { token: "alice" }))).status, 200);
  assert.deepEqual(eqArgs(ops[0]), [["needs_review", true]]);
  assert.equal(
    (await resolveReview(deps(db, env), req("POST", { token: "alice", body: { action: "nuke" } }), VENUE)).status,
    400
  );
  const ok = await resolveReview(deps(db, env), req("POST", { token: "alice", body: { action: "verify" } }), VENUE);
  assert.equal(ok.status, 200);
  const update = ops[1].calls.find(([m]) => m === "update")!;
  assert.deepEqual(update[1][0], { needs_review: false, prices_unverified: false });
  await resolveReview(deps(db, env), req("POST", { token: "alice", body: { action: "dismiss" } }), VENUE);
  assert.deepEqual(ops[2].calls.find(([m]) => m === "update")![1][0], { needs_review: false });
});

test("admin resolve answers 404 when no venue was updated", async () => {
  const { db } = fakeDb({ users: { alice: ALICE }, tableResult: () => ({ data: [], error: null }) });
  const res = await resolveReview(
    deps(db, { ADMIN_EMAILS: "alice@example.com" }),
    req("POST", { token: "alice", body: { action: "dismiss" } }),
    VENUE
  );
  assert.equal(res.status, 404);
});

// --- Price confirmation -------------------------------------------------------------------------

const VENUE_PAYLOAD = {
  venue: { id: VENUE, name: "Bar", lat: -22, lng: -47, source: "user", has_happy_hour: false, created_at: "x" },
  beer_prices: [
    { id: PRICE, venue_id: VENUE, type: "lata", label: "Skol", price_brl: 5, volume_ml: null, created_at: "x", updated_at: "2026-10-31T00:00:00Z" },
  ],
};

test("confirmPrice validates ids, rate-limits per IP and venue, and maps stale ids to 404", async () => {
  const { db, rpcCalls } = fakeDb({
    rpc: { confirm_beer_price: (args) => ({ data: args.p_price_id === PRICE ? VENUE_PAYLOAD : null, error: null }) },
  });
  assert.equal((await confirmPrice(deps(db), req("POST", { body: { priceId: "x" } }), VENUE)).status, 400);
  assert.equal((await confirmPrice(deps(db), req("POST", { body: { priceId: PRICE } }), "bad")).status, 400);
  assert.equal(rpcCalls.length, 0);

  const res = await confirmPrice(
    deps(db),
    req("POST", { body: { priceId: PRICE }, headers: { "x-forwarded-for": "1.2.3.4" } }),
    VENUE
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { venue: { beerPrices: { id: string; updatedAt: string }[] } };
  assert.equal(body.venue.beerPrices[0].id, PRICE);
  assert.equal(body.venue.beerPrices[0].updatedAt, "2026-10-31T00:00:00Z");
  const limits = rpcCalls[0].args.p_checks as { bucket: string }[];
  assert.deepEqual(limits.map((c) => c.bucket), ["price_confirm_ip", "price_confirm_ip_venue"]);
  assert.deepEqual(rpcCalls[1], { fn: "confirm_beer_price", args: { p_venue_id: VENUE, p_price_id: PRICE } });

  const stale = await confirmPrice(deps(db), req("POST", { body: { priceId: "33333333-3333-4444-8555-666666666666" } }), VENUE);
  assert.equal(stale.status, 404);
});

test("confirmPrice fails closed when the rate limit can't be checked", async (t) => {
  t.mock.method(console, "error", () => {});
  const { db, rpcCalls } = fakeDb({
    rpc: { consume_write_rate_limits: () => ({ data: null, error: { code: "XX000" } }) },
  });
  assert.equal((await confirmPrice(deps(db), req("POST", { body: { priceId: PRICE } }), VENUE)).status, 500);
  assert.deepEqual(rpcCalls.map((c) => c.fn), ["consume_write_rate_limits"]);
});

// --- Menu photo ---------------------------------------------------------------------------------

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function gateway(content: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const photoEnv = { AI_GATEWAY_API_KEY: "gw-key" };
const photoReq = (body: Uint8Array, type = "image/jpeg", token = "t") =>
  req("POST", { token, body, headers: { "content-type": type } });

test("menu photo: 503 without key, 401 without login, never calling the gateway", async () => {
  const { db } = fakeDb({ users: { t: ALICE } });
  const gw = gateway("{}");
  assert.equal((await readMenuPhoto(deps(db, {}, gw.fetchImpl), photoReq(JPEG))).status, 503);
  assert.equal((await readMenuPhoto(deps(null, photoEnv, gw.fetchImpl), photoReq(JPEG))).status, 503);
  assert.equal((await readMenuPhoto(deps(db, photoEnv, gw.fetchImpl), photoReq(JPEG, "image/jpeg", "bad"))).status, 401);
  assert.equal(gw.calls.length, 0);
});

test("menu photo: wrong declared type, mismatched bytes and oversized bodies are rejected", async () => {
  const { db, rpcCalls } = fakeDb({ users: { t: ALICE } });
  const gw = gateway("{}");
  const d = deps(db, photoEnv, gw.fetchImpl);
  assert.equal((await readMenuPhoto(d, photoReq(JPEG, "image/gif"))).status, 415);
  assert.equal((await readMenuPhoto(d, photoReq(PNG, "image/jpeg"))).status, 415, "bytes must match the type");
  assert.equal((await readMenuPhoto(d, photoReq(new TextEncoder().encode("<svg/>"), "image/png"))).status, 415);
  const big = new Uint8Array(MAX_MENU_PHOTO_BYTES + 1);
  big.set(JPEG);
  assert.equal((await readMenuPhoto(d, photoReq(big))).status, 413, "real size checked, not only Content-Length");
  assert.equal(gw.calls.length, 0);
  assert.equal(rpcCalls.length, 0, "invalid uploads don't consume the paid budget");
});

test("menu photo: rate limits (user, IP, global daily) are checked before the paid call", async () => {
  const { db, rpcCalls } = fakeDb({
    users: { t: ALICE },
    rpc: { consume_write_rate_limits: () => ({ data: { allowed: false, retry_after_seconds: 600 }, error: null }) },
  });
  const gw = gateway("{}");
  const res = await readMenuPhoto(deps(db, { ...photoEnv, MENU_PHOTO_DAILY_LIMIT: "7" }, gw.fetchImpl), photoReq(JPEG));
  assert.equal(res.status, 429);
  const checks = rpcCalls[0].args.p_checks as { bucket: string; max_hits: number }[];
  assert.deepEqual(checks.map((c) => c.bucket), ["menu_photo_user", "menu_photo_ip", "menu_photo_global"]);
  assert.equal(checks[2].max_hits, 7);
  assert.equal(gw.calls.length, 0);
});

test("menu photo: sends one structured-output request and returns only valid prices", async () => {
  const { db } = fakeDb({ users: { t: ALICE } });
  const gw = gateway(
    JSON.stringify({
      prices: [
        { type: "chope", brand: "Brahma", priceBRL: 9.9, volumeMl: 300 },
        { type: "vinho", brand: "Tinto", priceBRL: 30, volumeMl: null },
        { type: "lata", brand: "Skol", priceBRL: -1, volumeMl: null },
        { type: "long_neck", brand: "Heineken", priceBRL: 12.5, volumeMl: null },
      ],
    })
  );
  const res = await readMenuPhoto(deps(db, { ...photoEnv, MENU_PHOTO_MODEL: "test/model" }, gw.fetchImpl), photoReq(JPEG));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    prices: [
      { type: "chope", label: "Brahma", priceBRL: 9.9, volumeMl: 300 },
      { type: "long_neck", label: "Heineken", priceBRL: 12.5 },
    ],
  });
  assert.equal(gw.calls.length, 1);
  assert.equal(gw.calls[0].url, "https://ai-gateway.vercel.sh/v1/chat/completions");
  assert.equal((gw.calls[0].init.headers as Record<string, string>).Authorization, "Bearer gw-key");
  const sent = JSON.parse(String(gw.calls[0].init.body));
  assert.equal(sent.model, "test/model");
  assert.equal(sent.response_format.type, "json_schema");
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.ok(sent.max_tokens > 0);
  assert.match(sent.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test("menu photo: gateway errors, bad JSON and timeouts map to 502/504", async (t) => {
  t.mock.method(console, "error", () => {});
  const { db } = fakeDb({ users: { t: ALICE } });
  assert.equal((await readMenuPhoto(deps(db, photoEnv, gateway("{}", 500).fetchImpl), photoReq(JPEG))).status, 502);
  assert.equal((await readMenuPhoto(deps(db, photoEnv, gateway("not json").fetchImpl), photoReq(JPEG))).status, 502);
  assert.equal((await readMenuPhoto(deps(db, photoEnv, gateway('{"items":[]}').fetchImpl), photoReq(JPEG))).status, 502);
  const timeout = (async () => {
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  }) as typeof fetch;
  assert.equal((await readMenuPhoto(deps(db, photoEnv, timeout), photoReq(JPEG))).status, 504);
  const empty = await readMenuPhoto(deps(db, photoEnv, gateway('{"prices":[]}').fetchImpl), photoReq(JPEG));
  assert.deepEqual(await empty.json(), { prices: [] });
});
