"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { isInsideSpState } from "@/lib/geo";
import { placeDetailsFromNominatim, reverseGeocode, type PlaceDetails } from "@/lib/geocode";
import {
  geolocationErrorCode,
  geolocationErrorMessage,
  initialVenueLocation,
  venueLocationReducer,
  type LatLng,
} from "@/lib/venue-location";

/** Wait for the pin to settle before asking Nominatim (its policy is 1 request/s). */
const REVERSE_GEOCODE_DEBOUNCE_MS = 700;
/** A lookup slower than this is reported as failed; the user can type or retry. */
const REVERSE_GEOCODE_TIMEOUT_MS = 10_000;
const DEVICE_LOCATION_TIMEOUT_MS = 15_000;
/** Zoom used when the map jumps to the device location or a street/place result. */
export const PRECISE_PIN_ZOOM = 18;

/** Ask the picker map to move (it reports the new center back through `onMapIdle`). */
export interface MapFocusRequest extends LatLng {
  zoom?: number;
  id: number;
}

/**
 * State of the "Onde fica o bar?" step: pin, confirmation, address lookup and device
 * location. `initialCenter` is only read on mount (the dialog remounts on every open).
 */
export function useVenueLocation(initialCenter: LatLng) {
  const [state, dispatch] = useReducer(venueLocationReducer, initialCenter, initialVenueLocation);
  const [focus, setFocus] = useState<MapFocusRequest | null>(null);
  const [locating, setLocating] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  /** Bumped by every explicit pin action; a device fix from an older action is dropped. */
  const actionIdRef = useRef(0);

  const needsLookup = state.geocodeStatus === "pending";
  const { revision } = state;
  const { lat, lng } = state.pin;

  // Reverse geocode the settled pin. Tagged with `revision`, so an answer that arrives
  // after another move is ignored by the reducer; the request itself is aborted too.
  useEffect(() => {
    if (!needsLookup) return;
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REVERSE_GEOCODE_TIMEOUT_MS);
      reverseGeocode({ lat, lng }, { signal: controller.signal })
        .then((result) => {
          dispatch({
            type: "geocodeSucceeded",
            revision,
            details: result ? placeDetailsFromNominatim(result) : null,
          });
        })
        .catch(() => {
          if (!controller.signal.aborted || timedOut) dispatch({ type: "geocodeFailed", revision });
        })
        .finally(() => clearTimeout(timeout));
    }, REVERSE_GEOCODE_DEBOUNCE_MS);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [needsLookup, revision, lat, lng]);

  /** Drops an in-flight device fix (the user moved on). */
  const cancelPendingActions = useCallback(() => {
    actionIdRef.current += 1;
    setLocating(false);
  }, []);

  const focusMap = useCallback((point: LatLng, zoom?: number) => {
    setFocus((prev) => ({ ...point, zoom, id: (prev?.id ?? 0) + 1 }));
  }, []);

  /** The user started dragging the picker map: the confirmed point is no longer valid. */
  const handleMapMoveStart = useCallback(() => {
    cancelPendingActions();
    setDeviceError(null);
    dispatch({ type: "unconfirm" });
  }, [cancelPendingActions]);

  /** The picker map settled; a different center means the user placed the pin there. */
  const handleMapIdle = useCallback((center: LatLng) => {
    dispatch({ type: "pinMoved", pin: center, source: "map" });
  }, []);

  const selectSearchResult = useCallback(
    (point: LatLng, details: PlaceDetails, zoom: number) => {
      cancelPendingActions();
      setDeviceError(null);
      dispatch({ type: "pinMoved", pin: point, source: "search", details });
      focusMap(point, zoom);
    },
    [cancelPendingActions, focusMap]
  );

  /** Explicit "Usar minha localização": the only place the modal asks for geolocation. */
  const locateDevice = useCallback(() => {
    setDeviceError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setDeviceError(geolocationErrorMessage("unsupported"));
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setDeviceError(geolocationErrorMessage("insecure"));
      return;
    }
    const actionId = ++actionIdRef.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (actionId !== actionIdRef.current) return;
        setLocating(false);
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        if (!isInsideSpState(point.lat, point.lng)) {
          setDeviceError(
            "Sua localização está fora do estado de SP, onde o BrejaMap funciona por enquanto. Ajuste o pino no mapa ou busque o endereço."
          );
          return;
        }
        dispatch({
          type: "pinMoved",
          pin: point,
          source: "device",
          accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        });
        focusMap(point, PRECISE_PIN_ZOOM);
      },
      (error) => {
        if (actionId !== actionIdRef.current) return;
        setLocating(false);
        setDeviceError(geolocationErrorMessage(geolocationErrorCode(error?.code)));
      },
      { enableHighAccuracy: true, timeout: DEVICE_LOCATION_TIMEOUT_MS, maximumAge: 0 }
    );
  }, [focusMap]);

  // Unmount (dialog closed): a late device fix must not touch anything.
  useEffect(() => {
    const actionIdOnMount = actionIdRef;
    return () => {
      actionIdOnMount.current += 1;
    };
  }, []);

  return {
    state,
    dispatch,
    focus,
    locating,
    deviceError,
    handleMapMoveStart,
    handleMapIdle,
    selectSearchResult,
    locateDevice,
  };
}
