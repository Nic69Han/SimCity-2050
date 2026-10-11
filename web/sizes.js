// Map sizes for "Nouvelle ville" (presentation only, ARCHITECTURE.md rule 5: the engine decides
// which sizes it accepts and what a city is; the page only offers choices and checks the numbers
// against the limits the engine reports). Pure functions: no DOM, no engine calls except through
// the `City` class passed in.

// The original game's map. A .cty file always describes it, so it is the only size that can be saved.
export const ORIGINAL_SIZE = Object.freeze({ width: 120, height: 100 });

// Engine limits, used when the wasm package does not report them (City.size_limits).
export const DEFAULT_LIMITS = Object.freeze({ minWidth: 80, minHeight: 67, maxWidth: 512, maxHeight: 512 });

// The choices of the size selector. "custom" reads two number inputs.
export const SIZE_PRESETS = Object.freeze([
  Object.freeze({ id: "normal", label: "Normal", width: 120, height: 100 }),
  Object.freeze({ id: "grande", label: "Grande", width: 200, height: 150 }),
  Object.freeze({ id: "tres-grande", label: "Très grande", width: 300, height: 250 }),
  Object.freeze({ id: "custom", label: "Personnalisée" }),
]);

export const SAVE_UNAVAILABLE_NOTE =
  "Enregistrement indisponible : seule la taille 120 × 100 peut être enregistrée (format .cty).";

// The engine's limits as { minWidth, minHeight, maxWidth, maxHeight } from
// `[minWidth, minHeight, maxWidth, maxHeight]` (City.size_limits()); defaults when malformed.
export function limitsFrom(list) {
  const ok = Array.isArray(list) && list.length === 4 && list.every((v) => Number.isInteger(v) && v > 0);
  if (!ok) return DEFAULT_LIMITS;
  const [minWidth, minHeight, maxWidth, maxHeight] = list;
  return { minWidth, minHeight, maxWidth, maxHeight };
}

// The limits the engine reports, or the defaults when the engine has no such method.
export function readLimits(City) {
  if (typeof City?.size_limits !== "function") return DEFAULT_LIMITS;
  try {
    return limitsFrom(Array.from(City.size_limits()));
  } catch {
    return DEFAULT_LIMITS;
  }
}

// The size feature exists in the engine (feature detection, as for the other engine APIs).
export function supportsNewSized(City) {
  return typeof City?.new_sized === "function";
}

// Text of a dimension box -> integer, or null when it is not a whole number.
export function parseDimension(text) {
  const s = String(text ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

// Two number boxes -> { width, height } inside the limits, or { error, field } in French.
export function validateSize(widthText, heightText, limits = DEFAULT_LIMITS) {
  const width = parseDimension(widthText);
  if (width === null) return { error: "Largeur invalide : entrer un nombre entier", field: "width" };
  if (width < limits.minWidth || width > limits.maxWidth) {
    return { error: `Largeur hors limites : de ${limits.minWidth} à ${limits.maxWidth}`, field: "width" };
  }
  const height = parseDimension(heightText);
  if (height === null) return { error: "Hauteur invalide : entrer un nombre entier", field: "height" };
  if (height < limits.minHeight || height > limits.maxHeight) {
    return { error: `Hauteur hors limites : de ${limits.minHeight} à ${limits.maxHeight}`, field: "height" };
  }
  return { width, height };
}

// The size chosen in the selector: a preset, or the custom boxes validated against the limits.
export function chooseSize({ preset, width, height }, limits = DEFAULT_LIMITS) {
  if (preset === "custom") return validateSize(width, height, limits);
  const found = SIZE_PRESETS.find((p) => p.id === preset && p.width !== undefined);
  if (!found) return { error: "Taille inconnue", field: null };
  return { width: found.width, height: found.height };
}

// Option text of the selector: "Normal (120 × 100)", "Personnalisée".
export function presetOptionLabel(preset) {
  return preset.width === undefined ? preset.label : `${preset.label} (${sizeLabel(preset.width, preset.height)})`;
}

export function sizeLabel(width, height) {
  return `${width} × ${height}`;
}

export function isOriginalSize(width, height) {
  return width === ORIGINAL_SIZE.width && height === ORIGINAL_SIZE.height;
}

// Whether the engine can save the city now: the wasm method is_saveable (absent: saveable).
export function isSaveable(city) {
  return typeof city?.is_saveable === "function" ? Boolean(city.is_saveable()) : true;
}

// The note under the save button: empty when the city can be saved.
export function saveNote(saveable) {
  return saveable ? "" : SAVE_UNAVAILABLE_NOTE;
}

// Message for an error code of the engine (City.new_sized, City.save_checked).
export function sizeErrorText(code, limits = DEFAULT_LIMITS) {
  if (code === "size_out_of_range") {
    return `Taille hors limites : de ${sizeLabel(limits.minWidth, limits.minHeight)} à ${sizeLabel(limits.maxWidth, limits.maxHeight)}.`;
  }
  if (code === "size_not_saveable") return SAVE_UNAVAILABLE_NOTE;
  return `Erreur : ${code}`;
}
