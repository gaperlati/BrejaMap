import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { HandlerDeps } from "@/lib/handlers/common";
import { listFavorites } from "@/lib/handlers/social";

const deps = (): HandlerDeps => ({ db: supabase, env: process.env });

/** GET /api/favorites - see listFavorites in src/lib/handlers/social.ts. */
export function GET(request: NextRequest) {
  return listFavorites(deps(), request);
}
