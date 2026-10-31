"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker } from "@react-google-maps/api";
import { track } from "@vercel/analytics";
import type { Venue } from "@/types";
import { useGoogleMaps } from "@/lib/use-google-maps";
import { createMapHandle, type MapBounds, type MapHandle } from "@/lib/mapHandle";
import {
  clusterMapVenues,
  formatPriceLabel,
  priceLabelFontSize,
  type ClusterMarkerItem,
  type VenueMarkerItem,
} from "@/lib/map-markers";

export type { MapBounds, MapHandle };

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };

/** Below Tailwind `sm` (640px): hide native controls so they don’t overlap custom UI (e.g. “Onde estou”). */
const MOBILE_MAP_MAX_WIDTH_PX = 639;

const MAP_BASE_STYLES: google.maps.MapTypeStyle[] = [
  {
    featureType: "all",
    elementType: "geometry",
    stylers: [{ saturation: "-20" }, { lightness: "5" }],
  },
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }],
  },
];

const BOUNDS_DEBOUNCE_MS = 250;
// Throttle for reporting bounds during movement so venues can load more continuously.
const BOUNDS_CHANGED_THROTTLE_MS = 400;
const MIN_ZOOM_FOR_BARS = 12;

interface MapProps {
  venues: Venue[];
  center: { lat: number; lng: number };
  zoom: number;
  searchMarker?: { lat: number; lng: number } | null;
  selectedVenueId: string | null;
  onSelectVenue: (id: string | null) => void;
  getMinPrice: (v: Venue) => number;
  onBoundsChange?: (
    bounds: MapBounds,
    zoom: number,
    reason: "idle" | "changing"
  ) => void;
  /**
   * Called with a handle to the live map once it is created. The returned
   * function (if any) runs when that map goes away (unmount, `onUnmount`,
   * StrictMode re-run), so the parent can drop the stale handle.
   */
  onReady?: (handle: MapHandle) => (() => void) | void;
}

function svgDataUrl(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg.trim());
}

const SHADOW_FILTER = `
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.35"/>
        </filter>
      </defs>`;

function makePriceBubbleIconUrl(priceLabel: string, isSelected: boolean): string {
  const bg = isSelected ? "#fbbf24" : "#dc2626";
  const border = isSelected ? "#fef3c7" : "#b91c1c";
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="56" height="32" viewBox="0 0 56 32">
      ${SHADOW_FILTER}
      <path d="M4 0 L52 0 Q56 0 56 4 L56 22 Q56 26 52 26 L12 26 L6 32 L6 26 L4 26 Q0 26 0 22 L0 4 Q0 0 4 0 Z"
            fill="${bg}" stroke="${border}" stroke-width="2" filter="url(#shadow)"/>
      <text x="28" y="18" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-weight="700" font-size="${priceLabelFontSize(priceLabel)}">${priceLabel}</text>
    </svg>
  `);
}

/** Wider bubble: best price of the spot plus a dark "+N" badge for the other bars there. */
function makePricedClusterIconUrl(priceLabel: string, extraCount: number): string {
  const badge = `+${extraCount}`;
  const badgeFontSize = badge.length > 3 ? 7 : 9;
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="68" height="32" viewBox="0 0 68 32">
      ${SHADOW_FILTER}
      <path d="M4 0 L64 0 Q68 0 68 4 L68 22 Q68 26 64 26 L12 26 L6 32 L6 26 L4 26 Q0 26 0 22 L0 4 Q0 0 4 0 Z"
            fill="#dc2626" stroke="#b91c1c" stroke-width="2" filter="url(#shadow)"/>
      <text x="25" y="18" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-weight="700" font-size="${priceLabelFontSize(priceLabel, true)}">${priceLabel}</text>
      <rect x="47" y="5" width="18" height="16" rx="8" fill="#1c1917"/>
      <text x="56" y="16.5" text-anchor="middle" fill="#fbbf24" font-family="system-ui,sans-serif" font-weight="700" font-size="${badgeFontSize}">${badge}</text>
    </svg>
  `);
}

/** Round badge with the number of bars without prices grouped at this spot. */
function makeUnpricedClusterIconUrl(count: number): string {
  const label = String(count);
  const fontSize = label.length > 2 ? 9 : 12;
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      ${SHADOW_FILTER}
      <circle cx="16" cy="16" r="13" fill="#1c1917" stroke="#f59e0b" stroke-width="2" filter="url(#shadow)"/>
      <text x="16" y="20" text-anchor="middle" fill="#fbbf24" font-family="system-ui,sans-serif" font-weight="700" font-size="${fontSize}">${label}</text>
    </svg>
  `);
}

/** Subtle pub pin for a bar without prices yet (tap it to add prices). */
const UNPRICED_PIN_ICON_URL = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      ${SHADOW_FILTER}
      <circle cx="12" cy="12" r="9.5" fill="#292524" stroke="#f59e0b" stroke-width="2" filter="url(#shadow)"/>
      <path d="M12 8 L12 16 M8 12 L16 12" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
    </svg>
`);

