// Advisors and the extended rules (water, metro, ordinances, deals): thresholds, wording, missing API,
// the snapshot reader and the cheap-update key. Pure; the engine is a fake object.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../advisors-model.js";
import { readSnapshot, cheapKey } from "../advisors.js";

const calm = () => ({
  funds: 50000, cashFlow: 500, taxRate: 7,
  funding: { road: 100, fire: 100, police: 100 },
  problems: [], demand: { res: 100, com: 100, ind: 100 },
  population: 1000, populationDelta: 20, moneyHistory: [128, 128, 130], pollutionHistory: [10, 10, 10],
});
const ORD = () => [
  { key: "community_policing", label: "Police de proximité", active: false, cost: 200, crime: -15, pollution: 0 },
  { key: "pollution_control", label: "Programme anti-pollution", active: false, cost: 300, crime: 0, pollution: -20 },
  { key: "recycling", label: "Recyclage", active: false, cost: 100, crime: 0, pollution: -8 },
];
// formatMoney uses no-break spaces: compare with plain ones
const plain = (t) => t.replace(/[\s\u00a0\u202f]/g, " ");
const get = (s, id) => {
  const a = M.advise(s).find((x) => x.id === id);
  return a && { ...a, diagnosis: plain(a.diagnosis), action: plain(a.action) };
};

describe("water", () => {
  const w = (dry, watered = 0, pumps = 1) => ({ ...calm(), rules: { water: true }, water: { pumps, pipes: 3, watered, dry } });
  test("dry zones: attention, urgent from WATER_DRY_URGENT_MIN zones and WATER_DRY_URGENT_SHARE percent", () => {
    assert.equal(get(w(1, 9), "planning").severity, "attention");
    assert.equal(get(w(3, 0), "planning").severity, "attention"); // 100 % but fewer than the minimum
    assert.equal(get(w(M.WATER_DRY_URGENT_MIN, M.WATER_DRY_URGENT_MIN), "planning").severity, "urgent"); // 50 %
    assert.equal(get(w(M.WATER_DRY_URGENT_MIN, M.WATER_DRY_URGENT_MIN + 1), "planning").severity, "attention"); // 44 %
  });
  test("wording: count, share, and the right action with and without a pump", () => {
    const a = get(w(6, 2, 0), "planning");
    assert.match(a.diagnosis, /6 zones n'ont pas d'eau \(75 % des zones\)/);
    assert.match(a.action, /Posez une pompe/);
    assert.match(get(w(1, 3, 2), "planning").diagnosis, /1 zone n'a pas d'eau/);
    assert.match(get(w(2, 3, 2), "planning").action, /canalisations à moins de 3 cases/);
  });
  test("nothing when no dry zone, rule off, or stats missing", () => {
    assert.equal(get(w(0, 5), "planning").severity, "ok");
    assert.equal(get({ ...w(9, 1), rules: { water: false } }, "planning").severity, "ok");
    assert.equal(get({ ...w(9, 1), rules: {} }, "planning").severity, "ok");
    const s = w(9, 1); delete s.water;
    assert.equal(get(s, "planning").severity, "ok");
    assert.equal(get({ ...calm(), rules: { water: true }, water: { dry: "x" } }, "planning").severity, "ok");
  });
  test("water alone keeps Urbanisme visible", () => {
    const only = { rules: { water: true }, water: { pumps: 0, pipes: 0, watered: 0, dry: 5 } };
    assert.equal(get(only, "planning").severity, "urgent");
  });
});

