// "Latest wins": a slow load that finishes after a newer one must not be applied.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createLatest } from "../latest.js";

describe("latest load wins", () => {
  test("the newest ticket is current, older ones are not", () => {
    const l = createLatest();
    const a = l.start();
    assert.equal(l.isCurrent(a), true);
    const b = l.start();
    assert.equal(l.isCurrent(a), false, "a sample started earlier is stale");
    assert.equal(l.isCurrent(b), true);
  });

  test("a new city (a start with no load) also makes pending loads stale", () => {
    const l = createLatest();
    const sample = l.start();
    l.start(); // "Nouvelle ville"
    assert.equal(l.isCurrent(sample), false);
  });

  test("tickets are not reused", () => {
    const l = createLatest();
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(l.start());
    assert.equal(seen.size, 100);
  });
});
