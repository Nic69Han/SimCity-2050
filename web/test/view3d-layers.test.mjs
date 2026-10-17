// The list of 3D view layers and the simple view (?lite=1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYERS, layersFor } from "../view3d-layers.js";

test("every layer module exports createLayer()", () => {
  for (const l of LAYERS) assert.equal(typeof l.module.createLayer, "function", l.name);
});

test("all layers by default; ?lite=1 keeps only the light ones", () => {
  assert.equal(layersFor("").length, LAYERS.length);
  assert.equal(layersFor(undefined).length, LAYERS.length);
  assert.equal(layersFor("?lite=0").length, LAYERS.length);
  const lite = layersFor("?lite=1");
  assert.deepEqual(lite, LAYERS.filter((l) => !l.heavy).map((l) => l.module));
  assert.ok(lite.length < LAYERS.length);
});
