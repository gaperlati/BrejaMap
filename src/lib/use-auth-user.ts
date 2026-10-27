"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export type AuthState = {
  /** False when browser login is not configured (no NEXT_PUBLIC_SUPABASE_* env vars). */
  configured: boolean;
  /** True until the stored session has been read. */
  loading: boolean;
  user: { id: string; email: string | null } | null;
};

/** Signed-in user, kept in sync with login/logout (including other tabs and redirects). */
export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>({ configured: false, loading: true, user: null });

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setState({ configured: false, loading: false, user: null });
      return;
    }
    let active = true;
    const toUser = (u: { id: string; email?: string | null } | null | undefined) =>
      u ? { id: u.id, email: u.email ?? null } : null;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ configured: true, loading: false, user: toUser(data.session?.user) });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ configured: true, loading: false, user: toUser(session?.user) });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
