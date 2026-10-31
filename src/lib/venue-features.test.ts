/**
 * Tests for price freshness, venue attributes (football, reservations, outdoor area, opening
 * hours), ratings, menu-photo price merging and OSM near-duplicates: `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BeerPrice, Venue } from "@/types";
import { openStatus, openStatusLabel, parseOpeningHours, venueLocalTime } from "./opening-hours";
import {
  applyVenueAttributesPatch,
  diffVenueAttributes,
  parseVenueAttributesPatch,
  toRpcAttributes,
} from "./venue-attributes";
import { emptyPriceRow, mergeImportedPrices, priceRowsToPrices, toPriceRows } from "./price-rows";
import { daysSince, freshnessLabel, isPriceStale, venueFreshnessLabel } from "./price-freshness";
import { fetchRatingSummaries, ratingLabel, ratingSortValue, withRating } from "./venue-ratings";
import { collapseOsmNearDuplicates, comparePlacePriority, dedupeVenuesByPlace } from "./venue-selection";
import {
  apiVenueToVenue,
  countActiveFilters,
  filterAndSortVenues,
  mergeExternalVenues,
  VenueBboxCache,
} from "./venue-state";
import { formatBRL } from "./format";
import { priceLabelFontSize } from "./map-markers";
import { buildCreateVenueArgs, buildUpdateVenueArgs } from "./venue-writes";
import { sanitizeBeerPrices } from "./price-validation";
import {
  adminEmails,
  confirmRateLimitChecks,
  isAdmin,
  menuPhotoDailyLimit,
  menuPhotoRateLimitChecks,
} from "./write-guards";
import type { RpcClient } from "./venue-writes";

const VENUE_ID = "11111111-2222-4333-8444-555555555555";

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "v",
    name: "Bar",
    address: "",
    neighborhood: "",
    city: "",
    state: "SP",
    lat: -22,
    lng: -47,
    beerPrices: [],
    hasHappyHour: false,
    createdAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

// São Paulo is UTC-3 all year (no DST since 2019).
const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

// --- Opening hours ------------------------------------------------------------------------------

test("venueLocalTime reads weekday and minutes in São Paulo, not UTC", () => {
  // 2026-11-02 is a Monday; 01:30 UTC on Tuesday is still Monday 22:30 in São Paulo.
  assert.deepEqual(venueLocalTime(new Date("2026-11-03T01:30:00Z")), { dayIndex: 0, minutes: 22 * 60 + 30 });
});

test("openStatus handles same-day and overnight intervals, and unknown hours", () => {
  const hours = { fri: [{ open: "18:00", close: "02:00" }], sat: [{ open: "12:00", close: "15:00" }] };
  assert.deepEqual(openStatus(hours, sp("2026-11-06T19:00:00")), { open: true, closesAt: "02:00" }); // Fri
  assert.deepEqual(openStatus(hours, sp("2026-11-07T01:30:00")), { open: true, closesAt: "02:00" }); // Sat early
  assert.deepEqual(openStatus(hours, sp("2026-11-07T02:00:00")), { open: false });
  assert.deepEqual(openStatus(hours, sp("2026-11-07T13:00:00")), { open: true, closesAt: "15:00" });
  assert.deepEqual(openStatus(hours, sp("2026-11-07T15:00:00")), { open: false });
  assert.deepEqual(openStatus(hours, sp("2026-11-05T19:00:00")), { open: false }); // Thursday
  assert.equal(openStatus(undefined, sp("2026-11-06T19:00:00")), null);
  assert.equal(openStatusLabel(hours, sp("2026-11-06T19:00:00")), "Aberto agora · fecha às 02:00");
  assert.equal(openStatusLabel(hours, sp("2026-11-05T19:00:00")), "Fechado agora");
  assert.equal(openStatusLabel(null, new Date()), null);
});

test("openStatus: closing at midnight counts as overnight (open until 00:00)", () => {
  const hours = { mon: [{ open: "18:00", close: "00:00" }] };
  assert.equal(openStatus(hours, sp("2026-11-02T23:59:00"))?.open, true);
  assert.equal(openStatus(hours, sp("2026-11-03T00:00:00"))?.open, false);
});

test("parseOpeningHours validates days, times and interval counts", () => {
  assert.deepEqual(parseOpeningHours(null), { ok: true, value: null });
  assert.deepEqual(parseOpeningHours({ mon: [{ open: "18:00", close: "23:00" }], tue: [] }), {
    ok: true,
    value: { mon: [{ open: "18:00", close: "23:00" }] },
  });
  for (const bad of [
    {},
    { mon: [] },
    { funday: [{ open: "18:00", close: "23:00" }] },
    { mon: [{ open: "24:00", close: "23:00" }] },
    { mon: [{ open: "18:00", close: "18:00" }] },
    { mon: [{ open: "8:00", close: "23:00" }] },
    { mon: "18-23" },
    { mon: Array(4).fill({ open: "10:00", close: "11:00" }) },
    [],
    "18:00",
  ]) {
    assert.equal(parseOpeningHours(bad).ok, false, JSON.stringify(bad));
  }
});

// --- Attributes contract ------------------------------------------------------------------------

test("parseVenueAttributesPatch: absent = unchanged, null = clear, wrong types rejected", () => {
  assert.deepEqual(parseVenueAttributesPatch({}), { ok: true, patch: {} });
  assert.deepEqual(parseVenueAttributesPatch({ transmitsFootball: true, hasOutdoorArea: null }), {
    ok: true,
    patch: { transmitsFootball: true, hasOutdoorArea: null },
  });
  assert.deepEqual(parseVenueAttributesPatch({ acceptsReservations: "yes" }), {
    ok: false,
    field: "acceptsReservations",
  });
  assert.deepEqual(parseVenueAttributesPatch({ openingHours: { mon: [] } }), { ok: false, field: "openingHours" });
  assert.deepEqual(parseVenueAttributesPatch({ openingHours: null }), { ok: true, patch: { openingHours: null } });
});

test("toRpcAttributes keeps only present keys, in column names", () => {
  assert.deepEqual(toRpcAttributes(undefined), {});
  assert.deepEqual(
    toRpcAttributes({ transmitsFootball: false, openingHours: null, acceptsReservations: undefined }),
    { transmits_football: false, opening_hours: null }
  );
});

test("diffVenueAttributes sends only what changed; clearing a known value sends null", () => {
  const initial = { transmitsFootball: true, openingHours: { mon: [{ open: "18:00", close: "23:00" }] } };
  assert.deepEqual(diffVenueAttributes(initial, { ...initial }), {});
  assert.deepEqual(diffVenueAttributes(initial, { ...initial, transmitsFootball: undefined }), {
    transmitsFootball: null,
  });
  assert.deepEqual(diffVenueAttributes(initial, { ...initial, hasOutdoorArea: false }), { hasOutdoorArea: false });
  assert.deepEqual(diffVenueAttributes(initial, { transmitsFootball: true }), { openingHours: null });
});

test("applyVenueAttributesPatch sets, clears and leaves the rest alone", () => {
  const v = venue({ transmitsFootball: true, acceptsReservations: false });
  const next = applyVenueAttributesPatch(v, { transmitsFootball: null, hasOutdoorArea: true });
  assert.equal("transmitsFootball" in next, false);
  assert.equal(next.acceptsReservations, false);
  assert.equal(next.hasOutdoorArea, true);
});

test("write args always carry p_attributes with only the changed columns", () => {
  const update = buildUpdateVenueArgs(VENUE_ID, {
    happyHourDetails: "",
    beerPrices: [],
    attributes: { acceptsReservations: null },
  });
  assert.deepEqual(update.p_attributes, { accepts_reservations: null });
  assert.equal(update.p_replace_prices, false);
  assert.deepEqual(buildUpdateVenueArgs(VENUE_ID, { happyHourDetails: "", beerPrices: [] }).p_attributes, {});
  const create = buildCreateVenueArgs({
    name: "Bar",
    address: "",
    neighborhood: "",
    city: "",
    state: "SP",
    lat: -22,
    lng: -47,
    hasHappyHour: false,
    happyHourDetails: "",
    beerPrices: [{ type: "lata", label: "Skol", priceBRL: 5 }],
    createdBy: null,
    attributes: { hasOutdoorArea: true },
  });
  assert.deepEqual(create.p_attributes, { has_outdoor_area: true });
});

// --- Prices: validation, editor rows, freshness ---------------------------------------------------

test("sanitizeBeerPrices requires integer volumes (the column is integer)", () => {
  assert.deepEqual(sanitizeBeerPrices([{ type: "chope", label: "X", priceBRL: 9, volumeMl: 300.5 }]), []);
  assert.deepEqual(sanitizeBeerPrices([{ type: "chope", label: "X", priceBRL: 9, volumeMl: 300 }]), [
    { type: "chope", label: "X", priceBRL: 9, volumeMl: 300 },
  ]);
});

test("price rows keep the volume both ways and fill a blank brand with the type", () => {
  const prices: BeerPrice[] = [{ id: "a", type: "chope", label: "Brahma", priceBRL: 9.9, volumeMl: 300 }];
  const rows = toPriceRows(prices);
  assert.deepEqual(rows, [{ type: "chope", label: "Brahma", priceBRL: 9.9, volumeMl: 300 }]);
  assert.deepEqual(priceRowsToPrices([...rows, { type: "lata", label: " ", priceBRL: 5 }, emptyPriceRow()]), [
    { type: "chope", label: "Brahma", priceBRL: 9.9, volumeMl: 300 },
    { type: "lata", label: "Lata", priceBRL: 5 },
  ]);
  assert.deepEqual(toPriceRows([]), [emptyPriceRow()]);
});

test("mergeImportedPrices drops blank rows, keeps typed ones, skips repeats and caps at 20", () => {
  const rows = [emptyPriceRow(), { type: "chope" as const, label: "Brahma", priceBRL: 9.9 }];
  const merged = mergeImportedPrices(rows, [
    { type: "chope", label: "brahma", priceBRL: 9.9 },
    { type: "lata", label: "Skol", priceBRL: 6, volumeMl: 350 },
  ]);
  assert.deepEqual(merged, [
    { type: "chope", label: "Brahma", priceBRL: 9.9 },
    { type: "lata", label: "Skol", priceBRL: 6, volumeMl: 350 },
  ]);
  const many = Array.from({ length: 30 }, (_, i) => ({ type: "lata" as const, label: `B${i}`, priceBRL: 5 }));
  assert.equal(mergeImportedPrices([emptyPriceRow()], many).length, 20);
  assert.deepEqual(mergeImportedPrices([emptyPriceRow()], []), [emptyPriceRow()]);
});

test("freshness labels count whole days and handle unknown dates", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  assert.equal(daysSince(undefined, now), null);
  assert.equal(daysSince("garbage", now), null);
  assert.equal(freshnessLabel("2026-10-31T01:00:00Z", now), "Atualizado hoje");
  assert.equal(freshnessLabel("2026-10-30T11:00:00Z", now), "Atualizado há 1 dia");
  assert.equal(freshnessLabel("2026-10-01T12:00:00Z", now), "Atualizado há 30 dias");
  assert.equal(freshnessLabel("2026-07-01T12:00:00Z", now), "Atualizado há 4 meses");
  assert.equal(freshnessLabel(undefined, now), "Data de atualização desconhecida");
  assert.equal(freshnessLabel("2026-11-02T00:00:00Z", now), "Atualizado hoje", "clock skew never goes negative");
  assert.equal(isPriceStale("2026-10-01T12:00:00Z", now), true);
  assert.equal(isPriceStale("2026-10-20T12:00:00Z", now), false);
  assert.equal(isPriceStale(undefined, now), false);
  assert.equal(
    venueFreshnessLabel(
      [
        { type: "lata", label: "a", priceBRL: 1, updatedAt: "2026-10-01T12:00:00Z" },
        { type: "lata", label: "b", priceBRL: 1, updatedAt: "2026-10-29T12:00:00Z" },
        { type: "lata", label: "c", priceBRL: 1 },
      ],
      now
    ),
    "Atualizado há 2 dias"
  );
  assert.equal(venueFreshnessLabel([{ type: "lata", label: "c", priceBRL: 1 }], now), null);
});

test("apiVenueToVenue keeps price ids and timestamps (needed by the confirm button)", () => {
  const v = apiVenueToVenue({
    ...venue(),
    beerPrices: [
      { id: "p1", updatedAt: "2026-10-30T00:00:00Z", type: "lata", label: "Skol", priceBRL: 5 },
      { type: "chope", label: "X", priceBRL: 9 },
    ],
  });
  assert.deepEqual(v.beerPrices[0], {
    id: "p1",
    updatedAt: "2026-10-30T00:00:00Z",
    type: "lata",
    label: "Skol",
    priceBRL: 5,
    volumeMl: undefined,
  });
  assert.equal("id" in v.beerPrices[1], false);
});

// --- Ratings ------------------------------------------------------------------------------------

test("ratingLabel hides averages below 3 ratings", () => {
  assert.equal(ratingLabel({}), "Sem avaliações");
  assert.equal(ratingLabel({ ratingAvg: 5, ratingCount: 2 }), "Poucas avaliações (2)");
  assert.equal(ratingLabel({ ratingAvg: 4.25, ratingCount: 12 }), "★ 4,3 (12 avaliações)");
  assert.equal(ratingSortValue({ ratingAvg: 5, ratingCount: 2 }), -1);
  assert.equal(ratingSortValue({ ratingAvg: 4, ratingCount: 3 }), 4);
});

test("fetchRatingSummaries maps rows and degrades to empty on errors", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls: unknown[] = [];
  const ok: RpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      return {
        data: [
          { venue_id: "a", rating_avg: "4.5", rating_count: 2 },
          { venue_id: "b", rating_avg: null, rating_count: 0 },
        ],
        error: null,
      };
    },
  };
  const map = await fetchRatingSummaries(ok, ["a", "b"]);
  assert.deepEqual([...map], [["a", { avg: 4.5, count: 2 }]]);
  assert.deepEqual(calls, [{ fn: "venue_rating_summaries", args: { p_venue_ids: ["a", "b"] } }]);
  assert.equal((await fetchRatingSummaries(ok, [])).size, 0);
  const missing: RpcClient = { rpc: async () => ({ data: null, error: { code: "PGRST202" } }) };
  assert.equal((await fetchRatingSummaries(missing, ["a"])).size, 0);
  const throws: RpcClient = {
    rpc: async () => {
      throw new Error("down");
    },
  };
  assert.equal((await fetchRatingSummaries(throws, ["a"])).size, 0);
});

test("withRating sets or removes the aggregate", () => {
  const rated = withRating(venue(), { avg: 4, count: 3 });
  assert.equal(rated.ratingAvg, 4);
  const cleared = withRating(rated, undefined);
  assert.equal("ratingAvg" in cleared, false);
  assert.equal("ratingCount" in cleared, false);
});

// --- List filters and sorting --------------------------------------------------------------------

const bounds = { south: -23, west: -48, north: -21, east: -46 };
const filterOptions = {
  mapBounds: bounds,
  maxPrice: null,
  beerType: "" as const,
  neighborhood: "",
  happyHourOnly: false,
  sort: "name" as const,
  userLocation: null,
  mapCenter: { lat: -22, lng: -47 },
};

test("attribute filters keep only venues where the fact is known to be true", () => {
  const all = [
    venue({ id: "yes", name: "A", transmitsFootball: true, acceptsReservations: true, hasOutdoorArea: true }),
    venue({ id: "no", name: "B", transmitsFootball: false, acceptsReservations: false, hasOutdoorArea: false }),
    venue({ id: "unknown", name: "C" }),
  ];
  const ids = (o: object) => filterAndSortVenues(all, { ...filterOptions, ...o }).map((v) => v.id);
  assert.deepEqual(ids({ footballOnly: true }), ["yes"]);
  assert.deepEqual(ids({ reservationsOnly: true }), ["yes"]);
  assert.deepEqual(ids({ outdoorOnly: true }), ["yes"]);
  assert.deepEqual(ids({}), ["yes", "no", "unknown"]);
});

test("open-now filter uses São Paulo time and excludes unknown hours", () => {
  const all = [
    venue({ id: "late", name: "A", openingHours: { fri: [{ open: "18:00", close: "02:00" }] } }),
    venue({ id: "lunch", name: "B", openingHours: { fri: [{ open: "11:00", close: "15:00" }] } }),
    venue({ id: "unknown", name: "C" }),
  ];
  const ids = filterAndSortVenues(all, { ...filterOptions, openNowOnly: true, now: sp("2026-11-06T23:00:00") }).map(
    (v) => v.id
  );
  assert.deepEqual(ids, ["late"]);
});

test("rating sort puts well-rated venues first and few-rating venues last", () => {
  const all = [
    venue({ id: "few", name: "A", ratingAvg: 5, ratingCount: 1 }),
    venue({ id: "good", name: "B", ratingAvg: 4.6, ratingCount: 10 }),
    venue({ id: "ok", name: "C", ratingAvg: 3.1, ratingCount: 4 }),
  ];
  assert.deepEqual(
    filterAndSortVenues(all, { ...filterOptions, sort: "rating" }).map((v) => v.id),
    ["good", "ok", "few"]
  );
});

// --- Cache and dedupe ---------------------------------------------------------------------------

test("VenueBboxCache.replaceVenue updates every cached copy of the saved venue", () => {
  const cache = new VenueBboxCache(5);
  const old = venue({ id: "a", beerPrices: [{ type: "lata", label: "Skol", priceBRL: 5 }] });
  const other = venue({ id: "b" });
  cache.set(bounds, bounds, { venues: [old, other], truncated: false });
  const saved = { ...old, beerPrices: [{ type: "lata" as const, label: "Skol", priceBRL: 6 }] };
  cache.replaceVenue(saved);
  const entry = cache.get(bounds)!;
  assert.equal(entry.venues[0], saved);
  assert.equal(entry.venues[1], other);
});

test("comparePlacePriority: user-added beats priced beats newer (dates no longer dominate)", () => {
  const olderPriced = venue({
    id: "priced",
    createdAt: "2020-01-01T00:00:00Z",
    beerPrices: [{ type: "lata", label: "Skol", priceBRL: 5 }],
  });
  const newerEmpty = venue({ id: "empty", createdAt: "2026-10-30T00:00:00Z" });
  assert.ok(comparePlacePriority(olderPriced, newerEmpty) > 0);
  assert.equal(dedupeVenuesByPlace([olderPriced, newerEmpty])[0].id, "priced");
  assert.deepEqual(mergeExternalVenues([olderPriced, newerEmpty], []).map((v) => v.id), ["priced"]);
  const oldUserAdded = venue({ id: "user", createdAt: "2019-01-01T00:00:00Z", userAdded: true });
  assert.ok(comparePlacePriority(oldUserAdded, olderPriced) > 0);
});

test("collapseOsmNearDuplicates merges same-name OSM entries within 25 m only", () => {
  const a = venue({ id: "node", name: "Bar do Julião", fromOsm: true, lat: -23.5, lng: -46.6 });
  const b = venue({ id: "way", name: " bar do julião ", fromOsm: true, lat: -23.50015, lng: -46.6 }); // ~17 m
  const far = venue({ id: "far", name: "Bar do Julião", fromOsm: true, lat: -23.5005, lng: -46.6 }); // ~56 m
  const user = venue({ id: "user", name: "Bar do Julião", userAdded: true, lat: -23.50001, lng: -46.6 });
  const other = venue({ id: "other", name: "Outro", fromOsm: true, lat: -23.5, lng: -46.6 });
  const ids = collapseOsmNearDuplicates([a, b, far, user, other]).map((v) => v.id).sort();
  assert.deepEqual(ids, ["far", "other", "user", "way"]);
  const priced = { ...a, beerPrices: [{ type: "lata" as const, label: "Skol", priceBRL: 5 }] };
  assert.deepEqual(collapseOsmNearDuplicates([priced, b]).map((v) => v.id), ["node"], "priced copy wins");
});

// --- Guards -------------------------------------------------------------------------------------

test("isAdmin denies by default and requires a confirmed listed e-mail", () => {
  const user = { id: "u", email: "Mod@Example.com", emailConfirmed: true };
  assert.equal(isAdmin(user, {}), false);
  assert.equal(isAdmin(user, { ADMIN_EMAILS: "" }), false);
  assert.equal(isAdmin(user, { ADMIN_EMAILS: " other@x.com , mod@example.com " }), true);
  assert.equal(isAdmin({ ...user, emailConfirmed: false }, { ADMIN_EMAILS: "mod@example.com" }), false);
  assert.equal(isAdmin({ ...user, email: null }, { ADMIN_EMAILS: "mod@example.com" }), false);
  assert.equal(isAdmin(null, { ADMIN_EMAILS: "mod@example.com" }), false);
  assert.deepEqual(adminEmails({ ADMIN_EMAILS: "a@x.com,,not-an-email, B@X.COM" }), ["a@x.com", "b@x.com"]);
});

test("confirm and menu-photo rate limits use their own buckets and keys", () => {
  const confirm = confirmRateLimitChecks("1.2.3.4", VENUE_ID.toUpperCase(), "salt");
  assert.deepEqual(confirm.map((c) => c.bucket), ["price_confirm_ip", "price_confirm_ip_venue"]);
  assert.deepEqual(confirmRateLimitChecks("1.2.3.4", VENUE_ID, "salt"), confirm, "venue id case-insensitive");
  const menu = menuPhotoRateLimitChecks("1.2.3.4", "user", "salt", 50);
  assert.deepEqual(menu.map((c) => c.bucket), ["menu_photo_user", "menu_photo_ip", "menu_photo_global"]);
  assert.equal(menu[2].max_hits, 50);
  assert.equal(menu[2].window_seconds, 86_400);
  assert.equal(menuPhotoRateLimitChecks("9.9.9.9", "other", "salt", 50)[2].key_hash, menu[2].key_hash, "global key");
  assert.equal(menuPhotoDailyLimit({}), 200);
  assert.equal(menuPhotoDailyLimit({ MENU_PHOTO_DAILY_LIMIT: "30" }), 30);
  assert.equal(menuPhotoDailyLimit({ MENU_PHOTO_DAILY_LIMIT: "-1" }), 200);
});

// --- Formatting and filter state -----------------------------------------------------------------

test("formatBRL always shows two decimals with a comma", () => {
  assert.equal(formatBRL(7.9), "R$ 7,90");
  assert.equal(formatBRL(12), "R$ 12,00");
  assert.equal(formatBRL(499.99), "R$ 499,99");
});

test("priceLabelFontSize shrinks long labels, more inside cluster bubbles", () => {
  assert.equal(priceLabelFontSize("R$ 7,90"), 12);
  assert.equal(priceLabelFontSize("R$ 12,50"), 10);
  assert.equal(priceLabelFontSize("R$ 125,00"), 9);
  assert.equal(priceLabelFontSize("R$ 7,90", true), 11);
  assert.equal(priceLabelFontSize("R$ 12,50", true), 9);
});

test("countActiveFilters counts every non-default filter, including sort and tags", () => {
  const defaults = {
    maxPrice: null,
    beerType: "" as const,
    neighborhood: "",
    happyHourOnly: false,
    sort: "price_asc" as const,
    tagFilters: { footballOnly: false, openNowOnly: false },
  };
  assert.equal(countActiveFilters(defaults), 0);
  assert.equal(
    countActiveFilters({
      ...defaults,
      maxPrice: 0,
      beerType: "lata",
      sort: "rating",
      tagFilters: { footballOnly: true, openNowOnly: true },
    }),
    5
  );
});
