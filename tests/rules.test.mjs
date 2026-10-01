import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, cleanGame } from "../api/src/rules.js";

test("names are tidied and checked", () => {
  assert.equal(cleanName("  Ada   Lovelace "), "Ada Lovelace");
  for (const bad of ["", "a", "x".repeat(21), "<script>", "Robert'); DROP", "Theo", "theo ballardie", null]) {
    assert.throws(() => cleanName(bad), undefined, String(bad));
  }
});

test("only results the game can produce are accepted", () => {
  assert.deepEqual(cleanGame({ visitor: 2, theo: 3, rallies: 40, seconds: 60 }), { visitor: 2, theo: 3, rallies: 40, seconds: 60 });
  for (const bad of [
    { visitor: 3, theo: 2, rallies: 40, seconds: 60 },   // the visitor can't win
    { visitor: 3, theo: 3, rallies: 40, seconds: 60 },
    { visitor: 2, theo: 3, rallies: 1, seconds: 60 },    // too few hits for those points
    { visitor: 0, theo: 3, rallies: 0, seconds: 2 },     // too quick
    { visitor: "2", theo: 3, rallies: 40, seconds: 60 }, // not a number
    { visitor: 1.5, theo: 3, rallies: 40, seconds: 60 },
    {},
  ]) assert.throws(() => cleanGame(bad), undefined, JSON.stringify(bad));
});
