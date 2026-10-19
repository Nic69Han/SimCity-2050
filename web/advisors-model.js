// Pure model of the city advisors (docs/game-design.md, workstream "Conseillers"). No DOM, no engine
// calls, no randomness: advise(snapshot) turns numbers the engine reported into one diagnosis and one
// suggested action per advisor. No game rule is invented here (ARCHITECTURE.md): every threshold below
// only decides when to WORD what the engine reports. Tested by web/test/advisors.test.mjs.
import { formatMoney, formatInt } from "./budget-text.js";

export const SEVERITY = Object.freeze({ OK: "ok", ATTENTION: "attention", URGENT: "urgent" });
export const SEVERITY_LABEL = Object.freeze({ ok: "Tout va bien", attention: "Attention", urgent: "Urgent" });
const RANK = { ok: 0, attention: 1, urgent: 2 };

/** Problem kinds of City.evaluation() (CVP_* of evaluate.rs). */
export const PROBLEM = Object.freeze({ CRIME: 0, POLLUTION: 1, HOUSING: 2, TAXES: 3, TRAFFIC: 4, UNEMPLOYMENT: 5, FIRE: 6 });

// ---- thresholds (all documented here; the unit tests pin each one) ----
/** Funds in dollars: at or below, the city can hardly build or pay (urgent); below LOW, attention. */
export const FUNDS_URGENT = 1000;
export const FUNDS_LOW = 5000;
/** Negative cash flow is urgent when funds + CASH_RUNWAY * cashFlow < 0 (broke within 2 collections). */
export const CASH_RUNWAY = 2;
/** History of money (City.history(3, 0), 0..255, 128 = neutral): last MONEY_WINDOW values compared. */
export const MONEY_WINDOW = 12;
/** A fall of at least this many history units over the window is a worrying trend. */
export const MONEY_DROP = 8;
/** Pollution history (kind 5, 0..255): a rise of at least this over MONEY_WINDOW values is worrying. */
export const POLLUTION_RISE = 10;
/** Tax rate in percent (engine range 0..20). */
export const TAX_HIGH = 12;
export const TAX_VERY_HIGH = 16;
/** Budget funding in percent: below LOW attention, below VERY_LOW urgent (roads, fire, police). */
export const FUNDING_LOW = 60;
export const FUNDING_VERY_LOW = 30;
/** Evaluation problem votes (out of 100 citizens): at least ATTENTION is attention, URGENT is urgent. */
export const VOTES_ATTENTION = 15;
export const VOTES_URGENT = 35;
/** Demand valves (residential -2000..2000, commercial and industrial -1500..1500). */
export const DEMAND_HIGH = 500;
export const DEMAND_LOW = -500;
/** Population falling: delta below minus this fraction of the population. */
export const POP_FALL_RATIO = 0.02;
/** Size of the tax step suggested when money is short, in points of tax rate. */
export const TAX_STEP = 2;
export const TAX_MAX = 20;

/** Water (only when the rule is on): zones without water. Urgent when at least WATER_DRY_URGENT_MIN zones
 *  are dry AND they are WATER_DRY_URGENT_SHARE percent or more of the zones that need water. */
export const WATER_DRY_URGENT_MIN = 4;
export const WATER_DRY_URGENT_SHARE = 50;
/** Distance (tiles) from a fed pipe within which a zone has water (WATER_REACH of the engine, for the wording). */
export const WATER_REACH = 3;
/** Deals (only when the rule is on): a surplus of at least this many units is worth selling. */
export const DEAL_SURPLUS_MIN = 1;
/** Traffic (only when the agents rule is on): saturated road tiles from which the jams are worth a word
 *  (attention) and from which they are urgent; a mean trip of TRAFFIC_TRIP_LONG ticks or more is attention
 *  even without saturation. */
export const TRAFFIC_SAT_ATTENTION = 1;
export const TRAFFIC_SAT_URGENT = 10;
export const TRAFFIC_TRIP_LONG = 120;

