/**
 * Shared pieces of the request handlers in src/lib/handlers: plain Web `Response`s (no Next.js
 * imports) and injected dependencies, so every guard can be tested with fakes. The route files
 * under src/app/api only wire the real Supabase client and `process.env` into them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RpcClient } from "../venue-writes";
import { authenticateRequest, consumeRateLimits, type AuthUser, type RateLimitCheck } from "../write-guards";

export type Env = Record<string, string | undefined>;

export interface HandlerDeps {
  /** Service-role client; null when the backend is not configured (503). */
  db: SupabaseClient | null;
  env: Env;
  /** Injected in tests for outbound calls (AI Gateway). */
  fetchImpl?: typeof fetch;
}

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

export const notConfigured = () => json({ error: "Database not configured" }, 503);
export const authRequired = () => json({ error: "Authentication required" }, 401);
export const forbidden = () => json({ error: "Forbidden" }, 403);

/** Same kill switch as `writesBlockedResponse` (USER_EDITS_ENABLED in production). */
export function writesBlocked(env: Env): Response | null {
  if (env.NODE_ENV === "production" && env.USER_EDITS_ENABLED !== "true") {
    return json({ error: "User edits are disabled in production" }, 403);
  }
  return null;
}

/** 429 with Retry-After, 500 when limits can't be checked (fails closed), or null to proceed. */
export async function rateLimited(client: RpcClient, checks: RateLimitCheck[]): Promise<Response | null> {
  const result = await consumeRateLimits(client, checks);
  if (result.ok) return null;
  if (result.reason === "limited") {
    return json({ error: "Too many requests" }, 429, { "Retry-After": String(result.retryAfterSeconds) });
  }
  return json({ error: "Failed to check rate limit" }, 500);
}

/** Verified user from the Bearer token, or null. */
export function requestUser(db: SupabaseClient, request: Request): Promise<AuthUser | null> {
  return authenticateRequest(db, request.headers.get("authorization"));
}

/** JSON object body, or null when the body is not a JSON object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
