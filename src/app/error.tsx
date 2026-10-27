"use client";

import { useEffect } from "react";

/** Route-level error boundary: anything that throws while rendering lands here instead of a blank page. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-stone-950 p-6 text-center">
      <h1 className="text-2xl font-bold text-amber-400">BrejaMap</h1>
      <p className="max-w-sm text-stone-300">
        Algo deu errado ao carregar o mapa. Tente de novo em instantes.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-stone-950 transition hover:bg-amber-400"
      >
        Tentar de novo
      </button>
    </main>
  );
}
