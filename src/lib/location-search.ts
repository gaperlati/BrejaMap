/**
 * Pure state helpers of the "Adicionar bar" address search: results are always tied to
 * the query that produced them, so nothing from an older query can be shown or picked
 * while a newer one is typed, debounced or loading.
 *
 * Kept free of React/Next/browser imports so they can be tested with `node --test`.
 */

import type { NearbySearchResult, NominatimResult } from "./geocode";

export const MIN_SEARCH_QUERY_LENGTH = 3;

/** Last search request and its outcome, tagged with the (trimmed) query it was for. */
export type LocationSearchSnapshot =
  | { query: string; status: "loading" }
  | { query: string; status: "error" }
  | ({ query: string; status: "done" } & NearbySearchResult);

export interface LocationSearchView {
  status: "idle" | "loading" | "done" | "error";
  results: NominatimResult[];
  scope: NearbySearchResult["scope"];
}

const IDLE: LocationSearchView = { status: "idle", results: [], scope: "nearby" };
const LOADING: LocationSearchView = { status: "loading", results: [], scope: "nearby" };

/** Whether `query` (trimmed) should be searched: long enough and not the picked label. */
export function isSearchableQuery(query: string, pickedLabel: string | null): boolean {
  return query.length >= MIN_SEARCH_QUERY_LENGTH && query !== pickedLabel;
}

/**
 * What the search UI shows for the current input. A snapshot for another query (the user
 * kept typing) counts as "loading" with no results, during the debounce too.
 */
export function locationSearchView(
  snapshot: LocationSearchSnapshot | null,
  query: string,
  pickedLabel: string | null
): LocationSearchView {
  if (!isSearchableQuery(query, pickedLabel)) return IDLE;
  if (!snapshot || snapshot.query !== query || snapshot.status === "loading") return LOADING;
  if (snapshot.status === "error") return { ...IDLE, status: "error" };
  return { status: "done", results: snapshot.results, scope: snapshot.scope };
}

/** Applies an answer only when it belongs to the request currently on screen. */
export function applySearchOutcome(
  current: LocationSearchSnapshot | null,
  outcome: LocationSearchSnapshot
): LocationSearchSnapshot | null {
  return current?.query === outcome.query && current.status === "loading" ? outcome : current;
}

/** Result picked by Enter: the highlighted one, else the first; none unless results are shown. */
export function resultForEnter(
  view: LocationSearchView,
  activeIndex: number
): NominatimResult | null {
  if (view.status !== "done" || view.results.length === 0) return null;
  return view.results[activeIndex >= 0 && activeIndex < view.results.length ? activeIndex : 0];
}
