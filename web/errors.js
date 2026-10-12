// French texts for the errors of the engine and of the browser storage (presentation only,
// ARCHITECTURE.md rule 5). The engine throws errors whose message starts with a stable code,
// `<code>: <detail>` (docs/tools-contract.md, "Wave 6: saving"); older builds give English
// messages, which are recognised too. Every text starts with "Erreur : " when it is a failure of
// a file or a load, so the page's live regions read the same way.
import { DEFAULT_LIMITS, SAVE_UNAVAILABLE_NOTE, sizeLabel } from "./sizes.js";

/** Codes the engine gives for a file that cannot be read (the message prefix). */
export const FILE_CODES = Object.freeze([
  "cty_bad_size", "cty_bad_magic", "cty_bad_version", "cty_size_out_of_range", "cty_truncated",
]);
/** Codes the engine gives for a map size (new city, save). */
export const SIZE_CODES = Object.freeze(["size_out_of_range", "size_not_saveable"]);

const CODE_PREFIX = /^([a-z_]+): ([\s\S]*)$/;
// English messages of the engine before the codes (crates/micropolis-core/src/fileio.rs).
const LEGACY = [
  { re: /^invalid \.cty size: (\d+) bytes/, code: "cty_bad_size" },
  { re: /does not match \.cty size/, code: "cty_world_size" },
];

/**
 * The stable code of an engine error and its detail: { code, detail }. `code` is "unknown"
 * when the message has none. Accepts an Error, a string or anything else.
 */
export function splitError(error) {
  const message = String(error?.message ?? error);
  const m = CODE_PREFIX.exec(message);
  if (m && (FILE_CODES.includes(m[1]) || SIZE_CODES.includes(m[1]))) {
    return { code: m[1], detail: m[2] };
  }
  for (const { re, code } of LEGACY) {
    const legacy = re.exec(message);
    if (legacy) return { code, detail: legacy[1] ?? message };
  }
  return { code: "unknown", detail: message };
}

/**
 * The French sentence for an engine error (a refused file, a failed load, a save or new city
 * that the engine refuses). Unknown errors keep their detail: "Erreur : <detail>".
 */
export function engineErrorText(error, limits = DEFAULT_LIMITS) {
  const { code, detail } = splitError(error);
  const range = `de ${sizeLabel(limits.minWidth, limits.minHeight)} à ${sizeLabel(limits.maxWidth, limits.maxHeight)}`;
  switch (code) {
    case "cty_bad_size": {
      const bytes = sizeOf(error);
      return `Erreur : fichier invalide, taille incorrecte${bytes ? ` (${bytes} octets)` : ""}.`;
    }
    case "cty_bad_magic":
      return "Erreur : fichier invalide, ce n'est pas une ville de Micropolis.";
    case "cty_bad_version":
      return "Erreur : fichier invalide, version de format non prise en charge.";
    case "cty_size_out_of_range":
      return `Erreur : fichier invalide, taille de carte hors limites (${range}).`;
    case "cty_truncated":
      return "Erreur : fichier invalide, fichier tronqué.";
    case "cty_world_size":
      return "Erreur : fichier incompatible avec la taille de la carte.";
    case "size_out_of_range":
      return `Erreur : taille de carte hors limites (${range}).`;
    case "size_not_saveable":
      return SAVE_UNAVAILABLE_NOTE;
    default:
      return `Erreur : ${detail}`;
  }
}

// The byte count of a cty_bad_size message ("invalid .cty size: 100 bytes ..."), or "".
function sizeOf(error) {
  const m = /^(\d+)/.exec(splitError(error).detail);
  return m ? m[1] : "";
}

/**
 * The French sentence for a storage error (see storage.js: StorageError codes). `error.code`
 * is one of unavailable, quota, blocked, corrupt, failed; anything else gets the generic text.
 */
export function storageErrorText(error) {
  switch (error?.code) {
    case "unavailable":
      return "Enregistrement dans le navigateur indisponible (navigation privée ou stockage bloqué). Utilisez Enregistrer pour un fichier.";
    case "quota":
      return "Espace de stockage du navigateur plein : supprimez une partie enregistrée ou enregistrez dans un fichier.";
    case "blocked":
      return "Le stockage du navigateur est utilisé par une autre fenêtre : fermez les autres onglets de Micropolis, puis réessayez.";
    case "corrupt":
      return "Cette sauvegarde est illisible.";
    default:
      return `Échec de l'enregistrement dans le navigateur : ${error?.message ?? error}`;
  }
}
