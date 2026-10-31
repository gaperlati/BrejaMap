"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Venue, BeerType, BeerPrice } from "@/types";
import {
  confirmErrorMessage,
  confirmVenuePrice,
  reportErrorMessage,
  saveErrorMessage,
  venueRating,
} from "@/lib/api";
import { WEEKDAYS, WEEKDAY_LABELS, formatDayHours, openStatusLabel } from "@/lib/opening-hours";
import { freshnessLabel, isPriceStale } from "@/lib/price-freshness";
import { formatBRL } from "@/lib/format";
import { getAccessToken } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/use-auth-user";
import { apiVenueToVenue } from "@/lib/venue-state";
import { ratingLabel } from "@/lib/venue-ratings";

interface VenueSheetProps {
  venue: Venue | null;
  onClose: () => void;
  beerTypeLabels: Record<BeerType, string>;
  getMinPrice: (v: Venue) => number;
  priceTypeLabel?: string;
  onAddPrices?: (venue: Venue) => void;
  /** Flags the venue's prices as wrong; rejects on failure. */
  onReportPrices?: (venue: Venue) => Promise<void>;
  /** A newer version of the venue came back from the API (price confirmed, rating changed). */
  onVenueSaved?: (venue: Venue) => void;
  /** Favorite heart; omitted when login is not configured. */
  favorite?: { isFavorite: boolean; signedIn: boolean; onToggle: () => Promise<void> };
}

