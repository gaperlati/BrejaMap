import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { isUuid, rateLimitedResponse, writesBlockedResponse } from "@/lib/venue-server";
import { flagVenueForReview } from "@/lib/venue-writes";
import { clientIp, rateLimitSalt, reportRateLimitChecks } from "@/lib/write-guards";

/**
 * POST /api/venues/[id]/report - Flags a venue's prices as wrong or abusive (sets
 * venues.needs_review for moderation). No login; rate-limited per IP (429).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const blocked = writesBlockedResponse();
  if (blocked) return blocked;

  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "Invalid venue id" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const limited = await rateLimitedResponse(
    supabase,
    reportRateLimitChecks(clientIp(request.headers), rateLimitSalt())
  );
  if (limited) return limited;

  const result = await flagVenueForReview(supabase, id);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to report venue" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