const TITLES = { finances: "Finances", security: "Sécurité", planning: "Urbanisme", environment: "Environnement" };
/** Display order on equal severity. */
export const ORDER = ["finances", "security", "planning", "environment"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function finding(severity, diagnosis, action) {
  return { severity, diagnosis, action };
}

/** Worst finding wins; the earliest among equals (so lists are written in priority order). */
function worst(findings) {
  let best = null;
  for (const f of findings) if (!best || RANK[f.severity] > RANK[best.severity]) best = f;
  return best;
}

function advisor(id, findings, fallback) {
  const f = worst(findings) ?? fallback;
  return f ? { id, title: TITLES[id], severity: f.severity, diagnosis: f.diagnosis, action: f.action } : null;
}

/** Votes of a problem kind in snapshot.problems ([{kind, votes}]), 0 when absent, null if no list. */
function votesOf(problems, kind) {
  if (!Array.isArray(problems)) return null;
  const p = problems.find((x) => x && x.kind === kind);
  return num(p?.votes) ?? 0;
}

function votesSeverity(votes) {
  if (votes >= VOTES_URGENT) return SEVERITY.URGENT;
  if (votes >= VOTES_ATTENTION) return SEVERITY.ATTENTION;
  return null;
}

/** Last MONEY_WINDOW values of a history: last minus the first of the window; null if too short. */
export function trend(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const w = values.slice(-MONEY_WINDOW);
  const a = num(w[0]);
  const b = num(w[w.length - 1]);
  return a === null || b === null ? null : b - a;
}

const plural = (n, one, many) => (n === 1 ? one : many);
const flag = (s, name) => s.rules?.[name] === true;

/** Readable ordinances of the snapshot: [{ key, label, active, cost, crime, pollution }], bad entries dropped. */
function ordinancesOf(s) {
  return Array.isArray(s.ordinances) ? s.ordinances.filter((o) => o && typeof o === "object" && typeof o.label === "string") : [];
}

/** The inactive ordinance that lowers `field` ("crime" or "pollution") most (first on a tie), or null. */
export function pickOrdinance(list, field) {
  let best = null;
  for (const o of list) {
    const v = num(o[field]);
    if (!o.active && v !== null && v < 0 && (best === null || v < best[field])) best = o;
  }
  return best;
}

/** " Vous pouvez aussi voter l'ordonnance « X » (Y par an)." or "" when none applies. */
function ordinanceTip(s, field) {
  const o = pickOrdinance(ordinancesOf(s), field);
  if (!o) return "";
  const cost = num(o.cost);
  return ` Vous pouvez aussi voter l'ordonnance « ${o.label} »${cost !== null ? ` (${formatMoney(cost)} par an)` : ""}.`;
}

/** Yearly cost of the active ordinances and the most expensive one: { total, top } (total 0 when none). */
function ordinanceCosts(s) {
  let total = 0;
  let top = null;
  for (const o of ordinancesOf(s)) {
    const c = num(o.cost);
    if (o.active && c !== null && c > 0) {
      total += c;
      if (top === null || c > top.cost) top = { label: o.label, cost: c };
    }
  }
  return { total, top };
}

/** Notes added to the Finances advice: yearly ordinance cost, deal income, and a surplus worth selling. */
function financeNotes(s, costs) {
  const diag = [];
  let sell = "";
  if (costs.total > 0) diag.push(`Les ordonnances coûtent ${formatMoney(costs.total)} par an.`);
  const d = flag(s, "deals") && s.deals && typeof s.deals === "object" ? s.deals : null;
  const count = num(d?.count);
  const income = num(d?.income);
  if (count !== null && count > 0 && income !== null) {
    diag.push(`${count} ${plural(count, "accord rapporte", "accords rapportent")} ${formatMoney(income)} par an.`);
  }
  const surplus = num(d?.surplus);
  if (surplus !== null && surplus >= DEAL_SURPLUS_MIN) {
    sell = " Vendez votre surplus d'électricité aux villes voisines.";
  }
  return { diag: diag.length ? ` ${diag.join(" ")}` : "", sell };
}

function financesAdvice(s) {
  const funds = num(s.funds);
  const cash = num(s.cashFlow);
  const rate = num(s.taxRate);
  const drop = trend(s.moneyHistory);
  const taxVotes = votesOf(s.problems, PROBLEM.TAXES);
  if (funds === null && cash === null && taxVotes === null) return null;
  const costs = ordinanceCosts(s);
  const retire = costs.top ? ` Ou retirez l'ordonnance « ${costs.top.label} » (${formatMoney(costs.top.cost)} par an).` : "";
  const raise = (rate !== null && rate < TAX_HIGH
    ? `Relevez les impôts à ${Math.min(rate + TAX_STEP, TAX_MAX)} % ou réduisez un budget.`
    : "Réduisez un budget (routes, pompiers ou police) ou attendez la prochaine collecte.") + retire;
  const f = [];
  if (funds !== null && funds <= FUNDS_URGENT) {
    f.push(finding(SEVERITY.URGENT, `Les caisses sont presque vides : ${formatMoney(funds)}.`, raise));
  }
  if (funds !== null && cash !== null && cash < 0 && funds + CASH_RUNWAY * cash < 0) {
    f.push(finding(SEVERITY.URGENT, `La ville perd ${formatMoney(-cash)} par collecte et sera à sec très vite.`, raise));
  }
  if (cash !== null && cash < 0) {
    f.push(finding(SEVERITY.ATTENTION, `Les dépenses dépassent les recettes de ${formatMoney(-cash)} par collecte.`, raise));
  }
  if (funds !== null && funds < FUNDS_LOW) {
    f.push(finding(SEVERITY.ATTENTION, `La trésorerie est basse : ${formatMoney(funds)}.`, "Construisez avec prudence et attendez la prochaine collecte."));
  }
  if (drop !== null && drop <= -MONEY_DROP) {
    f.push(finding(SEVERITY.ATTENTION, "La trésorerie baisse depuis plusieurs mois.", raise));
  }
  const ts = taxVotes === null ? null : votesSeverity(taxVotes);
  if (ts) {
    f.push(finding(ts, "Les habitants se plaignent des impôts.", rate !== null && rate > 0 ? `Baissez l'impôt de ${TAX_STEP} points si les caisses le permettent.` : "Surveillez la trésorerie."));
  }
  const shown = funds !== null ? `Trésorerie saine : ${formatMoney(funds)}` : "Les comptes sont équilibrés";
  const a = advisor("finances", f, finding(SEVERITY.OK, `${shown}.`, "Gardez le cap : investissez dans de nouvelles zones."));
  const notes = financeNotes(s, costs);
  a.diagnosis += notes.diag;
  a.action += notes.sell;
  return a;
}

function fundingFinding(funding, key, label, what) {
  const p = num(funding?.[key]);
  if (p === null) return null;
  if (p < FUNDING_VERY_LOW) return finding(SEVERITY.URGENT, `${label} : financement à ${formatInt(p)} %, ${what} ne sont plus assurés.`, `Remontez le financement de ${label.toLowerCase()} dans le budget.`);
  if (p < FUNDING_LOW) return finding(SEVERITY.ATTENTION, `${label} : financement à ${formatInt(p)} %, ${what} sont affaiblis.`, `Remontez le financement de ${label.toLowerCase()} dans le budget.`);
  return null;
}

function securityAdvice(s) {
  const crime = votesOf(s.problems, PROBLEM.CRIME);
  const fire = votesOf(s.problems, PROBLEM.FIRE);
  const police = fundingFinding(s.funding, "police", "Police", "les patrouilles");
  const fireFund = fundingFinding(s.funding, "fire", "Pompiers", "les secours");
  if (crime === null && police === null && fireFund === null && !s.funding) return null;
  const f = [];
  const cs = crime === null ? null : votesSeverity(crime);
  if (cs) f.push(finding(cs, "La criminalité inquiète les habitants.", `Financez la police et construisez un poste de police près des quartiers touchés.${ordinanceTip(s, "crime")}`));
  const fs = fire === null ? null : votesSeverity(fire);
  if (fs) f.push(finding(fs, "Le risque d'incendie préoccupe les habitants.", "Financez les pompiers et ajoutez une caserne dans les quartiers mal couverts."));
  if (police) f.push(police);
  if (fireFund) f.push(fireFund);
  return advisor("security", f, finding(SEVERITY.OK, "Police et pompiers font face : peu de plaintes.", "Continuez à couvrir les nouveaux quartiers."));
}

/** Water coverage finding (rule on, snapshot.water = { pumps, pipes, watered, dry }), or null. */
function waterFinding(s) {
  const w = flag(s, "water") && s.water && typeof s.water === "object" ? s.water : null;
  const dry = num(w?.dry);
  if (dry === null || dry < 1) return null;
  const total = dry + Math.max(0, num(w.watered) ?? 0);
  const share = Math.round((dry * 100) / total);
  const urgent = dry >= WATER_DRY_URGENT_MIN && share >= WATER_DRY_URGENT_SHARE;
  const pumps = num(w.pumps) ?? 0;
  const action = pumps < 1
    ? "Posez une pompe sur la rive, puis des canalisations jusqu'aux zones."
    : `Prolongez les canalisations à moins de ${WATER_REACH} cases des zones à sec, ou ajoutez une pompe.`;
  return finding(urgent ? SEVERITY.URGENT : SEVERITY.ATTENTION,
    `${formatInt(dry)} ${plural(dry, "zone n'a", "zones n'ont")} pas d'eau (${share} % des zones) : elles ne se développent plus au-delà d'un petit palier.`, action);
}

/** Metro findings (rule on, snapshot.transit = { stations, tunnels, lines, served }): [traffic, idle]. */
function transitFindings(s, trafficSeverity) {
  const t = flag(s, "transit") && s.transit && typeof s.transit === "object" ? s.transit : null;
  const lines = num(t?.lines);
  if (lines === null) return { traffic: null, idle: null, lines: null };
  const stations = num(t.stations) ?? 0;
  let traffic = null;
  if (trafficSeverity && lines < 1) {
    traffic = finding(trafficSeverity, "La circulation est dense et aucune ligne de métro ne fonctionne.", "Creusez des tunnels entre deux stations de métro pour former une ligne.");
  } else if (trafficSeverity) {
    traffic = finding(trafficSeverity, `La circulation reste dense malgré ${lines} ${plural(lines, "ligne de métro", "lignes de métro")}.`, "Prolongez le métro vers les quartiers chargés.");
  }
  const idle = !trafficSeverity && lines < 1 && stations > 0
    ? finding(SEVERITY.ATTENTION, "Des stations de métro sont posées mais aucune ligne ne fonctionne.", "Reliez deux stations par des tunnels pour ouvrir une ligne.")
    : null;
  return { traffic, idle, lines };
}

/** Traffic of the agents rule (rule on, snapshot.agents = { cars, finished, meanTicks, saturated, motorised }),
 *  reduced to what the advice reads; null when absent. */
function agentsOf(s) {
  const a = flag(s, "agents") && s.agents && typeof s.agents === "object" ? s.agents : null;
  const saturated = num(a?.saturated);
  if (saturated === null) return null;
  return { cars: num(a.cars) ?? 0, meanTicks: num(a.meanTicks) ?? 0, saturated };
}

/** Jam finding from the measured traffic, or null while the roads flow. The remedy is a metro line when the
 *  metro rule is on, else parallel roads or another access to the job zones. */
function agentsFinding(s) {
  const a = agentsOf(s);
  if (!a) return null;
  const long = a.meanTicks >= TRAFFIC_TRIP_LONG;
  let severity = null;
  if (a.saturated >= TRAFFIC_SAT_URGENT) severity = SEVERITY.URGENT;
  else if (a.saturated >= TRAFFIC_SAT_ATTENTION || long) severity = SEVERITY.ATTENTION;
  if (!severity) return null;
  const parts = [];
  if (a.saturated >= TRAFFIC_SAT_ATTENTION) parts.push(`Les routes sont saturées sur ${formatInt(a.saturated)} ${plural(a.saturated, "case", "cases")}.`);
  if (long) parts.push(`Les trajets durent en moyenne ${formatInt(a.meanTicks)} pas.`);
  const action = flag(s, "transit")
    ? "Ajoutez une ligne de métro pour désengorger les routes."
    : "Ajoutez des routes parallèles ou un autre accès vers les zones d'emploi.";
  return finding(severity, parts.join(" "), action);
}

function planningAdvice(s) {
  const rate = num(s.taxRate);
  const road = fundingFinding(s.funding, "road", "Routes et rails", "l'entretien");
  const housing = votesOf(s.problems, PROBLEM.HOUSING);
  const traffic = votesOf(s.problems, PROBLEM.TRAFFIC);
  const jobs = votesOf(s.problems, PROBLEM.UNEMPLOYMENT);
  const d = s.demand ?? null;
  const dr = num(d?.res);
  const dc = num(d?.com);
  const di = num(d?.ind);
  const demandKnown = dr !== null || dc !== null || di !== null;
  const ag = agentsOf(s);
  if (rate === null && !road && housing === null && traffic === null && !demandKnown && num(s.populationDelta) === null &&
    !flag(s, "water") && !flag(s, "transit") && !ag) return null;
  const f = [];
  const water = waterFinding(s);
  const ts = traffic === null ? null : votesSeverity(traffic);
  const metro = transitFindings(s, ts);
  if (rate !== null && rate >= TAX_VERY_HIGH) {
    f.push(finding(SEVERITY.URGENT, `Impôts à ${rate} % : ils freinent la croissance de la ville.`, `Baissez le taux sous ${TAX_HIGH} % dès que les caisses le permettent.`));
  } else if (rate !== null && rate >= TAX_HIGH) {
    f.push(finding(SEVERITY.ATTENTION, `Impôts à ${rate} % : le taux commence à peser sur la croissance.`, `Envisagez de revenir sous ${TAX_HIGH} %.`));
  }
  const hs = housing === null ? null : votesSeverity(housing);
  if (hs) f.push(finding(hs, "Le coût du logement pèse sur les habitants.", "Zonez plus de résidentiel et de parcs pour faire baisser les prix."));
  if (metro.traffic) f.push(metro.traffic);
  else if (ts) f.push(finding(ts, "La circulation est dense.", "Ajoutez des routes ou des lignes de transport en commun."));
  const jam = agentsFinding(s);
  if (jam) f.push(jam);
  if (water) f.push(water);
  if (metro.idle) f.push(metro.idle);
  const js = jobs === null ? null : votesSeverity(jobs);
  if (js) f.push(finding(js, "Le chômage est un souci des habitants.", "Zonez du commercial ou de l'industriel pour créer des emplois."));
  if (road) f.push(road);
  const pop = num(s.population);
  const pd = num(s.populationDelta);
  if (pd !== null && pop !== null && pop > 0 && pd < -POP_FALL_RATIO * pop) {
    f.push(finding(SEVERITY.ATTENTION, `La population recule (${formatInt(pd)} habitants).`, "Cherchez ce qui fait fuir les habitants : impôts, criminalité, pollution."));
  }
  if (dr !== null && dr <= DEMAND_LOW && (dc === null || dc <= DEMAND_LOW) && (di === null || di <= DEMAND_LOW)) {
    f.push(finding(SEVERITY.ATTENTION, "La ville ne demande plus de nouvelles zones.", "Améliorez l'existant (services, transports) avant de zoner."));
  }
  const wants = [];
  if (dr !== null && dr >= DEMAND_HIGH) wants.push("résidentiel");
  if (dc !== null && dc >= DEMAND_HIGH) wants.push("commercial");
  if (di !== null && di >= DEMAND_HIGH) wants.push("industriel");
  const fallback = wants.length
    ? finding(SEVERITY.OK, `La demande est forte en ${wants.join(", ")}.`, `Zonez du ${wants[0]} pour continuer à grandir.`)
    : finding(SEVERITY.OK, "La croissance suit son cours.", "Observez la demande et zonez où elle apparaît.");
  if (metro.lines !== null && metro.lines > 0) {
    fallback.diagnosis = fallback.diagnosis.replace(/\.$/, `, ${metro.lines} ${plural(metro.lines, "ligne de métro", "lignes de métro")} en service.`);
  }
  if (ag && ag.cars > 0) {
    fallback.diagnosis = fallback.diagnosis.replace(/\.$/, `, ${formatInt(ag.cars)} ${plural(ag.cars, "voiture circule", "voitures circulent")} sur les routes.`);
  }
  return advisor("planning", f, fallback);
}

function environmentAdvice(s) {
  const pollution = votesOf(s.problems, PROBLEM.POLLUTION);
  const rise = trend(s.pollutionHistory);
  if (pollution === null && rise === null) return null;
  const f = [];
  const ps = pollution === null ? null : votesSeverity(pollution);
  if (ps) f.push(finding(ps, "La pollution gêne les habitants.", `Plantez des arbres, éloignez l'industrie des quartiers et préférez les centrales propres.${ordinanceTip(s, "pollution")}`));
  if (rise !== null && rise >= POLLUTION_RISE) {
    f.push(finding(SEVERITY.ATTENTION, "La pollution augmente depuis plusieurs mois.", `Plantez des arbres et limitez l'industrie près des habitations.${ordinanceTip(s, "pollution")}`));
  }
  return advisor("environment", f, finding(SEVERITY.OK, "L'air est correct : la pollution ne ressort pas des plaintes.", "Gardez des espaces verts entre industries et logements."));
}

/**
 * snapshot = {
 *   funds, cashFlow, taxRate,                 // numbers or absent (City.budget)
 *   funding: { road, fire, police },          // percent funded 0..100
 *   problems: [{ kind, votes }],              // City.evaluation, worst first
 *   demand: { res, com, ind },                // City.demand
 *   population, populationDelta,              // City.evaluation
 *   moneyHistory, pollutionHistory,           // City.history(3|5, 0), oldest first
 *   // extended rules, each only when the engine has the API (advisors.js readSnapshot); a block is
 *   // ignored unless its switch in `rules` is exactly true:
 *   rules: { water, transit, deals, agents }, // booleans: water_rules, transit_rules, deals_rules, agent_rules
 *   water: { pumps, pipes, watered, dry },    // City.water_stats
 *   transit: { stations, tunnels, lines, served },  // City.transit_stats
 *   ordinances: [{ key, label, active, cost, crime, pollution }],  // cost per year, effects in percent
 *   deals: { count, income, surplus },        // active deals, their yearly income, electricity surplus
 *   agents: { cars, finished, meanTicks, saturated, motorised },  // City.agent_stats (cars on the road, saturated tiles)
 * }
 * Returns [{ id, title, severity, diagnosis, action }] sorted by severity (urgent first), then ORDER.
 * An advisor whose data is absent is left out. Total: any input (null, wrong types) gives an array.
 */
export function advise(snapshot) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  const list = [financesAdvice(s), securityAdvice(s), planningAdvice(s), environmentAdvice(s)].filter(Boolean);
  return list.sort((a, b) => RANK[b.severity] - RANK[a.severity] || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}
