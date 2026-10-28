"use client";

import { useEffect, useRef, useState } from "react";
import {
  createLoginNonce,
  googleButtonWidth,
  GSI_SCRIPT_SRC,
  GSI_SCRIPT_TIMEOUT_MS,
} from "@/lib/google-identity";
import type { GsiAccountsId, GsiCredentialResponse, GsiWindow } from "@/types/google-identity";

function gsi(): GsiAccountsId | undefined {
  return (window as GsiWindow).google?.accounts?.id;
}

let scriptPromise: Promise<GsiAccountsId> | null = null;

/** Loads the GIS script once per page; rejects on network error or timeout (retried next time). */
function loadGoogleIdentity(): Promise<GsiAccountsId> {
  const ready = gsi();
  if (ready) return Promise.resolve(ready);
  scriptPromise ??= new Promise<GsiAccountsId>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => fail(), GSI_SCRIPT_TIMEOUT_MS);
    function fail() {
      window.clearTimeout(timer);
      script.remove();
      scriptPromise = null;
      reject(new Error("Google Identity Services unavailable"));
    }
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.clearTimeout(timer);
      const api = gsi();
      if (api) resolve(api);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

type Props = {
  clientId: string;
  /** Hands Google's ID token and the raw nonce to the caller (Supabase `signInWithIdToken`). */
  onCredential: (credential: string | undefined, rawNonce: string) => Promise<void>;
  /** The script or Web Crypto is unavailable: the caller shows the redirect button instead. */
  onUnavailable: () => void;
  disabled?: boolean;
};

/**
 * Google's official "Continuar com Google" button (Google Identity Services, popup/FedCM), so
 * the consent screen shows BrejaMap's own origin. A fresh nonce is used for every attempt.
 */
export function GoogleSignInButton({ clientId, onCredential, onUnavailable, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const onCredentialRef = useRef(onCredential);
  const onUnavailableRef = useRef(onUnavailable);
  onCredentialRef.current = onCredential;
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    let active = true;

    const prepare = async () => {
      try {
        const api = await loadGoogleIdentity();
        const nonce = await createLoginNonce();
        const container = containerRef.current;
        if (!active || !container) return;
        api.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          context: "signin",
          ux_mode: "popup",
          itp_support: true,
          use_fedcm_for_prompt: true,
          callback: (response: GsiCredentialResponse) => {
            void onCredentialRef.current(response.credential, nonce.raw).finally(() => {
              // Nonces are single-use: arm the button again in case this attempt failed.
              if (active) void prepare();
            });
          },
        });
        container.replaceChildren();
        api.renderButton(container, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
          width: googleButtonWidth(container.clientWidth),
          locale: "pt-BR",
        });
        setRendered(true);
      } catch {
        if (active) onUnavailableRef.current();
      }
    };

    void prepare();
    return () => {
      active = false;
    };
  }, [clientId]);

  return (
    <div
      aria-busy={disabled || !rendered}
      className={`relative flex min-h-10 w-full justify-center ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      {!rendered && <div aria-hidden className="absolute inset-0 animate-pulse rounded-lg bg-stone-800" />}
      <div ref={containerRef} className="flex w-full justify-center [color-scheme:light]" />
    </div>
  );
}
