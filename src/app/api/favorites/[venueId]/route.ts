import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { HandlerDeps } from "@/lib/handlers/common";
import { setFavorite } from "@/lib/handlers/social";

const deps = (): HandlerDeps => ({ db: supabase, env: process.env });

type Params = { params: Promise<{ venueId: string }> };

/** PUT /api/favorites/[venueId] - Adds a favorite (login required, idempotent). */
export async function PUT(request: NextRequest, { params }: Params) {
  return setFavorite(deps(), request, (await params).venueId, true);
}

/** DELETE /api/favorites/[venueId] - Removes a favorite (login required, idempotent). */
export async function DELETE(request: NextRequest, { params }: Params) {
  return setFavorite(deps(), request, (await params).venueId, false);
}
