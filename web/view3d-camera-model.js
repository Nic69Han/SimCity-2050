// 3D view camera, pure part (web/view3d-camera.js is the layer that uses it): quarter turns, zoom
// levels, the orbit's spherical maths, recentring and the camera keys. No Three.js, no DOM.
//
// The orbit is described by { azimuth, polar, distance } around a target { x, y, z }, with the same
// formula as view3d.js mount(): polar from the vertical, azimuth from +z.

export const QUARTER_TURN = Math.PI / 2;
const TWO_PI = Math.PI * 2;
const EPS = 1e-9;

// Orbit distance of each zoom level, as a share of the map's larger side (in tiles), nearest first.
export const ZOOM_LEVELS = Object.freeze([0.35, 0.6, 1.1, 1.6]);
// The level the view opens at (view3d.js: max(w, h) * 1.1), and the one «⌂» goes back to.
export const HOME_ZOOM = 1.1;

// Keys of the camera, while the 3D view is shown. Each one is free of the tools' letters and digits
// (tools.js SHORTCUTS) and of the Escape key. Keys read from ev.key.
export const CAMERA_KEYS = Object.freeze({
  ",": "turnLeft",
  ".": "turnRight",
  "=": "zoomIn",
  "-": "zoomOut",
  Home: "home",
});

const mod = (a, n) => ((a % n) + n) % n;

// Azimuth after one quarter turn. dir +1 turns to the next quarter multiple above the azimuth, -1 to
// the one below. A view that is not on a quarter multiple snaps to the next one in that direction.
// The result is in [0, 2π).
export function nextQuarterTurn(azimuth, dir) {
  if (!Number.isFinite(azimuth)) throw new RangeError(`azimuth is not a number: ${azimuth}`);
  if (dir !== 1 && dir !== -1) throw new RangeError(`dir must be 1 or -1: ${dir}`);
  const steps = dir > 0
    ? Math.floor(azimuth / QUARTER_TURN + EPS) + 1
    : Math.ceil(azimuth / QUARTER_TURN - EPS) - 1;
  return mod(steps * QUARTER_TURN, TWO_PI);
}

// The orbit distance of each zoom level for a map whose larger side is mapSize tiles.
export function zoomDistances(mapSize) {
  return ZOOM_LEVELS.map((share) => share * mapSize);
}

// Distance after one zoom step. zoomIn goes to the nearest level closer than `distance`, zoomOut to
// the nearest level farther away. At the ends of the list the distance stays on the last level.
export function zoomStep(distance, zoomIn, mapSize) {
  if (!Number.isFinite(distance)) throw new RangeError(`distance is not a number: ${distance}`);
  const levels = zoomDistances(mapSize);
  if (zoomIn) {
    const closer = levels.filter((l) => l < distance - EPS);
    return closer.length ? Math.max(...closer) : levels[0];
  }
  const farther = levels.filter((l) => l > distance + EPS);
  return farther.length ? Math.min(...farther) : levels[levels.length - 1];
}

// The orbit distance of the opening view, for a map whose larger side is mapSize tiles.
export function homeDistance(mapSize) {
  return HOME_ZOOM * mapSize;
}

// Orbit target of the whole map: the middle of the map on the ground (view3d.js starts there too).
export function centreTarget(w, h) {
  return { x: w / 2, y: 0, z: h / 2 };
}

// Camera position of an orbit around `target`.
export function cameraPosition(target, { azimuth, polar, distance }) {
  const s = Math.sin(polar);
  return {
    x: target.x + distance * s * Math.sin(azimuth),
    y: target.y + distance * Math.cos(polar),
    z: target.z + distance * s * Math.cos(azimuth),
  };
}

// The orbit (azimuth in [0, 2π), polar, distance) of a camera at `position` around `target`: the
// inverse of cameraPosition.
export function orbitOf(position, target) {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const distance = Math.hypot(dx, dy, dz);
  return {
    azimuth: mod(Math.atan2(dx, dz), TWO_PI),
    polar: distance > 0 ? Math.acos(Math.min(1, Math.max(-1, dy / distance))) : 0,
    distance,
  };
}
