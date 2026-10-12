// Budget, taxes, evaluation and history panel (#budget-panel). Presentation only (ARCHITECTURE.md
// rule 5): every number comes from the engine (City.budget, evaluation, history, tax_fund_at) and
// every rule stays in the core. The text and chart arithmetic is in budget-text.js.
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
// api = { city(): the engine, $(id): getElementById, redraw(), isReady() }.
import * as T from "./budget-text.js";

const STYLE = `
#budget-panel h3 { margin: .7rem 0 .3rem; font-size: 1rem; }
#budget-panel h4 { margin: .5rem 0 .2rem; font-size: .95rem; }
#budget-panel .bud-note { color: var(--muted); margin: .2rem 0; font-size: .9rem; }
#budget-panel .bud-row { display: grid; grid-template-columns: 1fr auto; gap: .1rem .5rem; align-items: center; margin: .35rem 0; }
#budget-panel .bud-row input[type=range], #budget-panel #bud-tax { width: 100%; }
#budget-panel dl { display: grid; grid-template-columns: auto 1fr; gap: .15rem .75rem; margin: .3rem 0; }
#budget-panel dt { color: var(--muted); }
#budget-panel dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
#budget-panel .bud-score { font-size: 1.1rem; font-weight: 600; }
#budget-panel .bud-toggles { display: flex; gap: .4rem; flex-wrap: wrap; }
#budget-panel .bud-toggle[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
#budget-panel figure { margin: .6rem 0; }
#budget-panel figcaption { font-weight: 600; font-size: .95rem; }
#budget-panel canvas { width: 100%; height: 150px; display: block; }
#budget-panel .legend { display: flex; flex-wrap: wrap; gap: .3rem .8rem; list-style: none; padding: 0; margin: .3rem 0; font-size: .9rem; }
#budget-panel .swatch { display: inline-block; width: .8em; height: .8em; border-radius: 2px; margin-right: .3em; vertical-align: middle; }
#budget-panel table { width: 100%; border-collapse: collapse; font-size: .85rem; }
#budget-panel th, #budget-panel td { padding: .15rem .3rem; text-align: right; border-bottom: 1px solid var(--line); }
#budget-panel th:first-child, #budget-panel td:first-child { text-align: left; }
#budget-panel details { margin: .3rem 0; }
#budget-panel summary { cursor: pointer; color: var(--muted); }
#budget-panel ol { margin: .2rem 0; padding-left: 1.4rem; }
`;

const SERIES_COLORS = ["#2b6cb0", "#2f855a", "#b7791f", "#805ad5", "#c53030", "#9c4221"];

// Engine methods the panel needs; a build without them keeps the panel hidden.
const REQUIRED = ["budget", "evaluation", "history", "set_tax", "set_budget", "tax_fund_at"];

let ui = null;
let scale = 0; // HISTORY_SCALE_SHORT: the last 10 years

function supports(city) {
  return REQUIRED.every((m) => typeof city?.[m] === "function");
}

/** Set the text of an element only when it changes (live regions announce changes only). */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function injectStyle() {
  if (document.getElementById("budget-style")) return;
  const style = el("style", { id: "budget-style" });
  style.textContent = STYLE;
  document.head.append(style);
}

function slider(id, label, min, max) {
  const input = el("input", { type: "range", id, min: String(min), max: String(max), step: "1" });
  input.setAttribute("aria-label", label);
  return input;
}

