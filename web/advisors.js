// Page feature: city advisors (#advisors-panel). Presentation only (ARCHITECTURE.md): the numbers come
// from the engine, the wording and thresholds are in advisors-model.js (pure, tested). This file reads
// the engine, calls advise() and draws the list again only when the advice changes.
// setup(api) runs once; update(api) runs after every redraw, so it stays cheap.
import { decodeBudget, decodeEvaluation } from "./budget-text.js";
import { advise, SEVERITY_LABEL } from "./advisors-model.js";

const HIST_MONEY = 3;
const HIST_POLLUTION = 5;
const HIST_SHORT = 0;

let panel = null;
let lastKey = null;
let lastReads = null;

function call(city, name, ...args) {
  return typeof city?.[name] === "function" ? city[name](...args) : null;
}

/** Everything the engine can tell, in the shape advise() reads. Missing methods leave fields out. */
export function readSnapshot(city) {
  const s = {};
  const funds = call(city, "funds");
  if (typeof funds === "number") s.funds = funds;
  const b = call(city, "budget");
  if (b && b.length >= 18) {
    const d = decodeBudget(b);
    Object.assign(s, { funds: d.funds, cashFlow: d.cashFlow, taxRate: d.taxRate, funding: d.percent });
  }
  const e = call(city, "evaluation");
  if (e && e.length >= 15) {
    const d = decodeEvaluation(e);
    Object.assign(s, { problems: d.problems, population: d.population, populationDelta: d.populationDelta });
  }
  const dem = call(city, "demand");
  if (dem && dem.length >= 3) s.demand = { res: dem[0], com: dem[1], ind: dem[2] };
  const money = call(city, "history", HIST_MONEY, HIST_SHORT);
  if (money?.length) s.moneyHistory = Array.from(money);
  const pol = call(city, "history", HIST_POLLUTION, HIST_SHORT);
  if (pol?.length) s.pollutionHistory = Array.from(pol);
  return s;
}

function render(advice) {
  const key = JSON.stringify(advice);
  if (key === lastKey) return;
  lastKey = key;
  panel.hidden = advice.length === 0;
  const h = document.createElement("h2");
  h.textContent = "Conseillers";
  const ul = document.createElement("ul");
  ul.className = "adv-list";
  for (const a of advice) {
    const li = document.createElement("li");
    li.className = `adv adv-${a.severity}`;
    li.dataset.advisor = a.id;
    const head = document.createElement("h3");
    const name = document.createElement("span");
    name.textContent = a.title;
    const sev = document.createElement("span");
    sev.className = "adv-sev";
    sev.textContent = SEVERITY_LABEL[a.severity];
    head.append(name, " ", sev);
    const diag = document.createElement("p");
    diag.className = "adv-diag";
    diag.textContent = a.diagnosis;
    const act = document.createElement("p");
    act.className = "adv-act";
    const lead = document.createElement("strong");
    lead.textContent = "Conseil : ";
    act.append(lead, a.action);
    li.append(head, diag, act);
    ul.append(li);
  }
  panel.replaceChildren(h, ul);
}

export function setup(api) {
  panel = api.$("advisors-panel");
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  // cheap guard: the evaluation and the histories move at most once a game month, so the advice is
  // recomputed on a new month, or when the player changes the funds, the tax or the budget. Not on
  // demand or population, which change on almost every tick and would recompute it every frame.
  const reads = [call(city, "year"), call(city, "month"), call(city, "funds"), call(city, "budget")?.join()].join("|");
  if (reads === lastReads) return;
  lastReads = reads;
  render(advise(readSnapshot(city)));
}
