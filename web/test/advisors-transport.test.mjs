// Transport in the advisors (docs/game-design-v05.md): the riders waiting for a bus or a taxi are an
// Urbanisme finding from TRANSIT_WAIT_ATTENTION and TRANSIT_WAIT_URGENT; the engine's transport_stats is
// read only with the agents rule; the cheap key follows the waiting count. Pure: the engine is a fake.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../advisors-model.js";
import { readSnapshot, cheapKey } from "../advisors.js";
import { MockCity } from "./mock-engine.mjs";

const ACTION = "Ajoutez un dépôt de bus ou des arrêts près des zones d'emploi.";
const plain = (t) => t.replace(/[\s  ]/g, " ");

// A calm city with the agents rule on and `waiting` riders at the stops.
const withWaiting = (waiting, agents = true) => ({
  funds: 50000, cashFlow: 500, taxRate: 7, funding: { road: 100, fire: 100, police: 100 },
  problems: [], demand: { res: 100, com: 100, ind: 100 }, population: 1000, populationDelta: 20,
  moneyHistory: [128, 128, 130], pollutionHistory: [10, 10, 10],
  rules: { agents }, transport: { waiting },
});
const planning = (s) => M.advise(s).find((a) => a.id === "planning");
const transitFinding = (s) => {
  const a = planning(s);
  return a && a.action === ACTION ? a : null;
};

describe("transport thresholds", () => {
  test("the constants are 20 for attention and 80 for urgent", () => {
    assert.equal(M.TRANSIT_WAIT_ATTENTION, 20);
    assert.equal(M.TRANSIT_WAIT_URGENT, 80);
  });

  test("below 20 riders no finding; 20 is attention; 79 attention; 80 urgent", () => {
    assert.equal(transitFinding(withWaiting(19)), null);
    assert.equal(transitFinding(withWaiting(0)), null);
    assert.equal(transitFinding(withWaiting(20)).severity, "attention");
    assert.equal(transitFinding(withWaiting(79)).severity, "attention");
    assert.equal(transitFinding(withWaiting(80)).severity, "urgent");
    assert.equal(transitFinding(withWaiting(500)).severity, "urgent");
  });

  test("the finding is worded with the count, singular and plural, and the French action", () => {
    assert.equal(plain(transitFinding(withWaiting(25)).diagnosis), "25 voyageurs attendent un bus ou un taxi.");
    assert.equal(plain(transitFinding(withWaiting(1000)).diagnosis), "1 000 voyageurs attendent un bus ou un taxi.");
    assert.equal(transitFinding(withWaiting(25)).action, ACTION);
  });

  test("a finding of the waiting riders sits in Urbanisme, and its severity drives the advisor", () => {
    const a = planning(withWaiting(25));
    assert.equal(a.id, "planning");
    assert.equal(a.severity, "attention");
    assert.equal(planning(withWaiting(90)).severity, "urgent");
  });

  test("the waiting riders alone keep Urbanisme visible", () => {
    const only = { rules: { agents: true }, transport: { waiting: 30 } };
    assert.equal(planning(only).severity, "attention");
  });

  test("the classic Urbanisme advice is unchanged below the threshold", () => {
    assert.equal(planning(withWaiting(19)).severity, "ok");
    assert.equal(planning(withWaiting(19)).diagnosis, "La croissance suit son cours.");
  });
});

describe("transport is read only with the agents rule", () => {
  test("rule off: the transport block is ignored, even when present", () => {
    assert.equal(transitFinding(withWaiting(90, false)), null);
    assert.equal(planning(withWaiting(90, false)).severity, "ok");
  });

  test("garbage in the transport block never throws", () => {
    for (const bad of [null, 5, "x", [], { waiting: NaN }, { waiting: {} }]) {
      const s = { ...withWaiting(0), transport: bad };
      assert.ok(Array.isArray(M.advise(s)));
      assert.equal(transitFinding(s), null);
    }
  });
});

// A fake engine: the agents switch, the traffic and transport answers, and a count of the calls to each.
function fakeCity({ agents = false, transport = [2, 1, 25, 0, 0, 0], short = false } = {}) {
  const calls = [];
  const city = {
    agents,
    agent_rules: () => (calls.push("agent_rules"), city.agents),
    agent_stats: () => (calls.push("agent_stats"), Int32Array.of(0, 0, 0, 0, 0)),
    transport_stats: () => (calls.push("transport_stats"), short ? Int32Array.of(2, 1) : Int32Array.from(transport)),
  };
  return { city, calls };
}

describe("snapshot reader and cheap key for the transport", () => {
  test("rule on: transport_stats is read and its waiting count (index 2) reaches the snapshot", () => {
    const { city, calls } = fakeCity({ agents: true, transport: [2, 1, 33, 9, 8, 7] });
    assert.deepEqual(readSnapshot(city).transport, { waiting: 33 });
    assert.ok(calls.includes("transport_stats"));
  });

  test("rule off: transport_stats is never called and nothing is in the snapshot", () => {
    const { city, calls } = fakeCity({ agents: false });
    assert.equal(readSnapshot(city).transport, undefined);
    cheapKey(city);
    assert.equal(calls.includes("transport_stats"), false);
  });

  test("a short answer or no method leaves the transport out", () => {
    assert.equal(readSnapshot(fakeCity({ agents: true, short: true }).city).transport, undefined);
    const { city } = fakeCity({ agents: true });
    delete city.transport_stats;
    assert.equal(readSnapshot(city).transport, undefined);
  });

  test("cheapKey changes when the waiting count changes, with the rule on", () => {
    const a = fakeCity({ agents: true, transport: [2, 1, 25, 0, 0, 0] });
    const b = fakeCity({ agents: true, transport: [2, 1, 26, 0, 0, 0] });
    assert.notEqual(cheapKey(a.city), cheapKey(b.city));
    assert.equal(cheapKey(a.city), cheapKey(a.city), "stable when nothing changes");
  });

  test("cheapKey ignores the transport with the rule off", () => {
    const a = fakeCity({ agents: false, transport: [0, 0, 25, 0, 0, 0] });
    const b = fakeCity({ agents: false, transport: [0, 0, 60, 0, 0, 0] });
    assert.equal(cheapKey(a.city), cheapKey(b.city));
  });
});

describe("the mock engine feeds the advisor", () => {
  test("agents on in the mock: 25 riders waiting are read and worded (the jam finding is quiet here)", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    const s = readSnapshot(city);
    assert.deepEqual(s.transport, { waiting: 25 });
    // the mock's two saturated tiles would be the worst finding (earliest among equals); quiet them here
    const quiet = { ...s, agents: { ...s.agents, saturated: 0, meanTicks: 0 } };
    assert.equal(transitFinding(quiet).severity, "attention");
    assert.equal(plain(transitFinding(quiet).diagnosis), "25 voyageurs attendent un bus ou un taxi.");
  });

  test("agents off in the mock: no transport reading and no transport finding", () => {
    const s = readSnapshot(new MockCity(1));
    assert.equal(s.transport, undefined);
    assert.equal(transitFinding(s), null);
  });
});
