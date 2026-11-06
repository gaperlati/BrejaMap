/**
 * Anti-abuse guards for the write routes: client IP hashing, rate limits (through
 * public.consume_write_rate_limits in supabase/migrations/004_auth_rate_limits_and_moderation.sql)
 * and Bearer token verification. Free of Next.js imports so it can be unit-tested with fakes.
 */

import { createHash } from "node:crypto";
import type { RpcClient } from "./venue-writes";

/** Minimal header reader (matches `Headers` and NextRequest.headers). */
export type HeaderReader = { get(name: string): string | null };

/**
 * Best-effort client IP: first entry of `x-forwarded-for` (set by Vercel), then `x-real-ip`,
 * else "unknown" (all such clients then share one bucket).
 */
export function clientIp(headers: HeaderReader): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

/** Server-side salt for hashing rate-limit keys. Never sent to the client. */
export function rateLimitSalt(env: Record<string, string | undefined> = process.env): string {
  return env.RATE_LIMIT_SALT?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
}

/** Salted SHA-256 (hex) of the given parts, so raw IPs and ids are never stored. */
export function hashRateLimitKey(salt: string, ...parts: string[]): string {
  return createHash("sha256").update([salt, ...parts].join("\n")).digest("hex");
}

export type RateLimitRule = { bucket: string; maxHits: number; windowSeconds: number };

const TEN_MINUTES = 10 * 60;
const ONE_HOUR = 60 * 60;
const ONE_DAY = 24 * ONE_HOUR;
/** Default cap on paid menu-photo extractions per day for the whole site (MENU_PHOTO_DAILY_LIMIT). */
export const DEFAULT_MENU_PHOTO_DAILY_LIMIT = 200;

export const RATE_LIMITS = {
  /** PATCH /api/venues/[id]: any venue, per IP. */
  updatePerIp: { bucket: "venue_update_ip", maxHits: 10, windowSeconds: TEN_MINUTES },
  /** PATCH /api/venues/[id]: one venue, per IP, so one client can't keep overwriting a bar. */
  updatePerIpAndVenue: { bucket: "venue_update_ip_venue", maxHits: 3, windowSeconds: TEN_MINUTES },
  /** POST /api/venues: per signed-in user. */
  createPerUser: { bucket: "venue_create_user", maxHits: 5, windowSeconds: ONE_HOUR },
  /** POST /api/venues: per IP (several accounts behind one client). */
  createPerIp: { bucket: "venue_create_ip", maxHits: 5, windowSeconds: ONE_HOUR },
  /** POST /api/venues/[id]/report: per IP. */
  reportPerIp: { bucket: "venue_report_ip", maxHits: 5, windowSeconds: TEN_MINUTES },
  /** POST /api/venues/[id]/confirm ("Ainda é esse preço? Sim"): per IP. */
  confirmPerIp: { bucket: "price_confirm_ip", maxHits: 20, windowSeconds: TEN_MINUTES },
  /** POST /api/venues/[id]/confirm: one venue, per IP, so one client can't keep a bar "fresh". */
  confirmPerIpAndVenue: { bucket: "price_confirm_ip_venue", maxHits: 5, windowSeconds: ONE_DAY },
  /** POST /api/menu-photo (paid AI call): per signed-in user. */
  menuPhotoPerUser: { bucket: "menu_photo_user", maxHits: 10, windowSeconds: ONE_HOUR },
  /** POST /api/menu-photo: per IP. */
  menuPhotoPerIp: { bucket: "menu_photo_ip", maxHits: 15, windowSeconds: ONE_HOUR },
  /** Favorites add/remove: per signed-in user. */
  favoritePerUser: { bucket: "favorite_user", maxHits: 60, windowSeconds: TEN_MINUTES },
  /** Ratings: per signed-in user. */
  ratingPerUser: { bucket: "rating_user", maxHits: 30, windowSeconds: TEN_MINUTES },
} satisfies Record<string, RateLimitRule>;

export type RateLimitCheck = {
  bucket: string;
  key_hash: string;
  max_hits: number;
  window_seconds: number;
};

/** Pairs a rule with the (unhashed) parts identifying the client; hashes them with the salt. */
export function rateLimitCheck(rule: RateLimitRule, salt: string, ...keyParts: string[]): RateLimitCheck {
  return {
    bucket: rule.bucket,
    key_hash: hashRateLimitKey(salt, rule.bucket, ...keyParts),
    max_hits: rule.maxHits,
    window_seconds: rule.windowSeconds,
  };
}

/** Checks for PATCH /api/venues/[id]. */
export function updateRateLimitChecks(ip: string, venueId: string, salt: string): RateLimitCheck[] {
  return [
    rateLimitCheck(RATE_LIMITS.updatePerIp, salt, ip),
    rateLimitCheck(RATE_LIMITS.updatePerIpAndVenue, salt, ip, venueId.toLowerCase()),
  ];
}

