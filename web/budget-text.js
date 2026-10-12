// Pure formatting and chart-scaling for the budget panel (no DOM, no engine calls).
// Decodes the arrays of the wasm adapter (layouts documented in crates/micropolis-wasm/src/budget.rs)
// and turns numbers into French text. Tested by web/test/budget-text.test.mjs.

const NBSP = " ";
const NNBSP = " "; // thousands separator, as in French typography

/** Integer with French grouping: 1234567 -> "1 234 567". */
export function formatInt(n) {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? "-" : "";
  const digits = String(Math.abs(v));
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += NNBSP;
    out += digits[i];
  }
  return sign + out;
}

/** Dollars: 1234 -> "1 234 $". */
export function formatMoney(n) {
  return formatInt(n) + NBSP + "$";
}

/** Percent of a whole number: 45 -> "45 %". */
export function formatPercent(p) {
  return formatInt(p) + NBSP + "%";
}

/** Signed change: 5 -> "+5", -3 -> "-3", 0 -> "0". */
export function formatSigned(n) {
  const v = Math.round(Number(n) || 0);
  if (v > 0) return "+" + formatInt(v);
  return formatInt(v);
}

/** Taxes of the city classes, as the engine numbers them (CityClass). */
export const CITY_CLASSES = ["Village", "Bourg", "Ville", "Capitale", "Métropole", "Mégalopole"];

export function classLabel(index) {
  return CITY_CLASSES[index] ?? "Inconnue";
}

/** Problem kinds (CVP_* of evaluate.rs), in the same order. */
export const PROBLEM_NAMES = [
  "Criminalité",
  "Pollution",
  "Coût du logement",
  "Impôts",
  "Circulation",
  "Chômage",
  "Incendies",
];

export function problemLabel(kind) {
  return PROBLEM_NAMES[kind] ?? "";
}

/** The three funded departments, in the order of the budget layout. */
export const DEPARTMENTS = [
  { key: "road", label: "Routes et rails" },
  { key: "fire", label: "Pompiers" },
  { key: "police", label: "Police" },
];

/** Decode the array returned by `City.budget()` (18 integers). */
export function decodeBudget(a) {
  const v = (i) => Number(a[i]) || 0;
  return {
    taxRate: v(0),
    funds: v(1),
    taxFund: v(2),
    cashFlow: v(3),
    taxAverage: v(4),
    autoBudget: v(5) === 1,
    fund: { road: v(6), fire: v(7), police: v(8) },
    spend: { road: v(9), fire: v(10), police: v(11) },
    percent: { road: v(12), fire: v(13), police: v(14) },
    effect: { road: v(15), fire: v(16), police: v(17) },
  };
}

/** Decode the array returned by `City.evaluation()` (15 integers). Empty problem slots are dropped. */
export function decodeEvaluation(a) {
  const v = (i) => Number(a[i]) || 0;
  const problems = [];
  for (let slot = 0; slot < 4; slot++) {
    const kind = v(7 + 2 * slot);
    if (kind >= 0) problems.push({ kind, label: problemLabel(kind), votes: v(8 + 2 * slot) });
  }
  return {
    score: v(0),
    scoreDelta: v(1),
    classIndex: v(2),
    className: classLabel(v(2)),
    population: v(3),
    populationDelta: v(4),
    assessedValue: v(5),
    yesPercent: v(6),
    problems,
  };
}

/** One line of the budget dialog: requested amount, funded percent, spent amount. */
export function departmentLine(budget, dept) {
  const requested = budget.fund[dept.key];
  const percent = budget.percent[dept.key];
  const spent = budget.spend[dept.key];
  return {
    key: dept.key,
    label: dept.label,
    requested,
    percent,
    spent,
    text: `${dept.label} : ${formatPercent(percent)} financé, ${formatMoney(spent)} sur ${formatMoney(requested)} demandés`,
  };
}

/** Text of the tax line: the rate, what a collection would bring at that rate, and the last collection. */
export function taxText(rate, estimate, lastCollection) {
  const perPoint = rate > 0 ? Math.round(estimate / rate) : 0;
  return (
    `Taux ${rate} % : recettes estimées ${formatMoney(estimate)} par collecte` +
    (rate > 0 ? `, soit environ ${formatMoney(perPoint)} par point d'impôt` : "") +
    `. Dernière collecte : ${formatMoney(lastCollection)}.`
  );
}

/** Text of the score line, announced by the live region when the score changes. */
export function scoreText(e) {
  return `Score : ${formatInt(e.score)} sur 1 000 (${formatSigned(e.scoreDelta)}). Classe : ${e.className}.`;
}

/** Nice axis bounds: a range that contains every value, with at least a span of 1. */
export function chartBounds(seriesList) {
  let min = Infinity;
  let max = -Infinity;
  for (const s of seriesList) {
    for (const v of s) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

/** Round tick values with a 1, 2 or 5 step: about `count` ticks between min and max. */
export function axisTicks(min, max, count = 4) {
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step + 1e-9);
  const ticks = [];
  for (let k = first; k <= last; k++) ticks.push(Number((k * step).toFixed(decimals)));
  return ticks;
}

/** Points of a polyline for `values` inside the box `{ x, y, w, h }` (y grows downward). */
export function linePoints(values, box, bounds) {
  const n = values.length;
  const span = bounds.max - bounds.min || 1;
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = n <= 1 ? box.x : box.x + (i / (n - 1)) * box.w;
    const y = box.y + box.h - ((values[i] - bounds.min) / span) * box.h;
    points.push([x, y]);
  }
  return points;
}

/** Summary of one history for the text alternative: last value, minimum, maximum, first value. */
export function historySummary(values) {
  if (!values.length) return { first: 0, last: 0, min: 0, max: 0 };
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { first: values[0], last: values[values.length - 1], min, max };
}

/** Name of the history scale used by `City.history(kind, scale)`. */
export const HISTORY_SCALES = [
  { id: 0, label: "10 ans" },
  { id: 1, label: "120 ans" },
];

/** The chart definitions: which history kinds each canvas draws. */
export const CHARTS = [
  {
    id: "demand",
    title: "Résidentiel, commercial, industriel",
    series: [
      { kind: 0, label: "Résidentiel", color: "#2b6cb0" },
      { kind: 1, label: "Commercial", color: "#2f855a" },
      { kind: 2, label: "Industriel", color: "#b7791f" },
    ],
  },
  {
    id: "money",
    title: "Trésorerie",
    series: [{ kind: 3, label: "Argent", color: "#805ad5" }],
  },
  {
    id: "nuisance",
    title: "Pollution et criminalité",
    series: [
      { kind: 5, label: "Pollution", color: "#9c4221" },
      { kind: 4, label: "Criminalité", color: "#c53030" },
    ],
  },
];
