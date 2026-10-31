"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { BeerPrice, BeerType } from "@/types";
import { extractMenuPhotoPrices, menuPhotoErrorMessage } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/use-auth-user";

/** Longest side sent to the server; menus stay legible and uploads stay small. */
const MAX_SIDE_PX = 1600;
const JPEG_QUALITY = 0.85;

/** Downscales the photo in the browser and re-encodes it as JPEG (drops EXIF/location too). */
async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) throw new Error("encode failed");
    return blob;
  } finally {
    bitmap.close();
  }
}

interface MenuPhotoImportProps {
  disabled?: boolean;
  /** Prices read from the photo, for the form to show for review (never saved here). */
  onImport: (prices: BeerPrice[]) => void;
}

/**
 * "Ler cardápio por foto": sends a menu photo to POST /api/menu-photo and hands the prices to
 * the form. Login required (paid AI call). Unmounting (closing the form or switching bar) cancels
 * an ongoing reading so late results never land in another form.
 */
export function MenuPhotoImport({ disabled, onImport }: MenuPhotoImportProps) {
  const auth = useAuthUser();
  const inputId = useId();
  const [status, setStatus] = useState<"idle" | "reading">("idle");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onImportRef = useRef(onImport);
  useEffect(() => {
    onImportRef.current = onImport;
  }, [onImport]);
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!auth.configured || auth.loading) return null;

  if (!auth.user) {
    return (
      <p className="mb-3 rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-xs text-stone-400">
        📷 Tem o cardápio em mãos?{" "}
        <Link href="/conta" className="text-amber-400 underline underline-offset-2">
          Entre na sua conta
        </Link>{" "}
        para preencher os preços a partir de uma foto.
      </p>
    );
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("reading");
    setMessage(null);
    try {
      const image = await prepareImage(file);
      const prices = await extractMenuPhotoPrices(image, await getAccessToken(), controller.signal);
      if (controller.signal.aborted) return;
      if (prices.length === 0) {
        setMessage({ kind: "error", text: "Não encontramos preços de cerveja nesta foto. Tente outra ou preencha à mão." });
      } else {
        onImportRef.current(prices.map((p) => ({ ...p, type: p.type as BeerType })));
        setMessage({
          kind: "ok",
          text: `${prices.length} preço${prices.length === 1 ? "" : "s"} lido${prices.length === 1 ? "" : "s"} da foto. Confira cada um antes de salvar.`,
        });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setMessage({
        kind: "error",
        text: (e as Error)?.message === "encode failed" ? "Não foi possível abrir esta imagem." : menuPhotoErrorMessage(e),
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStatus("idle");
      }
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2">
      <label
        htmlFor={inputId}
        className={`inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 ${
          disabled || status === "reading" ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <span aria-hidden>📷</span>
        {status === "reading" ? "Lendo cardápio..." : "Ler cardápio por foto"}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled || status === "reading"}
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p className="mt-1 text-xs text-stone-500">
        A foto é enviada a um serviço de IA só para ler os preços e não é guardada. Nada é salvo
        sem você conferir.
      </p>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-1 text-xs ${message.kind === "error" ? "text-red-300" : "text-emerald-300"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