function build(panel, api) {
  const refs = {};
  const add = (name, node) => {
    refs[name] = node;
    return node;
  };

  // Taxes
  const taxInput = add("tax", slider("bud-tax", "Taux d'imposition, de 0 à 20 pour cent", 0, 20));
  taxInput.setAttribute("aria-describedby", "bud-tax-text");
  add("taxOut", el("output", { id: "bud-tax-out", for: "bud-tax" }));
  add("taxText", el("p", { id: "bud-tax-text", class: "bud-note" }));
  panel.append(
    el("h2", { text: "Budget et évaluation" }),
    el("section", { "aria-labelledby": "bud-h-tax" }, [
      el("h3", { id: "bud-h-tax", text: "Impôts" }),
      el("label", { for: "bud-tax", text: "Taux d'imposition " }),
      refs.taxOut,
      taxInput,
      refs.taxText,
    ]),
  );

  // Budget
  const autoText = add("auto", el("p", { class: "bud-note" }));
  const depRows = [];
  const budgetChildren = [el("h3", { id: "bud-h-budget", text: "Budget" }), autoText];
  for (const dept of T.DEPARTMENTS) {
    const input = add(`pct-${dept.key}`, slider(`bud-pct-${dept.key}`, `${dept.label}, financement en pour cent`, 0, 100));
    const out = add(`out-${dept.key}`, el("output", { id: `bud-out-${dept.key}`, for: `bud-pct-${dept.key}` }));
    const text = add(`text-${dept.key}`, el("p", { id: `bud-text-${dept.key}`, class: "bud-note" }));
    input.setAttribute("aria-describedby", `bud-text-${dept.key}`);
    depRows.push(dept.key);
    budgetChildren.push(
      el("div", { class: "bud-row" }, [
        el("label", { for: `bud-pct-${dept.key}`, text: dept.label }),
        out,
        input,
      ]),
      text,
    );
  }
  panel.append(el("section", { "aria-labelledby": "bud-h-budget" }, budgetChildren));

  // Financial figures
  const fin = {};
  const finRows = [
    ["funds", "Trésorerie"],
    ["taxFund", "Recettes de la dernière collecte"],
    ["cashFlow", "Flux de trésorerie"],
  ];
  const finDl = el("dl", {}, finRows.flatMap(([k, label]) => {
    fin[k] = el("dd", { id: `bud-fin-${k}` });
    return [el("dt", { text: label }), fin[k]];
  }));
  panel.append(el("section", { "aria-labelledby": "bud-h-fin" }, [el("h3", { id: "bud-h-fin", text: "Finances" }), finDl]));

  // Evaluation
  const score = add("score", el("p", { id: "bud-score", class: "bud-score", role: "status", "aria-live": "polite" }));
  const evalDl = el("dl", {}, [
    el("dt", { text: "Classe" }), (fin.cls = el("dd", { id: "bud-class" })),
    el("dt", { text: "Habitants" }), (fin.pop = el("dd", { id: "bud-pop" })),
    el("dt", { text: "Valeur des infrastructures" }), (fin.assessed = el("dd", { id: "bud-assessed" })),
    el("dt", { text: "Opinion sur le maire" }), (fin.yes = el("dd", { id: "bud-yes" })),
  ]);
  const problems = add("problems", el("ol", { id: "bud-problems" }));
  panel.append(
    el("section", { "aria-labelledby": "bud-h-eval" }, [
      el("h3", { id: "bud-h-eval", text: "Évaluation de la ville" }),
      score,
      evalDl,
      el("h4", { text: "Problèmes les plus graves" }),
      problems,
    ]),
  );

  // History
  const toggles = T.HISTORY_SCALES.map((s) => {
    const b = el("button", { type: "button", class: "bud-toggle", "aria-pressed": String(s.id === scale), text: s.label });
    b.onclick = () => {
      scale = s.id;
      ui.charts.forEach((c) => (c.key = ""));
      for (const t of toggles) t.node.setAttribute("aria-pressed", String(t.id === scale));
      api.redraw();
    };
    return { id: s.id, node: b };
  });
  const charts = T.CHARTS.map((spec) => {
    const canvas = el("canvas", { role: "img", "aria-label": spec.title, height: "150" });
    const legend = el("ul", { class: "legend" }, spec.series.map((s, i) =>
      el("li", {}, [
        el("span", { class: "swatch", "aria-hidden": "true" }),
        document.createTextNode(s.label),
      ]),
    ));
    legend.querySelectorAll(".swatch").forEach((sw, i) => (sw.style.background = spec.series[i].color || SERIES_COLORS[i]));
    const tbody = el("tbody");
    const table = el("table", {}, [
      el("thead", {}, [el("tr", {}, ["Série", "Dernière", "Minimum", "Maximum"].map((h) => el("th", { scope: "col", text: h })))]),
      tbody,
    ]);
    const details = el("details", {}, [el("summary", { text: "Valeurs du graphique" }), table]);
    return { spec, canvas, legend, tbody, details, key: "" };
  });
  ui = { refs, fin, score, problems, toggles, charts, depRows, taxInput, api };
  panel.append(
    el("section", { "aria-labelledby": "bud-h-hist" }, [
      el("h3", { id: "bud-h-hist", text: "Historique" }),
      el("div", { class: "bud-toggles", role: "group", "aria-label": "Durée de l'historique" }, toggles.map((t) => t.node)),
      ...charts.flatMap((c) => [
        el("figure", {}, [el("figcaption", { text: c.spec.title }), c.canvas, c.legend, c.details]),
      ]),
    ]),
  );

  // Handlers: the engine does the rule work; the page only forwards the value and redraws.
  taxInput.oninput = () => {
    api.city().set_tax(Number(taxInput.value));
    api.redraw();
  };
  for (const key of depRows) {
    refs[`pct-${key}`].oninput = () => {
      const city = api.city();
      city.set_budget(
        Number(refs["pct-road"].value),
        Number(refs["pct-fire"].value),
        Number(refs["pct-police"].value),
      );
      api.redraw();
    };
  }
  window.addEventListener("resize", () => {
    if (!ui) return;
    ui.charts.forEach((c) => (c.key = ""));
    api.redraw();
  });
  return ui;
}

