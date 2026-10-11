// "Nouvelle ville" seeds (presentation only, ARCHITECTURE.md rule 5: the core turns the seed
// into a city; the page only chooses and parses the number).
// The engine takes an i32 (`new_random_city(seed: i32)`); a random seed is a positive 31-bit int.

export const SEED_MIN = -2147483648;
export const SEED_MAX = 2147483647;

// Positive 31-bit seed from a random source (crypto.getRandomValues in the page).
// `random` returns an unsigned 32-bit integer. Zero is replaced by 1 so the seed is never 0.
export function randomSeed(random = defaultRandom) {
  return (random() & SEED_MAX) || 1;
}

function defaultRandom() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

// Text typed in the seed box -> { seed, random } or { error }.
//   empty (or blanks)  -> a random seed, random: true
//   an integer         -> that integer, clamped to i32 (random: false)
//   anything else      -> { error } (no city is made)
export function parseSeed(text, random = defaultRandom) {
  const s = String(text ?? "").trim();
  if (s === "") return { seed: randomSeed(random), random: true };
  if (!/^[+-]?\d+$/.test(s)) return { error: "Graine invalide : entrer un nombre entier" };
  const n = Number(s);
  return { seed: Math.min(SEED_MAX, Math.max(SEED_MIN, n)), random: false };
}

// After new_random_city the engine may reset its own settings (the wasm adapter re-enables
// disasters and sets its own speed), so the page pushes its options back: the checkbox and
// the slider are the truth the user sees. Called after every new city.
export function applyEnginePreferences(city, { speed, disasters }) {
  city.enable_disasters(Boolean(disasters));
  city.set_speed(Number(speed));
}

// The engine has the method (feature detection, as for the tool API).
export function supportsNewCity(city) {
  return typeof city?.new_random_city === "function";
}
