/**
 * Pure helpers for "Sign in with Google" through Google Identity Services + Supabase
 * `signInWithIdToken`: client id resolution, the per-attempt nonce and the button width.
 * Free of React/DOM so it can be unit-tested (`npm run test:scripts`).
 *
 * Nonce flow (Supabase docs, "Sign in with Google" → Google pre-built): Google gets the
 * SHA-256 hex of a random nonce and embeds it in the ID token; Supabase gets the raw nonce,
 * hashes it and compares.
 */

/** Google Identity Services client library. */
export const GSI_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** Give up on the GIS script after this long and fall back to the OAuth redirect button. */
export const GSI_SCRIPT_TIMEOUT_MS = 10_000;

const CLIENT_ID_RE = /^[\w-]+\.apps\.googleusercontent\.com$/;

/**
 * Web OAuth client id from NEXT_PUBLIC_GOOGLE_CLIENT_ID, or null when unset/malformed (the
 * login card then keeps the `signInWithOAuth` redirect flow).
 */
export function resolveGoogleClientId(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  return value && CLIENT_ID_RE.test(value) ? value : null;
}

/** Subset of the Web Crypto API used here (`globalThis.crypto` in browsers and Node 19+). */
export type NonceCrypto = Pick<Crypto, "getRandomValues"> & {
  subtle: Pick<SubtleCrypto, "digest">;
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of the UTF-8 string, lowercase hex. */
export async function sha256Hex(value: string, crypto: NonceCrypto = globalThis.crypto): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

export type LoginNonce = {
  /** Sent to Supabase (`signInWithIdToken({ nonce })`). */
  raw: string;
  /** Sent to Google (`google.accounts.id.initialize({ nonce })`). */
  hashed: string;
};

/** Fresh random nonce (32 bytes, hex) and its SHA-256; one per sign-in attempt. */
export async function createLoginNonce(crypto: NonceCrypto = globalThis.crypto): Promise<LoginNonce> {
  const raw = toHex(crypto.getRandomValues(new Uint8Array(32)));
  return { raw, hashed: await sha256Hex(raw, crypto) };
}

/** Google's button accepts 200–400 px; fill the card up to that. */
export function googleButtonWidth(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 320;
  return Math.max(200, Math.min(400, Math.floor(containerWidth)));
}
