"use client";

import Link from "next/link";
import { useState } from "react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { resolveGoogleClientId } from "@/lib/google-identity";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/** sessionStorage flag: reopen "Adicionar bar" after returning from the Google login redirect. */
export const REOPEN_ADD_VENUE_KEY = "brejamap:reopen-add-venue";

// Literal process.env read so Next.js inlines it. Unset: Google login keeps the OAuth redirect.
const googleClientId = resolveGoogleClientId(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

type Step = "choose" | "email" | "code";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** pt-BR message for a failed login call; never shows the provider's raw text. */
function loginErrorMessage(error: { status?: number; message?: string } | null | undefined): string {
  if (error?.status === 429 || /rate limit/i.test(error?.message ?? "")) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  return "Não foi possível entrar agora. Tente novamente.";
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/**
 * Login shown in "Adicionar bar" when the visitor is signed out: Google, or e-mail with a
 * 6-digit code (typed here, without leaving the page) or the link sent in the same e-mail.
 * Google uses Google Identity Services + `signInWithIdToken` (consent shows our own origin)
 * when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set, else (or if the GIS script fails) the
 * `signInWithOAuth` redirect.
 */
export function LoginCard() {
  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gsiUnavailable, setGsiUnavailable] = useState(false);

  const supabase = getSupabaseBrowser();
  if (!supabase) return null;

  const signInWithGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      sessionStorage.setItem(REOPEN_ADD_VENUE_KEY, "1");
    } catch {
      // Private mode etc.: the user just reopens the modal by hand.
    }
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    // On success the browser is already navigating away.
    if (err) {
      setError(loginErrorMessage(err));
      setBusy(false);
    }
  };

  const signInWithGoogleIdToken = async (credential: string | undefined, nonce: string) => {
    if (!credential) {
      setError("Não foi possível entrar com o Google. Tente novamente.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: credential,
      nonce,
    });
    setBusy(false);
    // On success the session listener swaps this card for the form.
    if (err) setError(loginErrorMessage(err));
  };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed) || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (err) {
      setError(loginErrorMessage(err));
      return;
    }
    setCode("");
    setStep("code");
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    setBusy(false);
    // On success the session listener swaps this card for the form.
    if (err) {
      setError(
        err.status === 429 ? loginErrorMessage(err) : "Código inválido ou expirado. Confira o e-mail ou peça um novo código."
      );
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-stone-900/60 p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-stone-100">Entre para cadastrar um novo bar</h3>
        <p className="mt-1 text-sm text-stone-400">
          Para evitar spam, pedimos um login rápido antes de adicionar bares. Editar preços em bares
          existentes não exige login.
        </p>
      </div>

      {step === "choose" && (
        <div className="space-y-2">
          {googleClientId && !gsiUnavailable ? (
            <GoogleSignInButton
              clientId={googleClientId}
              onCredential={signInWithGoogleIdToken}
              onUnavailable={() => setGsiUnavailable(true)}
              disabled={busy}
            />
          ) : (
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-stone-900 transition hover:bg-stone-100 disabled:opacity-60"
            >
              <GoogleIcon />
              Continuar com Google
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep("email");
            }}
            disabled={busy}
            className="w-full rounded-lg border border-stone-600 px-4 py-2.5 text-sm font-medium text-stone-200 transition hover:bg-stone-700 disabled:opacity-60"
          >
            Continuar com e-mail
          </button>
        </div>
      )}

      {step === "email" && (
        <form onSubmit={sendCode} className="space-y-2">
          <label className="block text-sm font-medium text-stone-400" htmlFor="login-email">
            Seu e-mail
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            required
            className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 placeholder-stone-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("choose")}
              className="px-3 py-2 rounded-lg border border-stone-600 text-sm text-stone-300 hover:bg-stone-700"
            >
              Voltar
            </button>
            <button
              type="submit"
              disabled={busy || !EMAIL_RE.test(email.trim())}
              className="flex-1 px-3 py-2 rounded-lg bg-amber-500 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? "Enviando..." : "Enviar código"}
            </button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="space-y-2">
          <p className="text-sm text-stone-300">
            Enviamos um código de 6 dígitos para <strong className="text-stone-100">{email.trim()}</strong>.
            Digite-o abaixo ou, se preferir, clique no link do mesmo e-mail.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            aria-label="Código de 6 dígitos"
            className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-700 text-center text-lg tracking-[0.5em] text-stone-100 placeholder-stone-600"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("email");
              }}
              className="px-3 py-2 rounded-lg border border-stone-600 text-sm text-stone-300 hover:bg-stone-700"
            >
              Trocar e-mail
            </button>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="flex-1 px-3 py-2 rounded-lg bg-amber-500 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? "Verificando..." : "Entrar"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <p className="text-xs text-stone-500">
        Saiba quais dados guardamos na nossa{" "}
        <Link
          href="/privacidade"
          target="_blank"
          className="text-stone-400 underline underline-offset-2 hover:text-stone-200"
        >
          Política de privacidade
        </Link>
        .
      </p>
    </div>
  );
}
