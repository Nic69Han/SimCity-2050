// Page feature: «Partager» (docs/game-design-v1.md), the panel #share-panel: the button «Partager la ville» builds a link
// from the current save (the same bytes as the page's save), copies it (navigator.clipboard when there is one, else shows
// it in a read-only field), and at startup an address ending in «#ville=...» loads that city. Presentation only
// (ARCHITECTURE.md rule 5): the encoding is in share-model.js (pure, tested). Any failure is a French message in the
// role="status" line and the city stays as it was. setup(api) runs once after the engine exists; update(api) runs after
// every redraw.
import { encode, decode, parseHash, buildLink, shareErrorText, ShareError } from "./share-model.js";
import { canSaveBytes, saveBytes } from "./saves.js";

export const PANEL_TITLE = "Partager";
export const BUTTON_TEXT = "Partager la ville";
export const FIELD_LABEL = "Lien de la ville";
export const COPIED_TEXT = "Lien copié dans le presse-papiers.";
export const MANUAL_TEXT = "Copiez le lien ci-dessous pour le partager.";
export const NOT_SAVEABLE_TEXT = "Cette ville ne peut pas être enregistrée, donc pas partagée.";
export const OPENED_TEXT = "Ville partagée ouverte.";
export const OPEN_FAILED_TEXT = "La ville partagée n'a pas pu être ouverte : la ville actuelle est conservée.";

let panel = null;
let ui = null;
let api = null;
let hashHandled = false;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function say(text) {
  if (ui) ui.status.textContent = text;
}

// The link in the read-only field, selected so that one keystroke copies it.
function showField(link) {
  ui.field.value = link;
  ui.field.hidden = false;
  ui.field.focus?.();
  ui.field.select?.();
}

// True when the text was copied; false when there is no clipboard or it refused.
async function copy(link) {
  try {
    if (typeof globalThis.navigator?.clipboard?.writeText !== "function") return false;
    await globalThis.navigator.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}

/** Builds the link of the current city; throws ShareError. */
export async function makeLink(city, location = globalThis.location) {
  if (!canSaveBytes(city)) throw new ShareError("empty");
  return buildLink(location, await encode(saveBytes(city)));
}

async function share() {
  ui.field.hidden = true;
  if (!api.isReady()) return;
  if (!canSaveBytes(api.city())) {
    say(NOT_SAVEABLE_TEXT);
    return;
  }
  try {
    const link = await makeLink(api.city());
    if (await copy(link)) say(COPIED_TEXT);
    else {
      showField(link);
      say(MANUAL_TEXT);
    }
  } catch (e) {
    say(shareErrorText(e));
  }
}

function build() {
  const button = el("button", { type: "button", id: "share-button" }, BUTTON_TEXT);
  button.onclick = () => share();
  const field = el("input", { type: "text", id: "share-link", readonly: "", "aria-label": FIELD_LABEL });
  field.hidden = true;
  const status = el("p", { class: "share-status", role: "status" });
  panel.replaceChildren(el("h2", {}, PANEL_TITLE), button, field, status);
  return { button, field, status };
}

// Removes the «#ville=...» from the address once the city is open, so that a reload does not replace the game again.
function clearHash() {
  try {
    const { pathname, search } = globalThis.location;
    globalThis.history?.replaceState(null, "", pathname + (search ?? ""));
  } catch {
    // an address that cannot be rewritten stays as it is
  }
}

/** Opens the city of an address hash. Returns the French message to show (success or failure). */
export async function openFromHash(hash, theApi) {
  const text = parseHash(hash);
  if (text === null) return "";
  try {
    const bytes = await decode(text);
    if (theApi.replaceCity(bytes) !== null) return OPEN_FAILED_TEXT;
  } catch (e) {
    return `${shareErrorText(e)} ${OPEN_FAILED_TEXT}`;
  }
  clearHash();
  return OPENED_TEXT;
}

// Once, after the page's own city is in: a microtask later, so the sample loading that drew first has finished.
function openStartupLink() {
  hashHandled = true;
  const hash = globalThis.location?.hash ?? "";
  if (parseHash(hash) === null) return;
  queueMicrotask(async () => say(await openFromHash(hash, api)));
}

export function setup(theApi) {
  api = theApi;
  panel = api.$("share-panel") ?? null;
  ui = null;
  hashHandled = false;
  if (panel) panel.hidden = true;
}

export function update() {
  if (!panel || !api.isReady()) return;
  if (!ui) ui = build();
  panel.hidden = false;
  if (!hashHandled) openStartupLink();
}
