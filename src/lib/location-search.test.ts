/**
 * Tests for the "Adicionar bar" search state helpers: run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySearchOutcome,
  isSearchableQuery,
  locationSearchView,
  resultForEnter,
  type LocationSearchSnapshot,
} from "./location-search";
import type { NominatimResult } from "./geocode";

function result(placeId: number, name: string): NominatimResult {
  return { place_id: placeId, lat: "-22.0", lon: "-47.9", display_name: name, name };
}

const OLD = [result(1, "Rua Episcopal"), result(2, "Rua Episcopal 2")];
const NEW = [result(3, "Rua Alvarenga Peixoto")];

const oldDone: LocationSearchSnapshot = {
  query: "Rua Epis",
  status: "done",
  results: OLD,
  scope: "nearby",
};

test("short queries and the picked label are not searched", () => {
  assert.equal(isSearchableQuery("ru", null), false);
  assert.equal(isSearchableQuery("Rua", null), true);
  assert.equal(isSearchableQuery("Rua A — São Carlos, SP", "Rua A — São Carlos, SP"), false);
  assert.equal(locationSearchView(oldDone, "Ru", null).status, "idle");
});

test("results of the previous query disappear as soon as the query changes", () => {
  // Still debouncing: no request for the new query yet.
  const view = locationSearchView(oldDone, "Rua Alvarenga", null);
  assert.equal(view.status, "loading");
  assert.deepEqual(view.results, []);
  // Its own results are shown once they arrive.
  assert.deepEqual(locationSearchView(oldDone, "Rua Epis", null).results, OLD);
});

test("Enter picks nothing while the new query is debouncing or loading", () => {
  const debouncing = locationSearchView(oldDone, "Rua Alvarenga", null);
  assert.equal(resultForEnter(debouncing, 0), null);
  assert.equal(resultForEnter(debouncing, -1), null);
  const loading = locationSearchView({ query: "Rua Alvarenga", status: "loading" }, "Rua Alvarenga", null);
  assert.equal(resultForEnter(loading, 1), null);
});

test("Enter picks the highlighted result, else the first one", () => {
  const view = locationSearchView(oldDone, "Rua Epis", null);
  assert.equal(resultForEnter(view, 1)?.place_id, 2);
  assert.equal(resultForEnter(view, -1)?.place_id, 1);
  // An index left over from a longer list falls back to the first result.
  assert.equal(resultForEnter(view, 5)?.place_id, 1);
  const empty = locationSearchView({ ...oldDone, results: [] }, "Rua Epis", null);
  assert.equal(resultForEnter(empty, 0), null);
});

test("a late answer for an older query is ignored", () => {
  const current: LocationSearchSnapshot = { query: "Rua Alvarenga", status: "loading" };
  const stale = applySearchOutcome(current, { ...oldDone });
  assert.equal(stale, current);
  const staleError = applySearchOutcome(current, { query: "Rua Epis", status: "error" });
  assert.equal(staleError, current);
  const fresh = applySearchOutcome(current, {
    query: "Rua Alvarenga",
    status: "done",
    results: NEW,
    scope: "wide",
  });
  const view = locationSearchView(fresh, "Rua Alvarenga", null);
  assert.equal(view.status, "done");
  assert.equal(view.scope, "wide");
  assert.deepEqual(view.results, NEW);
});

test("an answer never resurrects a search that was cleared by a pick", () => {
  assert.equal(applySearchOutcome(null, { ...oldDone }), null);
  // Nor overwrites an outcome already applied for the same query.
  const done: LocationSearchSnapshot = { ...oldDone };
  assert.equal(applySearchOutcome(done, { query: "Rua Epis", status: "error" }), done);
});

test("a failed search shows the error only for its own query", () => {
  const failed: LocationSearchSnapshot = { query: "Rua Epis", status: "error" };
  assert.equal(locationSearchView(failed, "Rua Epis", null).status, "error");
  assert.equal(locationSearchView(failed, "Rua Episc", null).status, "loading");
});
