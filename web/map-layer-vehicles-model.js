// The pure part of the 2D vehicles layer (map-layer-vehicles.js; docs/game-design-v03.md): decoding
// the engine's vehicle records, the rectangle of a vehicle, the colours of the kinds and of the
// traffic load. No DOM, no globals: node:test checks it directly.

// Traffic load (0..=255 per tile) from which a tile is tinted, and from which it is a jam.
export const LOAD_TINT_MIN = 128;
export const LOAD_JAM = 200;

// Most vehicles read from the engine in one frame.
export const MAX_DRAWN = 2000;

// Integers per vehicle record: [id, kind, x16, y16, direction].
export const RECORD_SIZE = 5;

export const TINT_COLORS = Object.freeze({
  busy: "rgba(255, 152, 0, 0.30)",
  jam: "rgba(217, 48, 37, 0.38)",
});

// Colour of each kind of vehicle; a kind not in this table is grey.
export const KIND_COLORS = Object.freeze({
  0: "#263238", // car
  1: "#1565c0", // bus
  2: "#f9a825", // taxi
  3: "#6a1b9a", // train
  4: "#00897b", // metro
});
export const UNKNOWN_KIND_COLOR = "#9e9e9e";

// Decodes the records of `city.vehicles()` into {id, kind, x, y, dir}, with x and y in tiles.
// A trailing incomplete record is ignored; a missing or non-array input gives no vehicle.
export function decodeVehicles(arr) {
  const out = [];
  if (!arr || typeof arr.length !== "number") return out;
  const n = Math.floor(arr.length / RECORD_SIZE) * RECORD_SIZE;
  for (let i = 0; i < n; i += RECORD_SIZE) {
    out.push({
      id: arr[i],
      kind: arr[i + 1],
      x: arr[i + 2] / 16,
      y: arr[i + 3] / 16,
      dir: arr[i + 4],
    });
  }
  return out;
}

// Length of a vehicle relative to the base length (2 short sides): a bus is longer, a train or a metro
// longer still; a car and a taxi have the base length. A kind not in this table has the base length.
export const BASE_LENGTH = 2;
export const LENGTH_FACTOR = Object.freeze({ 0: 1, 1: 2.2, 2: 1, 3: 2.6, 4: 2.6 });

export function lengthFactor(kind) {
  return Object.hasOwn(LENGTH_FACTOR, kind) ? LENGTH_FACTOR[kind] : 1;
}

// The rectangle [x, y, w, h] of a vehicle in canvas pixels, centred on its position. It is
// elongated along its direction: north and south (0, 2) are tall, east and west (1, 3) are wide. The
// length depends on the kind (lengthFactor).
export function vehicleRect(v, scale) {
  const short = Math.max(1, scale / 3);
  const long = short * BASE_LENGTH * lengthFactor(v.kind);
  const horizontal = v.dir === 1 || v.dir === 3;
  const w = horizontal ? long : short;
  const h = horizontal ? short : long;
  const cx = v.x * scale;
  const cy = v.y * scale;
  return [cx - w / 2, cy - h / 2, w, h];
}

// The tint of a tile from its traffic load: null below LOAD_TINT_MIN, orange from there, red
// above LOAD_JAM.
export function loadColor(load) {
  if (typeof load !== "number" || !(load >= LOAD_TINT_MIN)) return null;
  return load > LOAD_JAM ? TINT_COLORS.jam : TINT_COLORS.busy;
}

export function kindColor(kind) {
  return Object.hasOwn(KIND_COLORS, kind) ? KIND_COLORS[kind] : UNKNOWN_KIND_COLOR;
}

// A metro rame (kind 4) is drawn in 2D only while the metro plan or a metro tool is shown (metroOn);
// every other kind, trains included, is always drawn (docs/game-design-v06.md).
export const METRO_KIND = 4;

export function shownIn2D(kind, metroOn) {
  return kind !== METRO_KIND || metroOn === true;
}
