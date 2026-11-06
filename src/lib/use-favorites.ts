"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchFavorites, setFavorite, type ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/use-auth-user";

export type FavoritesState = {
  /** Login is configured and someone is signed in (favorites need an account). */
  available: boolean;
  signedIn: boolean;
  ids: Set<string>;
  /** Adds/removes a favorite; rejects with a pt-BR message (the change is rolled back). */
  toggle: (venueId: string) => Promise<void>;
};

/** Favorite venue ids of the signed-in user, loaded once per login. */
export function useFavorites(): FavoritesState {
  const auth = useAuthUser();
  const userId = auth.user?.id ?? null;
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setIds(new Set());
    if (!userId) return;
    let active = true;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const venues = await fetchFavorites(token);
        if (active) setIds(new Set(venues.map((v) => v.id)));
      } catch {
        // Not critical: the hearts just start empty.
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const toggle = useCallback(
    async (venueId: string) => {
      const token = await getAccessToken();
      if (!token) throw new Error("Entre na sua conta para salvar favoritos.");
      const next = !ids.has(venueId);
      const apply = (on: boolean) =>
        setIds((prev) => {
          const copy = new Set(prev);
          if (on) copy.add(venueId);
          else copy.delete(venueId);
          return copy;
        });
      apply(next);
      try {
        await setFavorite(venueId, next, token);
      } catch (e) {
        apply(!next);
        const status = (e as ApiError).status;
        throw new Error(
          status === 429
            ? "Muitas alterações em pouco tempo. Tente de novo em alguns minutos."
            : status === 404
              ? "Este bar não existe mais."
              : "Não foi possível salvar o favorito. Tente novamente."
        );
      }
    },
    [ids]
  );

  return { available: auth.configured, signedIn: !!auth.user, ids, toggle };
}
