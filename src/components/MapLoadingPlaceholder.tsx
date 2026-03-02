"use client";

import { useEffect, useState } from "react";

const TIMEOUT_MS = 12_000;

export function MapLoadingPlaceholder() {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-stone-900 rounded-xl p-4">
      <span className="text-stone-500 text-center">Carregando mapa...</span>
      {timedOut && (
        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <p className="text-amber-200/90 max-w-xs">
            O mapa está demorando. Verifique sua conexão e se a chave do Google
            está correta em <code className="text-stone-400">.env.local</code>.
            Reinicie o servidor após alterar a chave.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-medium hover:bg-amber-400 transition"
          >
            Tentar de novo
          </button>
        </div>
      )}
    </div>
  );
}
