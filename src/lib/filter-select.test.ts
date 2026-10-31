import { test } from "node:test";
import assert from "node:assert/strict";
import { findSelectMatch, getSelectPlacement } from "./filter-select";

const options = [
  { value: "all", label: "Todos" },
  { value: "a", label: "Água Vermelha" },
  { value: "c1", label: "Centro" },
  { value: "c2", label: "Cidade Aracy" },
];

test("typeahead ignores accents and cycles repeated letters", () => {
  assert.equal(findSelectMatch(options, "agua", 0), 1);
  assert.equal(findSelectMatch(options, "c", 0), 2);
  assert.equal(findSelectMatch(options, "cc", 2), 3);
  assert.equal(findSelectMatch(options, "ccc", 3), 2);
  assert.equal(findSelectMatch(options, "ci", 2), 3);
  assert.equal(findSelectMatch(options, "zz", 3), 3);
});

test("menu uses space below when it fits and flips above near viewport bottom", () => {
  const viewport = { width: 400, height: 700 };
  assert.deepEqual(getSelectPlacement({ left: 24, top: 60, bottom: 104, width: 352 }, viewport, 6), {
    left: 24, width: 352, top: 110, maxHeight: 288,
  });
  assert.deepEqual(getSelectPlacement({ left: 24, top: 600, bottom: 644, width: 352 }, viewport, 6), {
    left: 24, width: 352, bottom: 106, maxHeight: 288,
  });
});

test("menu caps width and height inside a narrow, short viewport", () => {
  assert.deepEqual(getSelectPlacement({ left: 20, top: 80, bottom: 124, width: 344 }, { width: 280, height: 220 }, 20), {
    left: 8, width: 264, top: 130, maxHeight: 82,
  });
});
