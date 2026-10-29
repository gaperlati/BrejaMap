"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap } from "@react-google-maps/api";
import { useGoogleMaps } from "@/lib/use-google-maps";
import type { LatLng } from "@/lib/venue-location";
import type { MapFocusRequest } from "@/lib/use-venue-location";

export type PickerMapStatus = "loading" | "ready" | "unavailable";

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };

interface VenueLocationMapProps {
  /** Only read on mount; later moves go through `focus`. */
  initialCenter: LatLng;
  initialZoom: number;
  focus: MapFocusRequest | null;
  onMoveStart: () => void;
  onIdle: (center: LatLng) => void;
  onStatusChange: (status: PickerMapStatus) => void;
}

/**
 * Small map with a pin fixed at its center: the user drags the map (or taps a spot) until
 * the pin sits on the bar. Points of interest stay visible to help find the right door.
 */
export function VenueLocationMap({
  initialCenter,
  initialZoom,
  focus,
  onMoveStart,
  onIdle,
  onStatusChange,
}: VenueLocationMapProps) {
  const { isLoaded, loadError, timedOut, hasApiKey } = useGoogleMaps();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [dragging, setDragging] = useState(false);
  // Stable references: GoogleMap re-applies `center`/`zoom` whenever their identity changes.
  const [center] = useState(initialCenter);
  const [zoom] = useState(initialZoom);

  const status: PickerMapStatus =
    !hasApiKey || loadError || (timedOut && !isLoaded) ? "unavailable" : map ? "ready" : "loading";

  const onStatusChangeRef = useRef(onStatusChange);
  const onMoveStartRef = useRef(onMoveStart);
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    onMoveStartRef.current = onMoveStart;
    onIdleRef.current = onIdle;
  }, [onStatusChange, onMoveStart, onIdle]);

  useEffect(() => {
    onStatusChangeRef.current(status);
  }, [status]);

  useEffect(() => {
    if (!map) return;
    const listeners = [
      map.addListener("dragstart", () => {
        setDragging(true);
        onMoveStartRef.current();
      }),
      map.addListener("dragend", () => setDragging(false)),
      map.addListener("idle", () => {
        const c = map.getCenter();
        if (c) onIdleRef.current({ lat: c.lat(), lng: c.lng() });
      }),
      // Tap/click a spot: move the pin there.
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        onMoveStartRef.current();
        map.panTo(e.latLng);
      }),
    ];
    return () => listeners.forEach((l) => google.maps.event.removeListener(l));
  }, [map]);

  // Search result / device location: move the map under the pin.
  useEffect(() => {
    if (!map || !focus) return;
    if (focus.zoom != null) map.setZoom(focus.zoom);
    map.panTo({ lat: focus.lat, lng: focus.lng });
  }, [map, focus]);

  const handleLoad = useCallback((m: google.maps.Map) => setMap(m), []);
  const handleUnmount = useCallback(() => setMap(null), []);

  if (status === "unavailable") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-stone-900 p-4 text-center text-sm text-stone-400">
        <span aria-hidden>🗺️</span>
        <p>O mapa não carregou.</p>
        <p className="text-xs text-stone-500">
          Use “Usar minha localização” ou busque o endereço acima.
        </p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-stone-900 text-sm text-stone-500">
        Carregando mapa...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={center}
        zoom={zoom}
        onLoad={handleLoad}
        onUnmount={handleUnmount}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
          clickableIcons: false,
          // One finger pans the map inside the modal (the pin is what the user is placing).
          gestureHandling: "greedy",
          keyboardShortcuts: true,
        }}
      />
      {/* Pin fixed at the map center; its tip marks the exact point. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-full"
      >
        <svg
          width="34"
          height="44"
          viewBox="0 0 34 44"
          className={`drop-shadow-lg transition-transform duration-150 ${dragging ? "-translate-y-2" : ""}`}
        >
          <path
            d="M17 1C8.2 1 1 8 1 16.7 1 28.5 17 43 17 43s16-14.5 16-26.3C33 8 25.8 1 17 1z"
            fill="#f59e0b"
            stroke="#1c1917"
            strokeWidth="2"
          />
          <circle cx="17" cy="16.5" r="6" fill="#1c1917" />
        </svg>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-950/70"
      />
    </div>
  );
}
