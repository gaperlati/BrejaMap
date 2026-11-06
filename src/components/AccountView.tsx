"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Venue } from "@/types";
import { fetchFavorites, setFavorite } from "@/lib/api";
import { getAccessToken, getSupabaseBrowser } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/use-auth-user";
import { apiVenueToVenue, getMinBeerPrice } from "@/lib/venue-state";
import { LoginCard } from "@/components/LoginCard";
import { formatBRL } from "@/lib/format";

type FavoritesLoad = { status: "loading" } | { status: "error" } | { status: "ready"; venues: Venue[] };

/** "Minha conta": login, e-mail, logout and the list of favorite bars. */
export function AccountView() {
  const auth = useAuthUser();
  const userId = auth.user?.id ?? null;
  const [favorites, setFavorites] = useState<FavoritesLoad>({ status: "loading" });
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setFavorites({ status: "loading" });
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("no session");
        const venues = (await fetchFavorites(token)).map(apiVenueToVenue);
        if (active) setFavorites({ status: "ready", venues });
      } catch {
        if (active) setFavorites({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const remove = async (venueId: string) => {
    setRemoveError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no session");
      await setFavorite(venueId, false, token);
      setFavorites((prev) =>
        prev.status === "ready" ? { status: "ready", venues: prev.venues.filter((v) => v.id !== venueId) } : prev
      );
    } catch {
      setRemoveError("Não foi possível remover. Tente novamente.");
    }
  };

  if (auth.loading) return <p className="mt-6 text-stone-400">Carregando...</p>;

  if (!auth.configured) {
    return <p className="mt-6 text-stone-400">O login não está disponível neste ambiente.</p>;
  }

  if (!auth.user) {
    return (
      <div className="mt-6">
        <LoginCard context="account" />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-stone-800 bg-stone-900/60 p-4">
        <p className="text-xs text-stone-500">Conectado como</p>
        <p className="text-stone-100 [overflow-wrap:anywhere]">{auth.user.email ?? "conta sem e-mail"}</p>
        <button
          type="button"
          onClick={() => getSupabaseBrowser()?.auth.signOut()}
          className="mt-3 rounded-lg border border-stone-600 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
        >
          Sair
        </button>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-stone-100">Favoritos</h2>
        {favorites.status === "loading" && <p className="mt-2 text-sm text-stone-400">Carregando favoritos...</p>}
        {favorites.status === "error" && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            Não foi possível carregar seus favoritos. Tente de novo mais tarde.
          </p>
        )}
        {favorites.status === "ready" && favorites.venues.length === 0 && (
          <p className="mt-2 text-sm text-stone-400">
            Nenhum favorito ainda. Abra um bar no mapa e toque em “♡ Favoritar”.
          </p>
        )}
        {favorites.status === "ready" && favorites.venues.length > 0 && (
          <ul className="mt-2 divide-y divide-stone-800 rounded-xl border border-stone-800">
            {favorites.venues.map((v) => {
              const min = getMinBeerPrice(v);
              return (
                <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-100">{v.name}</p>
                    <p className="text-xs text-stone-500">{[v.neighborhood, v.city].filter(Boolean).join(", ")}</p>
                    <p className="text-sm text-amber-400">
                      {Number.isFinite(min) ? `A partir de ${formatBRL(min)}` : "Preços não informados"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${v.lat},${v.lng}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-stone-300 underline underline-offset-2 hover:text-stone-100"
                    >
                      Como chegar
                    </a>
                    <button
                      type="button"
                      onClick={() => remove(v.id)}
                      className="text-xs text-rose-300 underline underline-offset-2 hover:text-rose-200"
                    >
                      Remover
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {removeError && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {removeError}
          </p>
        )}
      </section>

      <p className="text-xs text-stone-500">
        Para apagar sua conta e seus dados, veja a{" "}
        <Link href="/privacidade" className="text-amber-400 underline underline-offset-2">
          política de privacidade
        </Link>
        .
      </p>
    </div>
  );
}