/** Checks for POST /api/venues. */
export function createRateLimitChecks(ip: string, userId: string, salt: string): RateLimitCheck[] {
  return [
    rateLimitCheck(RATE_LIMITS.createPerUser, salt, userId),
    rateLimitCheck(RATE_LIMITS.createPerIp, salt, ip),
  ];
}

/** Checks for POST /api/venues/[id]/report. */
export function reportRateLimitChecks(ip: string, salt: string): RateLimitCheck[] {
  return [rateLimitCheck(RATE_LIMITS.reportPerIp, salt, ip)];
}

/** Checks for POST /api/venues/[id]/confirm. */
export function confirmRateLimitChecks(ip: string, venueId: string, salt: string): RateLimitCheck[] {
  return [
    rateLimitCheck(RATE_LIMITS.confirmPerIp, salt, ip),
    rateLimitCheck(RATE_LIMITS.confirmPerIpAndVenue, salt, ip, venueId.toLowerCase()),
  ];
}

/** Site-wide daily cap on menu-photo extractions (env MENU_PHOTO_DAILY_LIMIT, default 200). */
export function menuPhotoDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MENU_PHOTO_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MENU_PHOTO_DAILY_LIMIT;
}

/** Checks for POST /api/menu-photo: per user, per IP and a global daily budget. */
export function menuPhotoRateLimitChecks(
  ip: string,
  userId: string,
  salt: string,
  dailyLimit: number = menuPhotoDailyLimit()
): RateLimitCheck[] {
  return [
    rateLimitCheck(RATE_LIMITS.menuPhotoPerUser, salt, userId),
    rateLimitCheck(RATE_LIMITS.menuPhotoPerIp, salt, ip),
    rateLimitCheck({ bucket: "menu_photo_global", maxHits: dailyLimit, windowSeconds: ONE_DAY }, salt, "all"),
  ];
}

/** Checks for the favorites routes. */
export function favoriteRateLimitChecks(userId: string, salt: string): RateLimitCheck[] {
  return [rateLimitCheck(RATE_LIMITS.favoritePerUser, salt, userId)];
}

/** Checks for POST /api/venues/[id]/rating. */
export function ratingRateLimitChecks(userId: string, salt: string): RateLimitCheck[] {
  return [rateLimitCheck(RATE_LIMITS.ratingPerUser, salt, userId)];
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: "limited"; retryAfterSeconds: number }
  | { ok: false; reason: "db_error" };

/**
 * Counts this request against every check, atomically. Fails closed: if the database can't
 * answer, the caller should refuse the write (`db_error`).
 */
export async function consumeRateLimits(
  client: RpcClient,
  checks: RateLimitCheck[]
): Promise<RateLimitResult> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.rpc("consume_write_rate_limits", { p_checks: checks }));
  } catch (e) {
    console.error("Supabase rpc consume_write_rate_limits threw:", e);
    return { ok: false, reason: "db_error" };
  }

  if (error) {
    if ((error as { code?: string }).code === "PGRST202") {
      console.error(
        "Supabase rpc consume_write_rate_limits not found: run supabase/migrations/004_auth_rate_limits_and_moderation.sql"
      );
    }
    console.error("Supabase rpc consume_write_rate_limits error:", error);
    return { ok: false, reason: "db_error" };
  }

  const result = data as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  if (!result || typeof result.allowed !== "boolean") {
    console.error("Supabase rpc consume_write_rate_limits returned an unexpected payload");
    return { ok: false, reason: "db_error" };
  }
  if (result.allowed) return { ok: true };

  const retryAfter = Number(result.retry_after_seconds);
  return {
    ok: false,
    reason: "limited",
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60,
  };
}

/** Token from `Authorization: Bearer <token>`, or null when absent or malformed. */
export function bearerToken(authorization: string | null | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/** The slice of the Supabase client used to verify access tokens (lets tests pass a fake). */
export type AuthClient = {
  auth: {
    getUser(jwt: string): PromiseLike<{
      data: { user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null };
      error: unknown;
    }>;
  };
};

export type AuthUser = {
  id: string;
  email: string | null;
  /** Supabase confirmed the e-mail (OTP/link or Google). */
  emailConfirmed: boolean;
};

/**
 * Verifies the request's Bearer token with Supabase Auth. Returns the user, or null when the
 * token is missing, invalid, expired, or Auth can't be reached.
 */
export async function authenticateRequest(
  client: AuthClient,
  authorization: string | null | undefined
): Promise<AuthUser | null> {
  const token = bearerToken(authorization);
  if (!token) return null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      emailConfirmed: Boolean(data.user.email_confirmed_at),
    };
  } catch (e) {
    console.error("Supabase auth.getUser threw:", e);
    return null;
  }
}

/** Lower-cased e-mails from ADMIN_EMAILS (comma-separated, server-only). Empty = nobody. */
export function adminEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/** Moderator check: a confirmed e-mail listed in ADMIN_EMAILS. Denies by default. */
export function isAdmin(user: AuthUser | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!user?.email || !user.emailConfirmed) return false;
  return adminEmails(env).includes(user.email.trim().toLowerCase());
}
