/**
 * Tests for the write guards (no database, no network): run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { RpcClient } from "./venue-writes";
import {
  RATE_LIMITS,
  authenticateRequest,
  bearerToken,
  clientIp,
  consumeRateLimits,
  createRateLimitChecks,
  hashRateLimitKey,
  rateLimitSalt,
  reportRateLimitChecks,
  updateRateLimitChecks,
  type AuthClient,
} from "./write-guards";

const VENUE_ID = "11111111-2222-4333-8444-555555555555";
const SALT = "test-salt";

function headers(values: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

function silenceConsoleError(t: { mock: { method: (obj: object, name: string, impl: () => void) => unknown } }) {
  t.mock.method(console, "error", () => {});
}

// --- IP extraction and hashing -----------------------------------------------------------------

test("clientIp uses the first x-forwarded-for entry", () => {
  assert.equal(clientIp(headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1, 10.0.0.2" })), "203.0.113.7");
});

test("clientIp falls back to x-real-ip, then to 'unknown'", () => {
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(clientIp(headers({ "x-forwarded-for": " , ", "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(clientIp(headers({})), "unknown");
  assert.equal(clientIp(headers({ "x-real-ip": "  " })), "unknown");
});

test("rateLimitSalt prefers RATE_LIMIT_SALT, then the service role key", () => {
  assert.equal(rateLimitSalt({ RATE_LIMIT_SALT: " s1 ", SUPABASE_SERVICE_ROLE_KEY: "k" }), "s1");
  assert.equal(rateLimitSalt({ SUPABASE_SERVICE_ROLE_KEY: "k" }), "k");
  assert.equal(rateLimitSalt({}), "");
});

test("hashRateLimitKey is a salted, deterministic SHA-256 hex digest", () => {
  const hash = hashRateLimitKey(SALT, "203.0.113.7");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashRateLimitKey(SALT, "203.0.113.7"));
  assert.notEqual(hash, hashRateLimitKey("other-salt", "203.0.113.7"));
  assert.notEqual(hash, createHash("sha256").update("203.0.113.7").digest("hex"), "must be salted");
});

test("rate limit checks never contain the raw IP, venue id or user id", () => {
  const ip = "203.0.113.7";
  const userId = "99999999-8888-4777-8666-555555555555";
  const checks = [
    ...updateRateLimitChecks(ip, VENUE_ID, SALT),
    ...createRateLimitChecks(ip, userId, SALT),
    ...reportRateLimitChecks(ip, SALT),
  ];
  const serialized = JSON.stringify(checks);
  assert.ok(!serialized.includes(ip));
  assert.ok(!serialized.includes(VENUE_ID));
  assert.ok(!serialized.includes(userId));
  for (const c of checks) assert.match(c.key_hash, /^[0-9a-f]{64}$/);
});

test("PATCH limits: 10 per 10 min per IP and 3 per 10 min per (IP, venue)", () => {
  const [perIp, perVenue] = updateRateLimitChecks("203.0.113.7", VENUE_ID, SALT);
  assert.deepEqual(
    { bucket: perIp.bucket, max: perIp.max_hits, window: perIp.window_seconds },
    { bucket: "venue_update_ip", max: 10, window: 600 }
  );
  assert.deepEqual(
    { bucket: perVenue.bucket, max: perVenue.max_hits, window: perVenue.window_seconds },
    { bucket: "venue_update_ip_venue", max: 3, window: 600 }
  );
  // Different venues get different per-venue keys; the per-IP key is shared.
  const [perIpB, perVenueB] = updateRateLimitChecks("203.0.113.7", "aaaaaaaa-2222-4333-8444-555555555555", SALT);
  assert.equal(perIp.key_hash, perIpB.key_hash);
  assert.notEqual(perVenue.key_hash, perVenueB.key_hash);
  // Venue id casing doesn't open a second bucket.
  assert.equal(
    perVenue.key_hash,
    updateRateLimitChecks("203.0.113.7", VENUE_ID.toUpperCase(), SALT)[1].key_hash
  );
});

test("POST limits: 5 per hour per user and per IP; report: 5 per 10 min per IP", () => {
  const [perUser, perIp] = createRateLimitChecks("203.0.113.7", "user-1", SALT);
  assert.equal(perUser.bucket, RATE_LIMITS.createPerUser.bucket);
  assert.equal(perUser.max_hits, 5);
  assert.equal(perUser.window_seconds, 3600);
  assert.equal(perIp.bucket, RATE_LIMITS.createPerIp.bucket);
  assert.equal(perIp.max_hits, 5);
  assert.equal(perIp.window_seconds, 3600);

  const [report] = reportRateLimitChecks("203.0.113.7", SALT);
  assert.equal(report.bucket, "venue_report_ip");
  assert.equal(report.max_hits, 5);
  assert.equal(report.window_seconds, 600);
});

test("the same IP hashes differently per bucket", () => {
  const [updateIp] = updateRateLimitChecks("203.0.113.7", VENUE_ID, SALT);
  const [report] = reportRateLimitChecks("203.0.113.7", SALT);
  assert.notEqual(updateIp.key_hash, report.key_hash);
});

// --- consumeRateLimits ------------------------------------------------------------------------

function fakeRpc(response: { data: unknown; error: unknown } | Error) {
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

test("consumeRateLimits: allowed makes one rpc call with every check", async () => {
  const checks = updateRateLimitChecks("203.0.113.7", VENUE_ID, SALT);
  const { client, calls } = fakeRpc({ data: { allowed: true, retry_after_seconds: 0 }, error: null });
  assert.deepEqual(await consumeRateLimits(client, checks), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "consume_write_rate_limits");
  assert.deepEqual(calls[0].args, { p_checks: checks });
});

test("consumeRateLimits: exhausted limit reports retry-after seconds", async () => {
  const { client } = fakeRpc({ data: { allowed: false, retry_after_seconds: 421 }, error: null });
  assert.deepEqual(await consumeRateLimits(client, reportRateLimitChecks("x", SALT)), {
    ok: false,
    reason: "limited",
    retryAfterSeconds: 421,
  });
});

test("consumeRateLimits: missing/invalid retry-after falls back to 60 s", async () => {
  const { client } = fakeRpc({ data: { allowed: false }, error: null });
  const result = await consumeRateLimits(client, reportRateLimitChecks("x", SALT));
  assert.deepEqual(result, { ok: false, reason: "limited", retryAfterSeconds: 60 });
});

test("consumeRateLimits fails closed on database errors", async (t) => {
  silenceConsoleError(t);
  const checks = reportRateLimitChecks("x", SALT);
  for (const response of [
    { data: null, error: { code: "PGRST202", message: "function not found" } },
    { data: null, error: { code: "XX000", message: "boom" } },
    { data: null, error: null },
    { data: { something: "else" }, error: null },
    new TypeError("fetch failed"),
  ]) {
    const { client } = fakeRpc(response);
    assert.deepEqual(await consumeRateLimits(client, checks), { ok: false, reason: "db_error" });
  }
});

// --- Bearer token -----------------------------------------------------------------------------

test("bearerToken parses 'Bearer <token>' only", () => {
  assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerToken("bearer   abc"), "abc");
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken(undefined), null);
  assert.equal(bearerToken(""), null);
  assert.equal(bearerToken("Bearer"), null);
  assert.equal(bearerToken("Bearer "), null);
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer a b"), null);
});

function fakeAuth(result: { user: { id: string; email?: string | null } | null; error?: unknown } | Error) {
  const tokens: string[] = [];
  const client: AuthClient = {
    auth: {
      async getUser(jwt: string) {
        tokens.push(jwt);
        if (result instanceof Error) throw result;
        return { data: { user: result.user }, error: result.error ?? null };
      },
    },
  };
  return { client, tokens };
}

test("authenticateRequest returns the verified user", async () => {
  const { client, tokens } = fakeAuth({ user: { id: "user-1", email: "a@b.com" } });
  assert.deepEqual(await authenticateRequest(client, "Bearer tok"), { id: "user-1", email: "a@b.com" });
  assert.deepEqual(tokens, ["tok"]);
});

test("authenticateRequest: missing header never calls Auth", async () => {
  const { client, tokens } = fakeAuth({ user: { id: "user-1" } });
  assert.equal(await authenticateRequest(client, null), null);
  assert.equal(await authenticateRequest(client, "Basic xyz"), null);
  assert.equal(tokens.length, 0);
});

test("authenticateRequest: invalid token, error or outage is unauthenticated", async (t) => {
  silenceConsoleError(t);
  assert.equal(await authenticateRequest(fakeAuth({ user: null }).client, "Bearer bad"), null);
  assert.equal(
    await authenticateRequest(fakeAuth({ user: null, error: { status: 401, message: "invalid JWT" } }).client, "Bearer bad"),
    null
  );
  assert.equal(await authenticateRequest(fakeAuth(new TypeError("fetch failed")).client, "Bearer tok"), null);
});

test("authenticateRequest: user without email maps to email null", async () => {
  const { client } = fakeAuth({ user: { id: "user-2" } });
  assert.deepEqual(await authenticateRequest(client, "Bearer tok"), { id: "user-2", email: null });
});

// --- Route responses (401 / 429) --------------------------------------------------------------

test("authRequiredResponse is a 401 with a generic error", async () => {
  const { authRequiredResponse } = await import("./venue-server");
  const res = authRequiredResponse();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Authentication required" });
});

test("rateLimitedResponse: null when allowed, 429 + Retry-After when limited, 500 on db error", async (t) => {
  silenceConsoleError(t);
  const { rateLimitedResponse } = await import("./venue-server");
  const checks = reportRateLimitChecks("203.0.113.7", SALT);

  assert.equal(
    await rateLimitedResponse(fakeRpc({ data: { allowed: true, retry_after_seconds: 0 }, error: null }).client, checks),
    null
  );

  const limited = await rateLimitedResponse(
    fakeRpc({ data: { allowed: false, retry_after_seconds: 120 }, error: null }).client,
    checks
  );
  assert.ok(limited);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "120");
  assert.deepEqual(await limited.json(), { error: "Too many requests" });

  const failed = await rateLimitedResponse(fakeRpc(new TypeError("fetch failed")).client, checks);
  assert.ok(failed);
  assert.equal(failed.status, 500);
});
