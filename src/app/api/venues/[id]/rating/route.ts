import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { HandlerDeps } from "@/lib/handlers/common";
import { getRating, setRating } from "@/lib/handlers/social";

const deps = (): HandlerDeps => ({ db: supabase, env: process.env });

type Params = { params: Promise<{ id: string }> };

/** GET /api/venues/[id]/rating - The signed-in user's score plus the venue's average/count. */
export async function GET(request: NextRequest, { params }: Params) {
  return getRating(deps(), request, (await params).id);
}

/** PUT /api/venues/[id]/rating { score: 1..5 } - Sets the signed-in user's rating. */
export async function PUT(request: NextRequest, { params }: Params) {
  return setRating(deps(), request, (await params).id, false);
}

/** DELETE /api/venues/[id]/rating - Removes the signed-in user's rating. */
export async function DELETE(request: NextRequest, { params }: Params) {
  return setRating(deps(), request, (await params).id, true);
}
