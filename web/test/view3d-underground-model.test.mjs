// Pure placement maths of the 3D underground networks (web/view3d-underground-model.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPACITY, KINDS, PIPE_DEPTH, TUNNEL_DEPTH, buildPlacements, hashBytes, layerKey, sameKey, writeMatrix,
} from "../view3d-underground-model.js";
import { cornerAltitudes, tileCentreY } from "../view3d-model.js";

const W = 6, H = 5;
const flat = (a = 10) => cornerAltitudes(new Uint8Array(W * H).fill(a), W, H);
const layer = (cells) => {
  const l = new Uint8Array(W * H);
  for (const [x, y, c] of cells) l[x * H + y] = c;
  return l;
};
const build = (extra) => buildPlacements({ w: W, h: H, water: null, transit: null, corners: flat(), ...extra });

test("nothing to draw without layers or with a layer of the wrong size", () => {
  const r = build({});
  for (const k of KINDS) assert.equal(r.items[k].length, 0);
  assert.equal(build({ water: new Uint8Array(3), transit: new Uint8Array(3) }).dropped, 0);
});

test("pipes: one node per tile, one segment per joined right/down neighbour, under the ground", () => {
  const corners = flat();
  const r = build({ corners, water: layer([[1, 1, 2], [2, 1, 2], [2, 2, 1]]) });
  assert.equal(r.tiles.pipe, 3);
  assert.equal(r.items.pipe.length, 3 + 2); // 3 nodes + (1,1)-(2,1) + (2,1)-(2,2)
  const ground = tileCentreY(corners, H, 1, 1);
  const node = r.items.pipe[0];
  assert.deepEqual([node.x, node.z], [1.5, 1.5]);
  assert.ok(Math.abs(node.y - (ground - PIPE_DEPTH)) < 1e-9);
  const horiz = r.items.pipe.find((p) => p.sx === 1);
  assert.deepEqual([horiz.x, horiz.z], [2, 1.5]);
  const dry = r.items.pipe.find((p) => p.x === 2.5 && p.z === 2.5);
  assert.notDeepEqual(dry.rgb, node.rgb, "a dry pipe has another colour than a fed one");
});

test("a pump is a tower standing on the ground and a node of the pipe run", () => {
  const corners = flat();
  const r = build({ corners, water: layer([[1, 1, 3], [2, 1, 2]]) });
  assert.equal(r.tiles.pump, 1);
  assert.equal(r.items.pump.length, 1);
  const p = r.items.pump[0];
  assert.ok(Math.abs(p.y - p.sy / 2 - tileCentreY(corners, H, 1, 1)) < 1e-9);
  assert.equal(r.items.pipe.length, 3, "two nodes and the segment between pump and pipe");
});

test("tunnels lie deeper than pipes; stations stand on the ground over a tunnel node; working is stronger", () => {
  const r = build({ transit: layer([[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4]]) });
  assert.equal(r.tiles.tunnel, 2);
  assert.equal(r.tiles.station, 2);
  assert.equal(r.items.station.length, 2);
  assert.equal(r.items.tunnel.length, 4 + 3);
  const ground = tileCentreY(flat(), H, 0, 0);
  assert.ok(Math.abs(r.items.tunnel[0].y - (ground - TUNNEL_DEPTH)) < 1e-9);
  assert.ok(TUNNEL_DEPTH > PIPE_DEPTH);
  const [s, sw] = r.items.station;
  assert.notDeepEqual(s.rgb, sw.rgb);
});

test("capacity bound: placements past the cap are dropped and counted, never stored", () => {
  const all = new Uint8Array(W * H).fill(2);
  const r = build({ water: all, caps: { ...CAPACITY, pipe: 10 } });
  assert.equal(r.items.pipe.length, 10);
  assert.ok(r.dropped > 0);
  assert.equal(r.tiles.pipe, W * H);
  const full = build({ water: all });
  assert.ok(full.items.pipe.length <= CAPACITY.pipe);
  assert.equal(full.items.pipe.length, W * H + (W - 1) * H + W * (H - 1));
});

test("change detection: same bytes same key, a changed byte, size, null or corners differ", () => {
  const c = flat();
  const a = layer([[1, 1, 2]]);
  const key = layerKey(a, null, c);
  assert.ok(sameKey(key, layerKey(a.slice(), null, c)));
  assert.ok(!sameKey(key, layerKey(layer([[1, 1, 3]]), null, c)));
  assert.ok(!sameKey(key, layerKey(null, null, c)));
  assert.ok(!sameKey(key, layerKey(a, null, flat(11))));
  assert.ok(!sameKey(null, key));
  assert.notEqual(hashBytes(new Uint8Array([1, 2])), hashBytes(new Uint8Array([2, 1])));
});

test("writeMatrix: translation and scale in a column-major matrix", () => {
  const out = new Float32Array(32).fill(7);
  writeMatrix(out, 16, { x: 1, y: 2, z: 3, sx: 4, sy: 5, sz: 6 });
  assert.deepEqual(Array.from(out.slice(16)), [4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 6, 0, 1, 2, 3, 1]);
  assert.equal(out[15], 7, "the neighbour is untouched");
});
