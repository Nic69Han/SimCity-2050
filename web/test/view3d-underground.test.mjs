// The layer module's contract (the scene itself is covered by web/e2e/underground.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-underground.js";
import { LAYERS } from "../view3d-layers.js";

test("registered as a light layer; dispose and update before mount are harmless", () => {
  const l = LAYERS.find((x) => x.name === "underground");
  assert.equal(l.heavy, false);
  const layer = createLayer();
  assert.equal(typeof layer.mount, "function");
  layer.dispose({});
  layer.update({ grid: () => null }, { fresh: true, dirty: [] });
});
