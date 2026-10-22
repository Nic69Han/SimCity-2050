// Catastrophes SC3000, presentation side (docs/game-design-v13.md): the page says whether the engine has the
// rule «Catastrophes étendues», names the four disasters, reads the drought and the last disaster, and says what
// a trigger answered. The engine decides the rule, the luck and the effects. Pure: no DOM, so node:test can check it.
//
// The engine's statistics (City.disaster2_stats): Int32Array [drought_months_left, last_disaster (0..4), x, y],
// the position -1 when there is none (a drought has none). The kinds: 1 riot, 2 UFO, 3 meteorite, 4 drought.
// The engine's trigger code (City.trigger_disaster): 1 done, 0 rule off, -1 impossible here.

import { formatInt } from "./budget-text.js";

// The engine methods of the extended disasters. Without all of them the disasters section is not shown.
export const METHODS = Object.freeze(["disaster2_rules", "set_disaster2_rules", "trigger_disaster", "disaster2_stats"]);

// Numbers of disaster2_stats, in this order.
export const STAT_COUNT = 4;

// The codes of trigger_disaster (docs/game-design-v13.md).
export const TRIGGER = Object.freeze({ DONE: 1, RULE_OFF: 0, IMPOSSIBLE: -1 });

// The four triggerable disasters: the engine's kind, the button's text, the name in the lines, and the message
// once it happened (French, with the gender of the name).
export const TRIGGERS = Object.freeze([
  Object.freeze({ kind: 1, label: "Déclencher une émeute", name: "Émeute", done: "Émeute déclenchée." }),
  Object.freeze({ kind: 2, label: "Déclencher un OVNI", name: "OVNI", done: "OVNI déclenché." }),
  Object.freeze({ kind: 3, label: "Déclencher une météorite", name: "Météorite", done: "Météorite déclenchée." }),
  Object.freeze({ kind: 4, label: "Déclencher une sécheresse", name: "Sécheresse", done: "Sécheresse déclenchée." }),
]);

export const HEADING = "Catastrophes et autoroutes";
export const DISASTERS_RULE_LABEL = "Catastrophes étendues";
export const TRIGGERS_GROUP_LABEL = "Déclencher une catastrophe";
export const RULE_OFF_TEXT = "Activez les catastrophes étendues pour en déclencher une.";
export const IMPOSSIBLE_TEXT = "Impossible maintenant : la catastrophe n'a trouvé aucun lieu.";
export const NO_DROUGHT_TEXT = "Pas de sécheresse";
export const NO_LAST_TEXT = "Dernière catastrophe : aucune";

/** Whether `city` has the extended disasters (all of METHODS). */
export function supportsDisasters(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

/** The rule flag as the engine holds it now (false when the engine has no extended disasters). */
export function readDisastersOn(city) {
  return supportsDisasters(city) && Boolean(city.disaster2_rules());
}

/** The trigger record of an engine kind (one of TRIGGERS), or undefined. */
export function triggerOf(kind) {
  return TRIGGERS.find((t) => t.kind === kind);
}

// An integer as the page reads it: a missing or non-numeric value counts as 0.
const int = (n) => Math.trunc(Number(n)) || 0;

/**
 * Decodes disaster2_stats into { droughtMonths, last, place }: droughtMonths is 0 or more, last is the kind of the
 * last disaster (0 none, else 1..4; anything else counts as 0), place is { x, y } or null when there is no position
 * (a negative coordinate). Only the first STAT_COUNT values are read.
 */
export function decodeDisasterStats(values) {
  const [months = 0, last = 0, x = -1, y = -1] = Array.from(values ?? []).slice(0, STAT_COUNT).map(int);
  const kind = triggerOf(last) ? last : 0;
  return {
    droughtMonths: Math.max(0, months),
    last: kind,
    place: x >= 0 && y >= 0 ? { x, y } : null,
  };
}

/** The drought line: the months left, or «Pas de sécheresse». */
export function droughtLine(months) {
  if (months <= 0) return NO_DROUGHT_TEXT;
  return months === 1 ? "Sécheresse : 1 mois restant" : `Sécheresse : ${formatInt(months)} mois restants`;
}

/** The last disaster line, with its place when it has one, e.g. «Dernière catastrophe : Météorite en (40, 22)». */
export function lastDisasterLine({ last, place }) {
  const t = triggerOf(last);
  if (!t) return NO_LAST_TEXT;
  return place ? `Dernière catastrophe : ${t.name} en (${place.x}, ${place.y})` : `Dernière catastrophe : ${t.name}`;
}

/** The two lines of the statistics, in order. */
export function disasterStatsLines(stats) {
  return [droughtLine(stats.droughtMonths), lastDisasterLine(stats)];
}

/** What a trigger answered, as the status line says it (French). Unknown codes or kinds give «». */
export function triggerText(code, kind) {
  const t = triggerOf(kind);
  if (!t) return "";
  if (code === TRIGGER.DONE) return t.done;
  if (code === TRIGGER.RULE_OFF) return RULE_OFF_TEXT;
  if (code === TRIGGER.IMPOSSIBLE) return IMPOSSIBLE_TEXT;
  return "";
}

/** The note under the disasters switch, as the rule is on or off. */
export function disasterNoteText(on) {
  return on
    ? "Émeutes, OVNI, météorites et sécheresses arrivent au hasard, ou à la demande avec les boutons."
    : "Désactivé : seules les catastrophes classiques existent.";
}