/** Small dot for a bar without prices at lower zooms. */
const UNPRICED_DOT_ICON_URL = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
      <circle cx="7" cy="7" r="5.5" fill="#292524" stroke="#f59e0b" stroke-width="2"/>
    </svg>
`);

function venueMarkerIcon(item: VenueMarkerItem): google.maps.Icon {
  if (item.tier === "unpriced") {
    const size = item.compact ? 14 : 24;
    return {
      url: item.compact ? UNPRICED_DOT_ICON_URL : UNPRICED_PIN_ICON_URL,
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(size / 2, size / 2),
    };
  }
  const label = Number.isFinite(item.minPrice) ? formatPriceLabel(item.minPrice) : "?";
  return {
    url: makePriceBubbleIconUrl(label, item.tier === "selected"),
    scaledSize: new google.maps.Size(56, 32),
    anchor: new google.maps.Point(8, 26),
  };
}

function clusterMarkerIcon(item: ClusterMarkerItem): google.maps.Icon {
  if (Number.isFinite(item.minPrice)) {
    return {
      url: makePricedClusterIconUrl(formatPriceLabel(item.minPrice), item.count - 1),
      scaledSize: new google.maps.Size(68, 32),
      anchor: new google.maps.Point(8, 26),
    };
  }
  return {
    url: makeUnpricedClusterIconUrl(item.count),
    scaledSize: new google.maps.Size(32, 32),
    anchor: new google.maps.Point(16, 16),
  };
}

export function Map({
  venues,
  center,
  zoom,
  searchMarker = null,
  selectedVenueId,
  onSelectVenue,
  getMinPrice,
  onBoundsChange,
  onReady,
}: MapProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  /** Live map zoom (the `zoom` prop only follows `idle`), used to cluster markers. */
  const [liveZoom, setLiveZoom] = useState(zoom);
  const initialCenterSet = useRef(false);
  const boundsListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReportedRef = useRef<string>("");
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia(`(max-width: ${MOBILE_MAP_MAX_WIDTH_PX}px)`).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAP_MAX_WIDTH_PX}px)`);
    const onChange = () => setIsMobileViewport(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Latest callback in a ref so a new `onReady` identity doesn't re-announce the map.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Hand the live map to the parent; release it when this map instance goes away.
  useEffect(() => {
    if (!map) return;
    const release = onReadyRef.current?.(createMapHandle(map));
    return () => {
      if (typeof release === "function") release();
    };
  }, [map]);

  // If the script doesn't finish loading in 12s, show a hint and retry option
  const { isLoaded, loadError, timedOut: loadTimeout, hasApiKey: apiKey } = useGoogleMaps();

  // Monitoring: count map load failures (Vercel Web Analytics custom event, no personal data).
  const mapFailure = loadError ? "script_error" : loadTimeout ? "timeout" : !apiKey ? "missing_key" : null;
  useEffect(() => {
    if (mapFailure) track("map_load_error", { reason: mapFailure });
  }, [mapFailure]);

  const onLoad = useCallback((mapInstance: google.maps.Map) => {
    lastReportedRef.current = "";
    setMap(mapInstance);
  }, []);

  const onUnmount = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setMap(null);
    initialCenterSet.current = false;
  }, []);

  // Keep native controls in sync when viewport crosses mobile breakpoint (e.g. rotate device).
  useEffect(() => {
    if (!map) return;
    map.setOptions({
      disableDefaultUI: true,
      zoomControl: !isMobileViewport,
      ...(isMobileViewport
        ? {}
        : { zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM } }),
      fullscreenControl: !isMobileViewport,
      mapTypeControl: false,
      streetViewControl: false,
      scaleControl: false,
      cameraControl: false,
      rotateControl: false,
      panControl: false,
    });
  }, [map, isMobileViewport]);

  // Pan/zoom when center/zoom props change (e.g. address search)
  const { lat: centerLat, lng: centerLng } = center;
  useEffect(() => {
    if (!map) return;
    if (!initialCenterSet.current) {
      initialCenterSet.current = true;
      return;
    }
    map.panTo({ lat: centerLat, lng: centerLng });
    map.setZoom(zoom);
  }, [map, centerLat, centerLng, zoom]);

  // Track the live zoom so clusters split/merge as soon as the user zooms.
  useEffect(() => {
    if (!map) return;
    const sync = () => {
      const z = map.getZoom();
      if (z != null) setLiveZoom(z);
    };
    sync();
    const listener = google.maps.event.addListener(map, "zoom_changed", sync);
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  const markerItems = useMemo(
    () => clusterMapVenues(venues, { zoom: liveZoom, selectedVenueId, getMinPrice }),
    [venues, liveZoom, selectedVenueId, getMinPrice]
  );

  const expandCluster = useCallback(
    (cluster: ClusterMarkerItem) => {
      if (!map) return;
      map.panTo({ lat: cluster.lat, lng: cluster.lng });
      map.setZoom(cluster.expansionZoom);
    },
    [map]
  );

  // Report bounds and zoom on idle so parent can sync state (and clear venues when zoom < 14)
  useEffect(() => {
    if (!map || !onBoundsChange) return;
    const report = (reason: "idle" | "changing") => {
      const bounds = map.getBounds();
      const zoomLevel = map.getZoom();
      if (!bounds || zoomLevel == null) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const bbox: MapBounds = {
        south: sw.lat(),
        west: sw.lng(),
        north: ne.lat(),
        east: ne.lng(),
      };
      const key = `${zoomLevel}-${bbox.south.toFixed(4)}-${bbox.west.toFixed(4)}`;
      if (key === lastReportedRef.current) return;
      lastReportedRef.current = key;
      onBoundsChange(bbox, zoomLevel, reason);
    };

    let lastBoundsChangedReportAt = 0;
    const onBoundsChanged = () => {
      const now = Date.now();
      if (now - lastBoundsChangedReportAt < BOUNDS_CHANGED_THROTTLE_MS) return;
      lastBoundsChangedReportAt = now;
      report("changing"); // Throttled direct report for smoother loading while moving.
    };

    const onIdle = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => report("idle"), BOUNDS_DEBOUNCE_MS);
    };

    // Idle: final report after movement settles.
    boundsListenerRef.current = google.maps.event.addListener(map, "idle", onIdle);
    // Bounds changed: keep parent in sync while the user moves the map.
    const boundsChangedListener = google.maps.event.addListener(
      map,
      "bounds_changed",
      onBoundsChanged
    );

    const t = setTimeout(() => report("idle"), 300);
    return () => {
      if (boundsListenerRef.current) {
        google.maps.event.removeListener(boundsListenerRef.current);
        boundsListenerRef.current = null;
      }
      if (boundsChangedListener) {
        google.maps.event.removeListener(boundsChangedListener);
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearTimeout(t);
    };
  }, [map, onBoundsChange]);

  if (loadError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-stone-900 rounded-xl text-red-400 text-sm p-4 text-center">
        Erro ao carregar o mapa. Verifique a chave do Google Maps em .env.local
      </div>
    );
  }

  if (!isLoaded || !apiKey) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-stone-900 rounded-xl p-4">
        <span className="text-stone-500 text-center">
          {apiKey ? "Carregando mapa..." : "Configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY em .env.local"}
        </span>
        {loadTimeout && apiKey && (
          <div className="flex flex-col items-center gap-2 text-center text-sm">
            <p className="text-amber-200/90">
              O mapa está demorando. Verifique sua conexão e se a chave do Google está correta.
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

  return (
    <GoogleMap
      mapContainerStyle={MAP_CONTAINER_STYLE}
      center={center}
      zoom={zoom}
      onLoad={onLoad}
      onUnmount={onUnmount}
      options={{
        disableDefaultUI: true,
        zoomControl: !isMobileViewport,
        ...(isMobileViewport
          ? {}
          : { zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM } }),
        fullscreenControl: !isMobileViewport,
        mapTypeControl: false,
        streetViewControl: false,
        scaleControl: false,
        cameraControl: false,
        rotateControl: false,
        panControl: false,
        /** One-finger pan on mobile; default `auto` often picks cooperative (two fingers) when the page scrolls. */
        gestureHandling: "greedy",
        styles: MAP_BASE_STYLES,
      }}
    >
      {markerItems.map((item) =>
        item.kind === "cluster" ? (
          <Marker
            key={item.id}
            position={{ lat: item.lat, lng: item.lng }}
            icon={clusterMarkerIcon(item)}
            zIndex={item.zIndex}
            title={`${item.count} bares`}
            onClick={() => expandCluster(item)}
          />
        ) : (
          <Marker
            key={item.id}
            position={{ lat: item.lat, lng: item.lng }}
            icon={venueMarkerIcon(item)}
            zIndex={item.zIndex}
            title={item.venue.name}
            onClick={() => onSelectVenue(item.id)}
          />
        )
      )}

      {searchMarker && (
        <Marker
          position={{ lat: searchMarker.lat, lng: searchMarker.lng }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            strokeColor: "#93c5fd",
            strokeWeight: 2,
          }}
        />
      )}
    </GoogleMap>
  );
}