describe("metro", () => {
  const t = (lines, stations, votes = 0) => ({
    ...calm(), rules: { transit: true }, transit: { stations, tunnels: 4, lines, served: 50 },
    problems: votes ? [{ kind: M.PROBLEM.TRAFFIC, votes }] : [],
  });
  test("traffic complaints with no working line suggest a line", () => {
    const a = get(t(0, 0, M.VOTES_ATTENTION), "planning");
    assert.equal(a.severity, "attention");
    assert.match(a.diagnosis, /aucune ligne de métro/);
    assert.match(a.action, /Creusez des tunnels entre deux stations/);
    assert.equal(get(t(0, 0, M.VOTES_URGENT), "planning").severity, "urgent");
  });
  test("traffic complaints with working lines say so", () => {
    const a = get(t(2, 4, M.VOTES_ATTENTION), "planning");
    assert.match(a.diagnosis, /malgré 2 lignes de métro/);
    assert.match(a.action, /Prolongez le métro/);
    assert.match(get(t(1, 2, M.VOTES_ATTENTION), "planning").diagnosis, /1 ligne de métro/);
  });
  test("stations without a line: attention; a working line is mentioned when all is well", () => {
    const idle = get(t(0, 2), "planning");
    assert.equal(idle.severity, "attention");
    assert.match(idle.diagnosis, /stations de métro sont posées/);
    const ok = get(t(2, 4), "planning");
    assert.equal(ok.severity, "ok");
    assert.match(ok.diagnosis, /2 lignes de métro en service\.$/);
  });
  test("rule off, no stats, or no complaint: the classic traffic advice stays", () => {
    const off = { ...t(0, 0, M.VOTES_ATTENTION), rules: { transit: false } };
    assert.equal(get(off, "planning").diagnosis, "La circulation est dense.");
    assert.equal(get(t(0, 0), "planning").severity, "ok");
    const noStats = { ...calm(), rules: { transit: true }, problems: [{ kind: M.PROBLEM.TRAFFIC, votes: 20 }] };
    assert.equal(get(noStats, "planning").diagnosis, "La circulation est dense.");
  });
});