/** "Sinalizar preços incorretos": one report per opened venue, then a thank-you note. */
function ReportPricesButton({ venue, onReport }: { venue: Venue; onReport: (venue: Venue) => Promise<void> }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "sent") {
    return (
      <p role="status" className="mt-4 text-sm text-emerald-300">
        Obrigado! Vamos revisar os preços deste bar.
      </p>
    );
  }

  const handleClick = async () => {
    setStatus("sending");
    setError(null);
    try {
      await onReport(venue);
      setStatus("sent");
    } catch (e) {
      setError(reportErrorMessage(e));
      setStatus("idle");
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "sending"}
        className="text-xs text-stone-400 underline underline-offset-2 hover:text-stone-200 disabled:opacity-60"
      >
        <span aria-hidden>🚩 </span>
        {status === "sending" ? "Enviando..." : "Sinalizar preços incorretos"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/** One price with its freshness and "Ainda é esse preço? Sim / Não". */
function PriceLine({
  venue,
  price,
  label,
  onConfirmed,
  onWrong,
}: {
  venue: Venue;
  price: BeerPrice;
  label: string;
  onConfirmed?: (venue: Venue) => void;
  onWrong?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const stale = isPriceStale(price.updatedAt);

  const confirm = async () => {
    if (!price.id) return;
    setStatus("sending");
    setError(null);
    try {
      const saved = apiVenueToVenue(await confirmVenuePrice(venue.id, price.id));
      setStatus("done");
      onConfirmed?.(saved);
    } catch (e) {
      setError(confirmErrorMessage(e));
      setStatus("idle");
    }
  };

  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-stone-200">
          {label}
          {price.volumeMl ? <span className="text-stone-500"> · {price.volumeMl} ml</span> : null}
        </span>
        <span className="font-semibold text-amber-400">{formatBRL(price.priceBRL)}</span>
      </div>
      <p className={`text-xs ${stale ? "text-amber-300" : "text-stone-500"}`}>
        {status === "done" ? "Confirmado agora. Obrigado!" : freshnessLabel(price.updatedAt)}
      </p>
      {price.id && status !== "done" && onConfirmed && (
        <p className="mt-0.5 text-xs text-stone-400">
          Ainda é esse preço?{" "}
          <button
            type="button"
            onClick={confirm}
            disabled={status === "sending"}
            className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200 disabled:opacity-60"
          >
            {status === "sending" ? "Enviando..." : "Sim"}
          </button>
          {onWrong && (
            <>
              {" · "}
              <button
                type="button"
                onClick={onWrong}
                className="text-amber-300 underline underline-offset-2 hover:text-amber-200"
              >
                Não, corrigir
              </button>
            </>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </li>
  );
}

/** Stars 1–5 for signed-in users; average shown only from MIN_RATINGS_TO_SHOW ratings. */
function RatingSection({ venue, onSaved }: { venue: Venue; onSaved?: (venue: Venue) => void }) {
  const auth = useAuthUser();
  const [myScore, setMyScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = auth.user?.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const state = await venueRating(venue.id, token);
        if (active) setMyScore(state.score);
      } catch {
        // Not critical: the stars start empty.
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, venue.id]);

  const rate = async (score: number | null) => {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const state = await venueRating(venue.id, token, score);
      setMyScore(state.score);
      const { ratingAvg: _a, ratingCount: _c, ...rest } = venue;
      void _a;
      void _c;
      onSaved?.(
        state.ratingCount > 0 && state.ratingAvg != null
          ? { ...rest, ratingAvg: state.ratingAvg, ratingCount: state.ratingCount }
          : rest
      );
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!auth.configured) return null;

  return (
    <div className="mt-4">
      <p className="text-sm text-stone-300">{ratingLabel(venue)}</p>
      {auth.user ? (
        <div className="mt-1 flex items-center gap-1" role="group" aria-label="Sua avaliação">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy}
              onClick={() => rate(n)}
              aria-label={`Dar nota ${n}`}
              aria-pressed={myScore === n}
              className={`text-xl leading-none disabled:opacity-60 ${
                myScore != null && n <= myScore ? "text-amber-400" : "text-stone-600 hover:text-amber-300"
              }`}
            >
              ★
            </button>
          ))}
          {myScore != null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => rate(null)}
              className="ml-2 text-xs text-stone-400 underline underline-offset-2 hover:text-stone-200"
            >
              Remover nota
            </button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs text-stone-400">
          <Link href="/conta" className="text-amber-400 underline underline-offset-2">
            Entre na sua conta
          </Link>{" "}
          para avaliar este bar.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function FavoriteButton({ favorite }: { favorite: NonNullable<VenueSheetProps["favorite"]> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!favorite.signedIn) {
    return (
      <Link
        href="/conta"
        className="shrink-0 rounded-full border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800"
        title="Entre na sua conta para salvar favoritos"
      >
        ♡ Favoritar
      </Link>
    );
  }
  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={busy}
        aria-pressed={favorite.isFavorite}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await favorite.onToggle();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className={`rounded-full border px-3 py-1.5 text-xs disabled:opacity-60 ${
          favorite.isFavorite
            ? "border-rose-500/60 bg-rose-500/20 text-rose-200"
            : "border-stone-700 text-stone-300 hover:bg-stone-800"
        }`}
      >
        {favorite.isFavorite ? "♥ Favorito" : "♡ Favoritar"}
      </button>
      {error && (
        <p role="alert" className="mt-1 max-w-[12rem] text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

const TAG_CLASS = "px-2.5 py-1 rounded-md bg-stone-700 text-stone-300 text-xs";

export function VenueSheet({
  venue,
  onClose,
  beerTypeLabels,
  getMinPrice,
  priceTypeLabel,
  onAddPrices,
  onReportPrices,
  onVenueSaved,
  favorite,
}: VenueSheetProps) {
  if (!venue) return null;

  const minPrice = getMinPrice(venue);
  const hasPrices = venue.beerPrices.length > 0 && Number.isFinite(minPrice);
  const fullAddress = [venue.address, venue.neighborhood, venue.city, venue.state]
    .filter(Boolean)
    .join(", ");
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue.lat + "," + venue.lng)}`;
  const openLabel = openStatusLabel(venue.openingHours, new Date());
  const priceLabel = (p: BeerPrice) => (p.label?.trim() ? p.label : beerTypeLabels[p.type]);

  return (
    <>
      <div
        className="fixed inset-0 z-[9000] bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="app-scrollbar fixed bottom-0 left-0 right-0 z-[9001] bg-stone-900 border-t border-stone-700 rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto animate-slide-up"
        role="dialog"
        aria-label="Detalhes do bar"
      >
        <div className="sticky top-0 bg-stone-900 flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 rounded-full bg-stone-600" aria-hidden />
        </div>

        {(venue.userAdded || venue.pricesUnverified) && (
          <div className="mx-4 mb-3 py-2.5 px-3 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-sm">
            {venue.userAdded
              ? "Preços não verificados (adicionado por um usuário)"
              : "Preços não verificados (informados pela comunidade)"}
          </div>
        )}

        {venue.fromOsm && (
          <div className="mx-4 mb-3 py-2.5 px-3 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-200 text-sm">
            {venue.beerPrices.length === 0
              ? "Dados do OpenStreetMap. Preços não informados – adicione se souber."
              : "Localização: dados do OpenStreetMap."}
          </div>
        )}

        {venue.fromGoogle && (
          <div className="mx-4 mb-3 py-2.5 px-3 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm">
            {venue.beerPrices.length === 0
              ? "Dados do Google Maps. Preços não informados – adicione se souber."
              : "Localização: dados do Google Maps."}
          </div>
        )}

        <div className="px-4 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-stone-100">{venue.name}</h2>
              <p className="text-stone-400 text-sm mt-0.5">{fullAddress}</p>
            </div>
            {favorite && <FavoriteButton favorite={favorite} />}
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <span className={TAG_CLASS}>
              {venue.beerPrices.length === 0
                ? "Preços não informados"
                : `${venue.beerPrices.length} cerveja${venue.beerPrices.length !== 1 ? "s" : ""} servida${venue.beerPrices.length !== 1 ? "s" : ""}`}
            </span>
            {openLabel && (
              <span
                className={`px-2.5 py-1 rounded-md text-xs ${
                  openLabel.startsWith("Aberto") ? "bg-emerald-500/20 text-emerald-300" : "bg-stone-700 text-stone-400"
                }`}
              >
                {openLabel}
              </span>
            )}
            {venue.hasHappyHour && (
              <span className="px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-400 text-xs">
                Happy hour
              </span>
            )}
            {venue.transmitsFootball === true && <span className={TAG_CLASS}>⚽ Transmite futebol</span>}
            {venue.acceptsReservations === true && <span className={TAG_CLASS}>📅 Aceita reserva</span>}
            {venue.acceptsReservations === false && <span className={TAG_CLASS}>Não aceita reserva</span>}
            {venue.hasOutdoorArea === true && <span className={TAG_CLASS}>🌳 Área externa</span>}
          </div>

          <p className="text-amber-400 font-semibold mt-3">
            {hasPrices
              ? `${priceTypeLabel ? `${priceTypeLabel} — a` : "A"} partir de ${formatBRL(minPrice)}`
              : "—"}
          </p>
          {venue.hasHappyHour && venue.happyHourDetails && (
            <p className="text-stone-400 text-sm mt-1">
              🎉 {venue.happyHourDetails}
            </p>
          )}

          {venue.beerPrices.length > 0 && (
            <ul className="mt-3 divide-y divide-stone-800" aria-label="Preços">
              {venue.beerPrices.map((p, i) => (
                <PriceLine
                  key={p.id ?? `price-${i}`}
                  venue={venue}
                  price={p}
                  label={priceLabel(p)}
                  onConfirmed={onVenueSaved}
                  onWrong={onAddPrices ? () => onAddPrices(venue) : undefined}
                />
              ))}
            </ul>
          )}

          {venue.openingHours && (
            <details className="mt-3 rounded-lg border border-stone-800 px-3 py-2">
              <summary className="cursor-pointer text-sm text-stone-300">Horário de funcionamento</summary>
              <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1 text-xs">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="contents">
                    <dt className="text-stone-500">{WEEKDAY_LABELS[day]}</dt>
                    <dd className="text-stone-300">{formatDayHours(venue.openingHours?.[day])}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] text-stone-500">Informado pela comunidade; horário de Brasília.</p>
            </details>
          )}

          <RatingSection key={venue.id} venue={venue} onSaved={onVenueSaved} />

          <div
            className="mt-5 -mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
            role="toolbar"
            aria-label="Ações do bar"
          >
            {onAddPrices && (
              <button
                type="button"
                onClick={() => onAddPrices(venue)}
                className="flex min-h-[2.75rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-amber-500 px-2.5 py-2.5 text-xs font-medium text-stone-950 transition hover:bg-amber-400 sm:min-w-0 sm:flex-1 sm:gap-2 sm:px-3 sm:py-3 sm:text-sm"
              >
                <span aria-hidden className="shrink-0">
                  🍺
                </span>
                {venue.beerPrices.length === 0 ? "Adicionar preços" : "Editar preços"}
              </button>
            )}
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[2.75rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-stone-700 px-2.5 py-2.5 text-xs font-medium text-stone-100 transition hover:bg-stone-600 sm:min-w-0 sm:flex-1 sm:gap-2 sm:px-3 sm:py-3 sm:text-sm"
            >
              <span aria-hidden className="shrink-0">
                🚶
              </span>
              Como chegar
            </a>
          </div>

          {onReportPrices && venue.beerPrices.length > 0 && (
            <ReportPricesButton key={venue.id} venue={venue} onReport={onReportPrices} />
          )}
        </div>
      </div>
    </>
  );
}
