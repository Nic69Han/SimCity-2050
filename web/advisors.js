// Page feature: city advisors (#advisors-panel). Presentation only (ARCHITECTURE.md): the numbers come
// from the engine, the wording and thresholds are in advisors-model.js (pure, tested). This file reads
// the engine, calls advise() and draws the list again only when the advice changes.
// setup(api) runs once; update(api) runs after every redraw, so it stays cheap.
import { DEAL_LEN } from "./deals-model.js";
import { decodeBudget, decodeEvaluation } from "./budget-text.js";
import { advise, SEVERITY_LABEL } from "./advisors-model.js";
import { decodeRail } from "./agents-model.js";
import { supports as hasOrdinances, readOrdinances } from "./ordinances-model.js";
import { countLandfills, wasteSnapshot } from "./waste-model.js";

const HIST_MONEY = 3;
const HIST_POLLUTION = 5;
const HIST_SHORT = 0;

let panel = null;
let lastKey = null;
let lastReads = null;

function call(city, name, ...args) {
  return typeof city?.[name] === "function" ? city[name](...args) : null;
}

const RULES = [
  ["water", "water_rules"], ["transit", "transit_rules"], ["deals", "deals_rules"], ["agents", "agent_rules"], ["waste", "waste_rules"],
];

/** The rule switches the engine has, { water, transit, deals, agents } (a missing method leaves the name out). */
function readRules(city) {
  const rules = {};
  for (const [name, method] of RULES) {
    const v = call(city, method);
    if (v !== null && v !== undefined) rules[name] = v === true;
  }
  return rules;
}

const ints = (a) => (a && typeof a.length === "number" ? Array.from(a, Number) : null);

/**
 * Deals (crates/micropolis-wasm/src/deals.rs, decoded with web/deals-model.js): active_deals() is flat
 * records of DEAL_LEN numbers [neighbour, resource, amount, price, income, covered, cancel_penalty];
 * surplus() is [electricity, water]. A malformed answer is left out.
 */
// Field of a deal record: its yearly income.
const DEAL_INCOME = 4;

function readDeals(city) {
  const deals = {};
  const active = call(city, "active_deals");
  if (active && typeof active.length === "number" && active.length % DEAL_LEN === 0) {
    deals.count = active.length / DEAL_LEN;
    let income = 0;
    for (let i = 0; i < deals.count; i++) income += Number(active[i * DEAL_LEN + DEAL_INCOME]) || 0;
    deals.income = income;
  }
  const sur = call(city, "surplus");
  if (sur && typeof sur.length === "number" && sur.length >= 1 && Number.isFinite(Number(sur[0]))) {
    deals.surplus = Number(sur[0]); // electricity
  }
  return deals;
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
  const rules = readRules(city);
  if (Object.keys(rules).length) s.rules = rules;
  const w = rules.water ? ints(call(city, "water_stats")) : null;
  if (w && w.length >= 4) s.water = { pumps: w[0], pipes: w[1], watered: w[2], dry: w[3] };
  const t = rules.transit ? ints(call(city, "transit_stats")) : null;
  if (t && t.length >= 4) s.transit = { stations: t[0], tunnels: t[1], lines: t[2], served: t[3] };
  // agent_stats: [active_cars, finished_trips, mean_trip_ticks, saturated_tiles, motorised_residents]
  const a = rules.agents ? ints(call(city, "agent_stats")) : null;
  if (a && a.length >= 5) s.agents = { cars: a[0], finished: a[1], meanTicks: a[2], saturated: a[3], motorised: a[4] };
  // transport_stats: [buses, taxis, waiting, bus_trips_month, taxi_rides_month, income_month], read with the rule only
  const tr = rules.agents ? ints(call(city, "transport_stats")) : null;
  if (tr && tr.length >= 3) s.transport = { waiting: tr[2] };
  // rail_stats: [trains, rames, train_riders_month, metro_riders_month, rail_income_month, train_lines, metro_lines]
  const rl = rules.agents ? ints(call(city, "rail_stats")) : null;
  if (rl) s.rail = decodeRail(rl);
  if (hasOrdinances(city)) {
    s.ordinances = readOrdinances(city).map((o) => ({
      key: o.key, label: o.label, active: o.active, cost: o.info.cost, crime: o.info.crime, pollution: o.info.pollution,
    }));
  }
  if (rules.deals) s.deals = readDeals(city);
  // waste_stats: [produced, treated, recycled, exported, accumulated, landfill_left, power], read with the rule only;
  // the landfills are counted in structures() (docs/game-design-v08.md).
  const ws = rules.waste ? ints(call(city, "waste_stats")) : null;
  if (ws && ws.length >= 6) s.waste = wasteSnapshot(ws, ints(call(city, "structures")));
  return s;
}

/**
 * The cheap flags of the extended rules, read every frame: the rule switches, the ordinances in force and
 * the water and metro counters (few integers each), the saturated road count, the waiting riders and the rail
 * riders of the month. They change when the player flips a switch, votes an ordinance, builds a pipe, a pump,
 * a tunnel or a station, or when the traffic jams, so the advice follows without waiting a month. The switches
 * are in JSON.stringify(rules), agents included.
 */
export function cheapKey(city) {
  const rules = readRules(city);
  const parts = [JSON.stringify(rules)];
  if (hasOrdinances(city)) {
    const n = Number(city.ordinance_count()) | 0;
    let mask = 0;
    for (let i = 0; i < Math.min(n, 31); i++) if (city.ordinance_active(i)) mask |= 1 << i;
    parts.push(mask);
  }
  if (rules.water) parts.push(ints(call(city, "water_stats"))?.join());
  if (rules.transit) parts.push(ints(call(city, "transit_stats"))?.join());
  if (rules.agents) {
    const rail = ints(call(city, "rail_stats"));
    parts.push(ints(call(city, "agent_stats"))?.[3] ?? null, ints(call(city, "transport_stats"))?.[2] ?? null, rail?.[2] ?? null, rail?.[3] ?? null);
  }
  if (rules.deals) parts.push(call(city, "active_deals")?.length, call(city, "surplus")?.join?.());
  if (rules.waste) {
    // the garbage on the map (index 4) and the landfill room (index 5), and the landfills placed
    const ws = ints(call(city, "waste_stats"));
    parts.push(ws?.[4] ?? null, ws?.[5] ?? null, countLandfills(ints(call(city, "structures"))));
  }
  return parts.join("/");
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
  const reads = [call(city, "year"), call(city, "month"), call(city, "funds"), call(city, "budget")?.join(), cheapKey(city)].join("|");
  if (reads === lastReads) return;
  lastReads = reads;
  render(advise(readSnapshot(city)));
}
