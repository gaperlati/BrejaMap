import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { HandlerDeps } from "@/lib/handlers/common";
import { getReviewQueue } from "@/lib/handlers/admin";

const deps = (): HandlerDeps => ({ db: supabase, env: process.env });

/** GET /api/admin/review-queue - ADMIN_EMAILS only; see src/lib/handlers/admin.ts. */
export function GET(request: NextRequest) {
  return getReviewQueue(deps(), request);
}