/** Draw one chart on its canvas, with axes, grid and one polyline per series. */
function drawChart(chart, datasets, panel, scaleLabel) {
  const canvas = chart.canvas;
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = 150;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const muted = getComputedStyle(panel).getPropertyValue("--muted").trim() || "#666";
  const box = { x: 44, y: 8, w: cssWidth - 52, h: cssHeight - 30 };
  const bounds = T.chartBounds(datasets);
  const ticks = T.axisTicks(bounds.min, bounds.max, 4);
  const span = bounds.max - bounds.min || 1;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillStyle = muted;
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;
  for (const t of ticks) {
    const y = box.y + box.h - ((t - bounds.min) / span) * box.h;
    ctx.beginPath();
    ctx.moveTo(box.x, Math.round(y) + 0.5);
    ctx.lineTo(box.x + box.w, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const t of ticks) {
    const y = box.y + box.h - ((t - bounds.min) / span) * box.h;
    ctx.fillText(T.formatInt(t), box.x - 6, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(scaleLabel, box.x, cssHeight - 6);
  ctx.textAlign = "right";
  ctx.fillText("aujourd'hui", box.x + box.w, cssHeight - 6);

  chart.spec.series.forEach((s, i) => {
    const pts = T.linePoints(datasets[i], box, bounds);
    ctx.strokeStyle = s.color || SERIES_COLORS[i];
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  });
}

function refreshCharts(city, panel) {
  const scaleLabel = T.HISTORY_SCALES.find((s) => s.id === scale)?.label ?? "";
  for (const chart of ui.charts) {
    const datasets = chart.spec.series.map((s) => Array.from(city.history(s.kind, scale)));
    const key = `${scale}|${chart.canvas.clientWidth}|${datasets.map((d) => d.join(",")).join("|")}`;
    if (key === chart.key) continue;
    chart.key = key;
    drawChart(chart, datasets, panel, scaleLabel);
    const summaries = chart.spec.series.map((s, i) => ({ s, sum: T.historySummary(datasets[i]) }));
    chart.canvas.setAttribute(
      "aria-label",
      `${chart.spec.title}. ${summaries
        .map(({ s, sum }) => `${s.label} : dernière valeur ${T.formatInt(sum.last)}, minimum ${T.formatInt(sum.min)}, maximum ${T.formatInt(sum.max)}`)
        .join(". ")}.`,
    );
    chart.tbody.replaceChildren(
      ...summaries.map(({ s, sum }) =>
        el("tr", {}, [
          el("td", { text: s.label }),
          el("td", { text: T.formatInt(sum.last) }),
          el("td", { text: T.formatInt(sum.min) }),
          el("td", { text: T.formatInt(sum.max) }),
        ]),
      ),
    );
  }
}

export function setup(api) {
  const panel = api.$("budget-panel");
  if (!panel) return;
  if (!supports(api.city())) {
    panel.hidden = true;
    return;
  }
  injectStyle();
  build(panel, api);
  panel.hidden = false;
}

export function update(api) {
  if (!ui || !api.isReady()) return;
  const city = api.city();
  if (!supports(city)) return;
  const panel = api.$("budget-panel");
  const b = T.decodeBudget(city.budget());
  const e = T.decodeEvaluation(city.evaluation());
  const { refs, fin } = ui;

  // Taxes: the slider follows the engine unless the player is using it.
  if (document.activeElement !== refs.tax) refs.tax.value = String(b.taxRate);
  setText(refs.taxOut, `${b.taxRate} %`);
  const estimate = city.tax_fund_at(b.taxRate);
  setText(refs.taxText, T.taxText(b.taxRate, estimate, b.taxFund));

  // Budget
  setText(refs.auto, `Budget automatique : ${b.autoBudget ? "oui" : "non"}.`);
  for (const dept of T.DEPARTMENTS) {
    const line = T.departmentLine(b, dept);
    const input = refs[`pct-${dept.key}`];
    if (document.activeElement !== input) input.value = String(line.percent);
    setText(refs[`out-${dept.key}`], T.formatPercent(line.percent));
    setText(refs[`text-${dept.key}`], line.text);
  }

  // Finances
  setText(fin.funds, T.formatMoney(b.funds));
  setText(fin.taxFund, T.formatMoney(b.taxFund));
  setText(fin.cashFlow, T.formatMoney(b.cashFlow));

  // Evaluation
  setText(ui.score, T.scoreText(e));
  setText(fin.cls, e.className);
  setText(fin.pop, `${T.formatInt(e.population)} (${T.formatSigned(e.populationDelta)})`);
  setText(fin.assessed, T.formatMoney(e.assessedValue));
  setText(fin.yes, `${T.formatPercent(e.yesPercent)} favorables`);
  const items = e.problems.length
    ? e.problems.map((p) => `${p.label} : ${T.formatPercent(p.votes)}`)
    : ["Aucun problème signalé."];
  const text = items.join("\u0000");
  if (ui.problemsKey !== text) {
    ui.problemsKey = text;
    ui.problems.replaceChildren(...items.map((t) => el("li", { text: t })));
  }

  refreshCharts(city, panel);
}
