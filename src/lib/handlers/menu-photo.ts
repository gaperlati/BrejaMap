/**
 * POST /api/menu-photo - Body: the raw image (image/jpeg, image/png or image/webp, at most 4 MB).
 * Returns `{ prices }` read from the menu through Vercel AI Gateway, for the user to review in
 * the price form; nothing is saved and the photo is not stored.
 *
 * Order of checks: kill switch → configured (AI_GATEWAY_API_KEY + database, else 503) → login
 * (401) → declared type (415) and length (413) → bounded body read (413) → magic bytes must match
 * the declared type (415) → rate limits per user, per IP and site-wide daily budget (429; fail
 * closed) → one paid call.
 */

import {
  ALLOWED_MENU_IMAGE_TYPES,
  DEFAULT_MENU_PHOTO_MODEL,
  MAX_MENU_PHOTO_BYTES,
  detectImageType,
  extractMenuPrices,
  readBodyWithLimit,
  type MenuImageType,
} from "../menu-photo";
import { clientIp, menuPhotoDailyLimit, menuPhotoRateLimitChecks, rateLimitSalt } from "../write-guards";
import { authRequired, json, rateLimited, requestUser, writesBlocked, type HandlerDeps } from "./common";

export async function readMenuPhoto(deps: HandlerDeps, request: Request): Promise<Response> {
  const blocked = writesBlocked(deps.env);
  if (blocked) return blocked;

  const apiKey = deps.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey || !deps.db) return json({ error: "Menu photo reading is not configured" }, 503);

  const user = await requestUser(deps.db, request);
  if (!user) return authRequired();

  const declaredType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!ALLOWED_MENU_IMAGE_TYPES.includes(declaredType as MenuImageType)) {
    return json({ error: "Unsupported image type" }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MENU_PHOTO_BYTES) {
    return json({ error: "Image too large" }, 413);
  }

  const image = await readBodyWithLimit(request.body, MAX_MENU_PHOTO_BYTES);
  if (image === "too_large") return json({ error: "Image too large" }, 413);
  const type = detectImageType(image);
  if (!type || type !== declaredType) return json({ error: "Unsupported image type" }, 415);

  // Counted only for well-formed requests, right before the paid call.
  const limited = await rateLimited(
    deps.db,
    menuPhotoRateLimitChecks(clientIp(request.headers), user.id, rateLimitSalt(deps.env), menuPhotoDailyLimit(deps.env))
  );
  if (limited) return limited;

  const result = await extractMenuPrices({
    apiKey,
    model: deps.env.MENU_PHOTO_MODEL?.trim() || DEFAULT_MENU_PHOTO_MODEL,
    image,
    type,
    fetchImpl: deps.fetchImpl,
  });
  if (!result.ok) {
    return result.reason === "timeout"
      ? json({ error: "Menu reading timed out" }, 504)
      : json({ error: "Failed to read menu" }, 502);
  }
  return json({ prices: result.prices });
}
