// Pure model of the ordinances panel (docs/game-design-v02.md). The engine gives keys and numbers
// only (City.ordinance_*); the French texts live here. No DOM, no engine access: node --test
// checks it alone (web/test/ordinances-model.test.mjs).
import { formatMoney } from "./budget-text.js";

const MINUS = "−";
const NBSP = " ";

/** Engine method names the panel needs; a build without them keeps the panel hidden. */
export const REQUIRED = ["ordinance_count", "ordinance_info", "ordinance_key", "ordinance_active", "set_ordinance"];

/** The French name and one-line purpose of each ordinance, by the engine's key. */
export const TEXTS = Object.freeze({
  community_policing: { label: "Police de proximité", help: "Des patrouilles à pied dans tous les quartiers." },
  pollution_control: { label: "Programme anti-pollution", help: "Filtres et contrôles pour les usines." },
  recycling: { label: "Recyclage", help: "Tri et valorisation des déchets de la ville." },
  tourism: { label: "Promotion touristique", help: "Une campagne pour attirer les visiteurs." },
  industry_incentives: { label: "Incitations industrielles", help: "Des avantages pour les entreprises qui s'installent." },
  beautification: { label: "Embellissement urbain", help: "Fleurs, façades et mobilier urbain." },
  curfew: { label: "Couvre-feu des jeunes", help: "Les rues se vident la nuit, mais moins de monde veut s'installer." },
  city_promotion: { label: "Promotion de la ville", help: "Une campagne pour attirer de nouveaux habitants." },
});

// Order and wording of the effects in the one-line summary (index in the engine's info array).
const EFFECTS = Object.freeze([
  { at: 1, text: "criminalité" },
  { at: 2, text: "pollution" },
  { at: 3, text: "valeur du terrain" },
  { at: 4, text: "demande résidentielle" },
  { at: 5, text: "demande commerciale" },
  { at: 6, text: "demande industrielle" },
]);

/** Signed percent with a true minus sign: 8 -> "+8 %", -15 -> "−15 %". */
export function formatSignedPercent(p) {
  const v = Math.round(Number(p) || 0);
  const sign = v > 0 ? "+" : v < 0 ? MINUS : "";
  return `${sign}${Math.abs(v)}${NBSP}%`;
}

/** The engine's Int32Array [monthly_cost, crime, pollution, land, res, com, ind] as an object. */
export function decodeInfo(a) {
  const n = (i) => Number(a?.[i]) | 0;
  return { cost: n(0), crime: n(1), pollution: n(2), land: n(3), res: n(4), com: n(5), ind: n(6) };
}

/** "Criminalité −15 %, demande résidentielle +8 %": the effects that are not zero, or "". */
export function effectText(info) {
  const arr = [info.cost, info.crime, info.pollution, info.land, info.res, info.com, info.ind];
  const parts = EFFECTS.filter((e) => arr[e.at] !== 0).map((e) => `${e.text} ${formatSignedPercent(arr[e.at])}`);
  if (parts.length === 0) return "";
  const line = parts.join(", ");
  return line[0].toUpperCase() + line.slice(1);
}

/** "200 $ par an": a cost is charged at each tax collection, once per game year. */
export function costText(cost) {
  return `${formatMoney(cost)} par an`;
}

/** Total of the active ordinances: "Coût total : 350 $ par an" or "Aucune ordonnance en vigueur.". */
export function totalText(items) {
  const active = items.filter((i) => i.active);
  if (active.length === 0) return "Aucune ordonnance en vigueur.";
  const total = active.reduce((sum, i) => sum + i.info.cost, 0);
  return `Coût total : ${costText(total)} (${active.length} en vigueur).`;
}

/** Whether `city` has the whole ordinances API. */
export function supports(city) {
  return REQUIRED.every((m) => typeof city?.[m] === "function");
}

/** Everything the panel shows, read from the engine: [{ index, key, label, help, active, info, effect }]. */
export function readOrdinances(city) {
  const items = [];
  const count = Number(city.ordinance_count()) | 0;
  for (let index = 0; index < count; index++) {
    const key = city.ordinance_key(index);
    const info = decodeInfo(city.ordinance_info(index));
    const text = TEXTS[key];
    items.push({
      index,
      key,
      label: text?.label ?? key,
      help: text?.help ?? "",
      active: Boolean(city.ordinance_active(index)),
      info,
      effect: effectText(info),
    });
  }
  return items;
}

/** A string that changes exactly when something the panel shows changes. */
export function snapshotKey(items) {
  return items.map((i) => `${i.key}:${i.active ? 1 : 0}:${i.info.cost}:${i.effect}`).join("|");
}
