import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-server";
import type { HandlerDeps } from "@/lib/handlers/common";
import { confirmPrice } from "@/lib/handlers/confirm-price";

const deps = (): HandlerDeps => ({ db: supabase, env: process.env });

/** POST /api/venues/[id]/confirm { priceId } - "Ainda é esse preço? Sim"; see the handler. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return confirmPrice(deps(), request, (await params).id);
}
