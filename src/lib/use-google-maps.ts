"use client";

import { useEffect, useState } from "react";
import { useJsApiLoader } from "@react-google-maps/api";

export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/** Past this, a script that hasn't loaded is reported as slow (`timedOut`). */
const LOAD_TIMEOUT_MS = 12_000;

/**
 * Loads the Google Maps JS API once for the whole app. Every map must go through this hook:
 * `useJsApiLoader` throws if two callers pass different options.
 */
export function useGoogleMaps() {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY || "",
    preventGoogleFontsLoading: true,
    version: "weekly",
  });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (isLoaded || loadError || !GOOGLE_MAPS_API_KEY) return;
    const t = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isLoaded, loadError]);

  return { isLoaded, loadError, timedOut, hasApiKey: !!GOOGLE_MAPS_API_KEY };
}
