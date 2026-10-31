import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { HandlerDeps } from "@/lib/handlers/common";
import { resolveReview } from "@/lib/handlers/admin";

const deps = (): HandlerDeps => ({ db: supabase, env: process.env });

/** POST /api/admin/venues/[id]/resolve { action: "dismiss" | "verify" } - ADMIN_EMAILS only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return resolveReview(deps(), request, (await params).id);
}
