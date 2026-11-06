import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { HandlerDeps } from "@/lib/handlers/common";
import { readMenuPhoto } from "@/lib/handlers/menu-photo";

const deps = (): HandlerDeps => ({ db: supabase, env: process.env });

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST /api/menu-photo - raw image body → `{ prices }`; see src/lib/handlers/menu-photo.ts. */
export function POST(request: NextRequest) {
  return readMenuPhoto(deps(), request);
}
