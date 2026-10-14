// Relief rules, presentation side (ARCHITECTURE.md rule 5): the page shows the engine's flag and
// forwards the player's choice. The engine decides what terraforming costs and what is allowed.
// Pure: no DOM, so node:test can check it.

// Help of the «Règles de relief» checkbox (its title attribute).
export const RELIEF_HELP =
  "Construire sur une pente coûte du terrassement ; les routes en pente coûtent plus cher ; " +
  "outils pour relever et abaisser le terrain.";

// The engine has the flag (City.relief_rules / set_relief_rules).
export function supportsRelief(city) {
  return typeof city?.relief_rules === "function" && typeof city?.set_relief_rules === "function";
}

// The engine has the terraforming tools (City.terraform / terraform_preview).
export function supportsTerraform(city) {
  return typeof city?.terraform === "function" && typeof city?.terraform_preview === "function";
}

// The flag as the engine holds it now. Read it after every new or loaded city: a file may carry
// the rules on, and the page shows that. The page never pushes its checkbox into a new city.
export function readRelief(city) {
  return supportsRelief(city) ? Boolean(city.relief_rules()) : false;
}

// Sets the flag in the engine and returns what the engine then says (the value to show).
export function setRelief(city, on) {
  if (!supportsRelief(city)) return false;
  city.set_relief_rules(Boolean(on));
  return readRelief(city);
}

// Why the terraforming tools cannot be used now, in French; "" when they can.
// They need the rules on, and the 3D view (altitude is only visible there).
export function reliefBlockedReason({ rules, in3d }) {
  if (!rules) return "Activez « Règles de relief » pour relever ou abaisser le terrain";
  if (!in3d) return "Relever et abaisser se font en vue 3D : l'altitude ne se voit qu'en 3D";
  return "";
}

// Tiles crossed by a drag from (x0, y0) to (x1, y1), start excluded, end included (Bresenham).
// A pointer that jumps several tiles between two events still terraforms each tile it crosses.
export function lineTiles(x0, y0, x1, y1) {
  const out = [];
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    out.push({ x, y });
  }
  return out;
}
