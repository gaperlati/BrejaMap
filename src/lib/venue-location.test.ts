/**
 * Tests for the "Adicionar bar" location state: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaceDetails } from "./geocode";
import {
  canConfirmLocation,
  geolocationErrorCode,
  geolocationErrorMessage,
  hasEditedAddressDiverged,
  initialVenueLocation,
  isLocationReadyToSave,
  locationPreviewSubtitle,
  locationPreviewTitle,
  pickerZoom,
  pinSourceLabel,
  venueLocationPayload,
  venueLocationReducer as reduce,
  type VenueLocationAction,
  type VenueLocationState,
} from "./venue-location";

const SAO_CARLOS = { lat: -22.0175, lng: -47.8909 };
const NEARBY = { lat: -22.0201, lng: -47.8862 };
const RIO = { lat: -22.9068, lng: -43.1729 };

const ALVARENGA: PlaceDetails = {
  address: "Rua Alvarenga Peixoto",
  neighborhood: "Vila Prado",
  city: "São Carlos",
  state: "SP",
};
const CENTRO: PlaceDetails = {
  address: "Rua Episcopal, 1500",
  neighborhood: "Centro",
  city: "São Carlos",
  state: "SP",
};

function run(state: VenueLocationState, ...actions: VenueLocationAction[]): VenueLocationState {
  return actions.reduce(reduce, state);
}

test("starts at the map center, unconfirmed, with the address lookup pending", () => {
  const s = initialVenueLocation(SAO_CARLOS);
  assert.deepEqual(s.pin, SAO_CARLOS);
  assert.equal(s.source, "initial");
  assert.equal(s.confirmed, false);
  assert.equal(s.geocodeStatus, "pending");
  assert.equal(isLocationReadyToSave(s), false);
});

test("the default center is never saveable without an explicit confirmation", () => {
  const s = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "geocodeSucceeded", revision: 0, details: ALVARENGA }
  );
  assert.equal(isLocationReadyToSave(s), false);
  const confirmed = reduce(s, { type: "confirm" });
  assert.equal(isLocationReadyToSave(confirmed), true);
  assert.deepEqual(venueLocationPayload(confirmed), { ...SAO_CARLOS, ...ALVARENGA });
});

test("without a map, the untouched starting point can't be confirmed", () => {
  const s = initialVenueLocation(SAO_CARLOS);
  assert.equal(canConfirmLocation(s, false), false);
  assert.equal(canConfirmLocation(s, true), true);
  const searched = reduce(s, { type: "pinMoved", pin: NEARBY, source: "search", details: CENTRO });
  assert.equal(canConfirmLocation(searched, false), true);
});

test("moving the pin clears confirmation and the previous point's address", () => {
  const confirmed = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "geocodeSucceeded", revision: 0, details: ALVARENGA },
    { type: "confirm" }
  );
  const moved = reduce(confirmed, { type: "pinMoved", pin: NEARBY, source: "map" });
  assert.equal(moved.confirmed, false);
  assert.equal(moved.revision, 1);
  assert.equal(moved.geocodeStatus, "pending");
  assert.deepEqual(moved.fields, { address: "", neighborhood: "", city: "", state: "" });
  assert.equal(locationPreviewTitle(moved.fields), "Endereço não identificado");
});

test("a stale reverse-geocode answer is ignored", () => {
  const moved = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "pinMoved", pin: NEARBY, source: "map" }
  );
  // Answer for revision 0 (the old center) arrives after the move to revision 1.
  const stale = reduce(moved, { type: "geocodeSucceeded", revision: 0, details: ALVARENGA });
  assert.equal(stale, moved);
  const staleFail = reduce(moved, { type: "geocodeFailed", revision: 0 });
  assert.equal(staleFail, moved);
  const fresh = reduce(moved, { type: "geocodeSucceeded", revision: 1, details: CENTRO });
  assert.deepEqual(fresh.fields, CENTRO);
  assert.equal(fresh.geocodeStatus, "done");
});

test("a failed lookup leaves blank fields, still saveable once confirmed, and can retry", () => {
  const failed = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "pinMoved", pin: NEARBY, source: "map" },
    { type: "geocodeFailed", revision: 1 },
    { type: "confirm" }
  );
  assert.equal(failed.geocodeStatus, "error");
  assert.equal(failed.fields.city, "");
  assert.equal(isLocationReadyToSave(failed), true);
  assert.equal(venueLocationPayload(failed).state, "SP");
  const retry = reduce(failed, { type: "retryGeocode" });
  assert.equal(retry.geocodeStatus, "pending");
  assert.equal(isLocationReadyToSave(retry), false);
});

test("confirming during the lookup waits for the address before saving", () => {
  const s = run(initialVenueLocation(SAO_CARLOS), { type: "confirm" });
  assert.equal(s.confirmed, true);
  assert.equal(isLocationReadyToSave(s), false);
  const done = reduce(s, { type: "geocodeSucceeded", revision: 0, details: ALVARENGA });
  assert.equal(done.confirmed, true);
  assert.equal(isLocationReadyToSave(done), true);
});

test("the map reporting the same center (after a programmatic pan) is a no-op", () => {
  const searched = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "pinMoved", pin: NEARBY, source: "search", details: CENTRO },
    { type: "confirm" }
  );
  const idle = reduce(searched, {
    type: "pinMoved",
    pin: { lat: NEARBY.lat + 1e-7, lng: NEARBY.lng - 1e-7 },
    source: "map",
  });
  assert.equal(idle, searched);
  assert.equal(idle.source, "search");
  assert.equal(idle.confirmed, true);
});

test("a search pick fills the address immediately without a lookup", () => {
  const s = reduce(initialVenueLocation(SAO_CARLOS), {
    type: "pinMoved",
    pin: NEARBY,
    source: "search",
    details: CENTRO,
  });
  assert.equal(s.geocodeStatus, "done");
  assert.deepEqual(s.fields, CENTRO);
  assert.equal(pinSourceLabel(s.source, s.accuracyM), "Resultado da busca");
});

test("typed fields survive pin moves and lookups; others follow the pin", () => {
  const s = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "geocodeSucceeded", revision: 0, details: ALVARENGA },
    { type: "editField", field: "address", value: "Rua Alvarenga Peixoto, 120" },
    { type: "pinMoved", pin: NEARBY, source: "map" }
  );
  assert.equal(s.fields.address, "Rua Alvarenga Peixoto, 120");
  assert.equal(s.fields.city, "");
  const found = reduce(s, { type: "geocodeSucceeded", revision: 1, details: CENTRO });
  assert.equal(found.fields.address, "Rua Alvarenga Peixoto, 120");
  assert.equal(found.fields.neighborhood, "Centro");
  assert.equal(hasEditedAddressDiverged(found), true);
  const reset = reduce(found, { type: "useDetectedAddress" });
  assert.deepEqual(reset.fields, CENTRO);
  assert.equal(hasEditedAddressDiverged(reset), false);
});

test("a search pick replaces typed fields (it is an explicit new address)", () => {
  const s = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "editField", field: "city", value: "Araraquara" },
    { type: "pinMoved", pin: NEARBY, source: "search", details: CENTRO }
  );
  assert.deepEqual(s.fields, CENTRO);
  assert.equal(s.edited.city, false);
});

test("device location keeps its accuracy; other sources drop it", () => {
  const device = reduce(initialVenueLocation(SAO_CARLOS), {
    type: "pinMoved",
    pin: NEARBY,
    source: "device",
    accuracyM: 240,
  });
  assert.equal(device.accuracyM, 240);
  assert.equal(pinSourceLabel(device.source, device.accuracyM), "Sua localização (precisão de ~240 m)");
  const dragged = reduce(device, { type: "pinMoved", pin: SAO_CARLOS, source: "map" });
  assert.equal(dragged.accuracyM, null);
});

test("points outside São Paulo state can't be confirmed or saved", () => {
  const s = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "pinMoved", pin: RIO, source: "map" },
    { type: "geocodeSucceeded", revision: 1, details: null },
    { type: "confirm" }
  );
  assert.equal(s.confirmed, false);
  assert.equal(canConfirmLocation(s), false);
  assert.equal(isLocationReadyToSave({ ...s, confirmed: true }), false);
});

test("unconfirm only flips a confirmed state", () => {
  const s = initialVenueLocation(SAO_CARLOS);
  assert.equal(reduce(s, { type: "unconfirm" }), s);
  const c = reduce(s, { type: "confirm" });
  assert.equal(reduce(c, { type: "unconfirm" }).confirmed, false);
});

test("preview labels skip empty parts and repetition", () => {
  assert.equal(locationPreviewTitle(ALVARENGA), "Rua Alvarenga Peixoto");
  assert.equal(locationPreviewSubtitle(ALVARENGA), "Vila Prado · São Carlos - SP");
  const cityOnly = { address: "", neighborhood: "", city: "São Carlos", state: "SP" };
  assert.equal(locationPreviewTitle(cityOnly), "São Carlos");
  assert.equal(locationPreviewSubtitle(cityOnly), "São Carlos - SP");
  const neighborhoodOnly = { address: "", neighborhood: "Centro", city: "", state: "" };
  assert.equal(locationPreviewSubtitle(neighborhoodOnly), "");
});

test("payload trims fields and keeps full coordinate precision", () => {
  const pin = { lat: -22.017512345, lng: -47.890987654 };
  const s = run(
    initialVenueLocation(SAO_CARLOS),
    { type: "pinMoved", pin, source: "map" },
    { type: "editField", field: "address", value: "  Rua A, 10  " }
  );
  const p = venueLocationPayload(s);
  assert.equal(p.lat, pin.lat);
  assert.equal(p.lng, pin.lng);
  assert.equal(p.address, "Rua A, 10");
  assert.equal(p.state, "SP");
});

test("picker zoom is close enough to place a pin on a building", () => {
  assert.equal(pickerZoom(13), 17);
  assert.equal(pickerZoom(18.4), 18);
  assert.equal(pickerZoom(21), 19);
  assert.equal(pickerZoom(undefined), 17);
  assert.equal(pickerZoom(Number.NaN), 17);
});

test("geolocation errors map to pt-BR messages", () => {
  assert.equal(geolocationErrorCode(1), "denied");
  assert.equal(geolocationErrorCode(2), "unavailable");
  assert.equal(geolocationErrorCode(3), "timeout");
  assert.equal(geolocationErrorCode(undefined), "unavailable");
  assert.match(geolocationErrorMessage("denied"), /Permissão de localização negada/);
  assert.match(geolocationErrorMessage("insecure"), /https/);
});
