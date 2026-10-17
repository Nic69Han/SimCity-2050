// transit tools (docs/game-design-v02.md): an extra tool module (see extra-tools.js for the contract),
// delivered empty by the platform phase and filled in by its workstream.
export const KIND = "transit";

// Catalog entries of this module's tools: none yet.
export function catalog(_city) {
  return [];
}

// The engine calls of one of this module's entries ({ footprint, preview, down, drag }); null for
// an entry of another module.
export function calls(_city, _entry) {
  return null;
}

// Hover label of one of this module's entries; undefined keeps the default cost label.
export function label(_preview) {
  return undefined;
}

// Why this module's tools cannot be used now, in French; "" when they can.
export function blockedReason(_city, _context) {
  return "";
}
