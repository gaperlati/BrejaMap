"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchReviewQueue, resolveReview, type ApiError, type ReviewQueueVenue } from "@/lib/api";
import { freshnessLabel } from "@/lib/price-freshness";
import { getAccessToken } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/use-auth-user";
import { BEER_TYPE_LABELS } from "@/lib/venue-state";
import { formatBRL } from "@/lib/format";

type QueueLoad =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; venues: ReviewQueueVenue[] };

/**
 * Review queue of bars flagged with "Sinalizar preços incorretos". The server decides who may
 * see it (ADMIN_EMAILS); everyone else gets "Acesso restrito". Wrong prices are fixed through the
 * normal editor on the map; here a moderator closes the report.
 */
export function ModerationView() {
  const auth = useAuthUser();
  const userId = auth.user?.id ?? null;
  const [queue, setQueue] = useState<QueueLoad>({ status: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setQueue({ status: "loading" });
    try {
      const token = await getAccessToken();
      if (!token) return setQueue({ status: "forbidden" });
      setQueue({ status: "ready", venues: await fetchReviewQueue(token) });
    } catch (e) {
      setQueue({ status: (e as ApiError).status === 403 ? "forbidden" : "error" });
    }
  }, []);

  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  const resolve = async (venueId: string, action: "dismiss" | "verify") => {
    setActionError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no session");
      await resolveReview(venueId, action, token);
      setQueue((prev) =>
        prev.status === "ready" ? { status: "ready", venues: prev.venues.filter((v) => v.id !== venueId) } : prev
      );
    } catch {
      setActionError("Não foi possível concluir. Tente novamente.");
    }
  };

  if (auth.loading) return <p className="mt-6 text-stone-400">Carregando...</p>;
  if (!auth.user) {
    return (
      <p className="mt-6 text-stone-400">
        <Link href="/conta" className="text-amber-400 underline underline-offset-2">
          Entre na sua conta
        </Link>{" "}
        de moderador para ver a fila.
      </p>
    );
  }
  if (queue.status === "loading") return <p className="mt-6 text-stone-400">Carregando fila...</p>;
  if (queue.status === "forbidden") {
    return <p className="mt-6 text-stone-400">Acesso restrito a moderadores.</p>;
  }
  if (queue.status === "error") {
    return (
      <p role="alert" className="mt-6 text-red-300">
        Não foi possível carregar a fila.{" "}
        <button type="button" onClick={load} className="underline">
          Tentar de novo
        </button>
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-stone-400">
        {queue.venues.length === 0
          ? "Nenhum bar sinalizado. 🎉"
          : `${queue.venues.length} bar${queue.venues.length === 1 ? "" : "es"} sinalizado${queue.venues.length === 1 ? "" : "s"}. Corrija preços errados pelo editor no mapa e depois feche o alerta aqui.`}
      </p>
      {actionError && (
        <p role="alert" className="text-sm text-red-300">
          {actionError}
        </p>
      )}
      <ul className="space-y-3">
        {queue.venues.map((v) => (
          <li key={v.id} className="rounded-xl border border-stone-800 bg-stone-900/60 p-4">
            <p className="font-semibold text-stone-100">{v.name}</p>
            <p className="text-xs text-stone-500">
              {[v.address, v.neighborhood, v.city].filter(Boolean).join(", ")}
              {v.lastEditedAt ? ` · última edição ${freshnessLabel(v.lastEditedAt).replace("Atualizado ", "")}` : ""}
            </p>
            <ul className="mt-2 text-sm text-stone-300">
              {v.beerPrices.map((p, i) => (
                <li key={p.id ?? i}>
                  {p.label || BEER_TYPE_LABELS[p.type as keyof typeof BEER_TYPE_LABELS]}: {formatBRL(p.priceBRL)}
                  <span className="text-xs text-stone-500"> · {freshnessLabel(p.updatedAt)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => resolve(v.id, "verify")}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
              >
                Preços conferidos
              </button>
              <button
                type="button"
                onClick={() => resolve(v.id, "dismiss")}
                className="rounded-lg border border-stone-600 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
              >
                Dispensar alerta
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
