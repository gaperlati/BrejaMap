"use client";

import Script from "next/script";

/**
 * Preloads the Google Maps JavaScript API so it starts loading as soon as the app
 * loads. When the Map component mounts, useJsApiLoader will use the same script
 * (cached) or wait for it. This can prevent the map from staying stuck on "Carregando...".
 */
export function GoogleMapsScript() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=maps&v=weekly`;
  return (
    <Script
      src={src}
      strategy="afterInteractive"
      onLoad={() => {
        if (typeof window !== "undefined") {
          (window as unknown as { __GOOGLE_MAPS_PRELOADED__?: boolean }).__GOOGLE_MAPS_PRELOADED__ = true;
        }
      }}
    />
  );
}