describe("ordinances in Finances", () => {
  const withOrd = (active) => ({ ...calm(), ordinances: ORD().map((o, i) => ({ ...o, active: active.includes(i) })) });
  test("the yearly cost of the active ordinances is told", () => {
    const a = get(withOrd([0, 1]), "finances");
    assert.match(a.diagnosis, /Les ordonnances coûtent 500 \$ par an\./);
    assert.doesNotMatch(get(withOrd([]), "finances").diagnosis, /ordonnances/);
  });
  test("when money is short the costliest active ordinance is suggested for removal", () => {
    const s = withOrd([0, 1]); s.cashFlow = -50;
    assert.match(get(s, "finances").action, /Ou retirez l'ordonnance « Programme anti-pollution » \(300 \$ par an\)/);
    const none = withOrd([]); none.cashFlow = -50;
    assert.doesNotMatch(get(none, "finances").action, /retirez/);
  });
  test("bad entries are ignored", () => {
    const s = { ...calm(), ordinances: [null, 3, { label: 5 }, { label: "X", active: true, cost: "a" }] };
    assert.equal(get(s, "finances").severity, "ok");
    assert.doesNotMatch(get(s, "finances").diagnosis, /ordonnances/);
  });
});

describe("ordinances suggested by complaints", () => {
  const withProblem = (kind, votes, list = ORD()) => ({ ...calm(), problems: [{ kind, votes }], ordinances: list });
  test("crime: the inactive ordinance that lowers crime most, by its French name and cost", () => {
    const a = get(withProblem(M.PROBLEM.CRIME, M.VOTES_ATTENTION), "security");
    assert.equal(a.severity, "attention");
    assert.match(a.action, /Vous pouvez aussi voter l'ordonnance « Police de proximité » \(200 \$ par an\)\./);
  });
  test("pollution: the strongest inactive one wins; the trend finding names one too", () => {
    const a = get(withProblem(M.PROBLEM.POLLUTION, M.VOTES_URGENT), "environment");
    assert.match(a.action, /« Programme anti-pollution »/);
    const list = ORD(); list[1].active = true;
    assert.match(get(withProblem(M.PROBLEM.POLLUTION, M.VOTES_ATTENTION, list), "environment").action, /« Recyclage »/);
    const rise = { ...calm(), ordinances: ORD(), pollutionHistory: [10, 10, 10 + M.POLLUTION_RISE] };
    assert.match(get(rise, "environment").action, /« Programme anti-pollution »/);
  });
  test("nothing suggested when the ordinance is on, none helps, below the threshold, or no list", () => {
    const on = ORD(); on[0].active = true;
    assert.doesNotMatch(get(withProblem(M.PROBLEM.CRIME, 30, on), "security").action, /ordonnance/);
    assert.doesNotMatch(get(withProblem(M.PROBLEM.CRIME, 30, [ORD()[1]]), "security").action, /ordonnance/);
    assert.equal(get(withProblem(M.PROBLEM.CRIME, M.VOTES_ATTENTION - 1), "security").severity, "ok");
    assert.doesNotMatch(get(withProblem(M.PROBLEM.CRIME, 30, null), "security").action, /ordonnance/);
  });
  test("pickOrdinance: most negative, first on a tie, null when none", () => {
    assert.equal(M.pickOrdinance(ORD(), "crime").key, "community_policing");
    const tie = [{ key: "a", label: "A", active: false, crime: -5 }, { key: "b", label: "B", active: false, crime: -5 }];
    assert.equal(M.pickOrdinance(tie, "crime").key, "a");
    assert.equal(M.pickOrdinance([], "crime"), null);
  });
});

describe("deals", () => {
  const d = (deals, on = true) => ({ ...calm(), rules: { deals: on }, deals });
  test("income and a surplus to sell", () => {
    const a = get(d({ count: 2, income: 1200, surplus: 40 }), "finances");
    assert.match(a.diagnosis, /2 accords rapportent 1 200 \$ par an\./);
    assert.match(a.action, /Vendez votre surplus d'électricité aux villes voisines\./);
    assert.match(get(d({ count: 1, income: 600 }), "finances").diagnosis, /1 accord rapporte 600 \$ par an/);
  });
  test("surplus threshold, rule off, missing data", () => {
    assert.doesNotMatch(get(d({ surplus: M.DEAL_SURPLUS_MIN - 1 }), "finances").action, /Vendez/);
    assert.match(get(d({ surplus: M.DEAL_SURPLUS_MIN }), "finances").action, /Vendez/);
    assert.doesNotMatch(get(d({ count: 2, income: 5, surplus: 9 }, false), "finances").action, /Vendez/);
    assert.doesNotMatch(get(d({ count: 2, income: 5, surplus: 9 }, false), "finances").diagnosis, /accord/);
    assert.equal(get(d(null), "finances").severity, "ok");
    assert.equal(get(d({ count: 0, income: 0 }), "finances").diagnosis.includes("accord"), false);
  });
});

describe("total and deterministic with the new fields", () => {
  test("garbage in the new blocks never throws", () => {
    for (const bad of [null, 5, "x", [], { dry: NaN }, { lines: {} }]) {
      const s = { ...calm(), rules: { water: true, transit: true, deals: true }, water: bad, transit: bad, deals: bad, ordinances: bad };
      assert.ok(Array.isArray(M.advise(s)));
    }
    const s = { ...calm(), rules: { water: true }, water: { pumps: 1, pipes: 2, watered: 1, dry: 3 }, ordinances: ORD() };
    assert.deepEqual(M.advise(s), M.advise(structuredClone(s)));
  });
  test("ordering is kept: urgent first, then Finances, Sécurité, Urbanisme, Environnement", () => {
    const s = { ...calm(), rules: { water: true }, water: { pumps: 0, pipes: 0, watered: 0, dry: 9 } };
    assert.deepEqual(M.advise(s).map((a) => a.id), ["planning", "finances", "security", "environment"]);
  });
});

// A fake engine with the extended APIs, each optional.
function fakeCity(extra = {}) {
  let active = [false, true, false];
  return {
    year: () => 1900, month: () => 3, funds: () => 5000,
    set_ordinance: () => true, ordinance_count: () => 3, ordinance_key: (i) => ORD()[i].key,
    ordinance_info: (i) => Int32Array.of(ORD()[i].cost, ORD()[i].crime, ORD()[i].pollution, 0, 0, 0, 0),
    ordinance_active: (i) => active[i],
    setActive: (i, on) => { active[i] = on; },
    ...extra,
  };
}

describe("snapshot reader and cheap key", () => {
  test("without the rule APIs nothing extended is read (old engine)", () => {
    const s = readSnapshot({ funds: () => 10 });
    assert.deepEqual(s, { funds: 10 });
    assert.equal(cheapKey({}), "{}");
  });
  test("rules off: no water or transit stats are read even when the methods exist", () => {
    const calls = [];
    const city = fakeCity({
      water_rules: () => false, water_stats: () => { calls.push("w"); return Int32Array.of(1, 2, 3, 4); },
      transit_rules: () => false, transit_stats: () => { calls.push("t"); return Int32Array.of(1, 2, 3, 4); },
    });
    const s = readSnapshot(city);
    cheapKey(city);
    assert.deepEqual(s.rules, { water: false, transit: false });
    assert.equal(s.water, undefined);
    assert.equal(s.transit, undefined);
    assert.deepEqual(calls, []);
  });
  test("rules on: stats, ordinances and deals reach the snapshot", () => {
    const city = fakeCity({
      water_rules: () => true, water_stats: () => Int32Array.of(2, 9, 5, 7),
      transit_rules: () => true, transit_stats: () => Int32Array.of(3, 8, 1, 60),
      // active_deals: records of 7 [neighbour, resource, amount, price, income, covered, cancel_penalty]
      deals_rules: () => true, active_deals: () => Int32Array.of(0, 0, 5, 100, 500, 1, 250, 1, 0, 5, 50, 250, 1, 125, 2, 1, 1, 1, 0, 1, 0),
      surplus: () => Int32Array.of(12, 0),
    });
    const s = readSnapshot(city);
    assert.deepEqual(s.water, { pumps: 2, pipes: 9, watered: 5, dry: 7 });
    assert.deepEqual(s.transit, { stations: 3, tunnels: 8, lines: 1, served: 60 });
    assert.deepEqual(s.deals, { count: 3, income: 750, surplus: 12 });
    assert.deepEqual(s.ordinances.map((o) => [o.key, o.active, o.cost]), [
      ["community_policing", false, 200], ["pollution_control", true, 300], ["recycling", false, 100]]);
    assert.equal(s.ordinances[0].label, "Police de proximité");
  });
  test("surplus is [electricity, water]; malformed answers and an absent API are left out", () => {
    const base = { deals_rules: () => true, active_deals: () => new Int32Array(0) };
    assert.equal(readSnapshot(fakeCity({ ...base, surplus: () => Int32Array.of(7, 1) })).deals.surplus, 7);
    assert.equal(readSnapshot(fakeCity({ ...base, surplus: () => 4 })).deals.surplus, undefined);
    assert.equal(readSnapshot(fakeCity({ ...base, surplus: () => "x" })).deals.surplus, undefined);
    assert.equal(readSnapshot(fakeCity({ deals_rules: () => true, active_deals: () => Int32Array.of(1, 2, 3) })).deals.count, undefined,
      "a record list that is not a whole number of records is left out");
    assert.deepEqual(readSnapshot(fakeCity({ deals_rules: () => true })).deals, {});
  });
  test("the cheap key changes with a rule switch, an ordinance, and the counters", () => {
    let water = false; let stats = [0, 0, 0, 0];
    const city = fakeCity({ water_rules: () => water, water_stats: () => Int32Array.from(stats) });
    const k0 = cheapKey(city);
    assert.equal(cheapKey(city), k0, "stable when nothing changes");
    water = true;
    const k1 = cheapKey(city);
    assert.notEqual(k1, k0);
    stats = [1, 0, 0, 0];
    const k2 = cheapKey(city);
    assert.notEqual(k2, k1);
    city.setActive(0, true);
    assert.notEqual(cheapKey(city), k2);
  });
});

describe("traffic of the agents rule", () => {
  const ag = (saturated, meanTicks = 0, cars = 0, transit = false) => ({
    ...calm(), rules: { agents: true, transit },
    agents: { cars, finished: 3, meanTicks, saturated, motorised: 0 },
  });
  const trafficOf = (s) => get(s, "planning");
  test("thresholds on saturated tiles: 0 is fine, 1 attention, 9 attention, 10 urgent", () => {
    assert.equal(trafficOf(ag(0)).severity, "ok");
    assert.equal(trafficOf(ag(1)).severity, "attention");
    assert.equal(trafficOf(ag(9)).severity, "attention");
    assert.equal(trafficOf(ag(10)).severity, "urgent");
    assert.equal(M.TRAFFIC_SAT_ATTENTION, 1);
    assert.equal(M.TRAFFIC_SAT_URGENT, 10);
  });
  test("wording counts the saturated tiles", () => {
    assert.match(trafficOf(ag(1)).diagnosis, /Les routes sont saturées sur 1 case\./);
    assert.match(trafficOf(ag(10)).diagnosis, /Les routes sont saturées sur 10 cases\./);
  });
  test("a long mean trip is attention even without saturation", () => {
    assert.equal(M.TRAFFIC_TRIP_LONG, 120);
    const long = trafficOf(ag(0, M.TRAFFIC_TRIP_LONG));
    assert.equal(long.severity, "attention");
    assert.match(long.diagnosis, /Les trajets durent en moyenne 120 pas\./);
    assert.equal(trafficOf(ag(0, M.TRAFFIC_TRIP_LONG - 1)).severity, "ok");
  });
  test("remedy: a metro line when the metro rule is on, else parallel roads or another access", () => {
    assert.match(trafficOf(ag(1, 0, 0, true)).action, /Ajoutez une ligne de métro pour désengorger les routes\./);
    const roads = trafficOf(ag(1, 0, 0, false)).action;
    assert.match(roads, /routes parallèles ou un autre accès vers les zones d'emploi/);
    assert.doesNotMatch(roads, /métro/);
  });
  test("the OK fallback cites the cars on the road", () => {
    const one = trafficOf(ag(0, 0, 1));
    assert.equal(one.severity, "ok");
    assert.match(one.diagnosis, /, 1 voiture circule sur les routes\.$/);
    assert.match(trafficOf(ag(0, 0, 5)).diagnosis, /, 5 voitures circulent sur les routes\.$/);
    assert.doesNotMatch(trafficOf(ag(0, 0, 0)).diagnosis, /voiture/);
  });
  test("rule off: no traffic line and agent_stats is never called", () => {
    const calls = [];
    const city = fakeCity({
      agent_rules: () => false,
      agent_stats: () => { calls.push("a"); return Int32Array.of(9, 9, 999, 99, 9); },
    });
    const s = readSnapshot(city);
    cheapKey(city);
    assert.equal(s.agents, undefined);
    assert.deepEqual(calls, []);
    const s2 = { ...ag(50, 500, 9), rules: { agents: false } };
    assert.equal(trafficOf(s2).severity, "ok");
    assert.doesNotMatch(trafficOf(s2).diagnosis, /saturées|trajets/);
  });
  test("API missing: nothing is read and no traffic line", () => {
    assert.equal(readSnapshot(fakeCity({ agent_rules: () => true })).agents, undefined);
    assert.equal(readSnapshot(fakeCity({ agent_stats: () => Int32Array.of(1, 1, 1, 50, 1) })).agents, undefined);
    assert.equal(readSnapshot(fakeCity({ agent_rules: () => true, agent_stats: () => Int32Array.of(1, 1) })).agents, undefined,
      "a short answer is left out");
    assert.doesNotMatch(trafficOf({ ...calm(), rules: { agents: true } }).diagnosis, /saturées|trajets|voiture/);
    assert.equal(trafficOf({ ...calm(), rules: { agents: true }, agents: { saturated: "x" } }).severity, "ok");
  });
  test("the snapshot reader fills agents in the engine order", () => {
    const city = fakeCity({ agent_rules: () => true, agent_stats: () => Int32Array.of(4, 10, 150, 2, 30) });
    assert.deepEqual(readSnapshot(city).agents, { cars: 4, finished: 10, meanTicks: 150, saturated: 2, motorised: 30 });
  });
  test("cheapKey changes with the switch and with the saturated count", () => {
    let on = false; let sat = 0;
    const city = fakeCity({ agent_rules: () => on, agent_stats: () => Int32Array.of(0, 0, 0, sat, 0) });
    const k0 = cheapKey(city);
    assert.equal(cheapKey(city), k0, "stable when nothing changes");
    sat = 3;
    assert.equal(cheapKey(city), k0, "saturation is not read while the rule is off");
    on = true;
    const k1 = cheapKey(city);
    assert.notEqual(k1, k0);
    sat = 4;
    const k2 = cheapKey(city);
    assert.notEqual(k2, k1);
    on = false;
    assert.notEqual(cheapKey(city), k2);
  });
  test("garbage in agents never throws", () => {
    for (const bad of [null, 5, "x", [], { saturated: NaN }, { cars: {}, saturated: "x" }]) {
      const s = { ...calm(), rules: { agents: true }, agents: bad };
      assert.ok(Array.isArray(M.advise(s)));
    }
  });
});
