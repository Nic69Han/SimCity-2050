// Tests of the pure deals model (web/deals-model.js): decoding the engine's flat records, the
// French texts, the broken-deal detection and the snapshot key.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CODE, DEAL_LEN, NEIGHBOURS, OFFER_LEN, REQUIRED, brokenDeals, brokenText, cancelHelp, dealKey, decodeDeals,
  decodeOffers, formatUnits, incomeText, neighbourName, reasonText, snapshotKey, stateText, supports,
  surplusText, termsText, titleText, totalText,
} from "../deals-model.js";

const norm = (s) => s.replace(/[\u00a0\u202f]/g, " ");

describe("deals model", () => {
  test("decodes offer records and ignores a truncated last one", () => {
    const flat = Int32Array.from([0, 0, 100, 5, 500, 1, 3, 1, 32, 55, 1760, -3, 9, 9, 9]);
    const offers = decodeOffers(flat);
    assert.equal(OFFER_LEN, 6);
    assert.equal(offers.length, 2);
    assert.deepEqual(offers[0], { index: 0, neighbour: 0, resource: 0, amount: 100, price: 5, income: 500, status: 1 });
    assert.deepEqual(offers[1], { index: 1, neighbour: 3, resource: 1, amount: 32, price: 55, income: 1760, status: -3 });
    assert.deepEqual(decodeOffers(undefined), []);
    assert.deepEqual(decodeOffers(new Int32Array()), []);
  });

  test("decodes deal records", () => {
    const flat = [2, 0, 200, 6, 1200, 1, 600, 1, 1, 4, 60, 240, 0, 120];
    const deals = decodeDeals(flat);
    assert.equal(DEAL_LEN, 7);
    assert.equal(deals.length, 2);
    assert.deepEqual(deals[0], { index: 0, neighbour: 2, resource: 0, amount: 200, price: 6, income: 1200, covered: true, penalty: 600 });
    assert.equal(deals[1].covered, false);
    assert.equal(deals[1].index, 1);
  });

  test("names the four neighbours in the engine's order and tolerates an unknown index", () => {
    assert.deepEqual([...NEIGHBOURS], ["Valmont (nord)", "Port-Aurore (est)", "Saint-Élan (sud)", "Hautebrise (ouest)"]);
    assert.equal(neighbourName(0), "Valmont (nord)");
    assert.equal(neighbourName(9), "Ville voisine 9");
  });

  test("writes the terms, titles and incomes in French", () => {
    const offer = { neighbour: 0, resource: 0, amount: 100, price: 5, income: 500 };
    assert.equal(titleText(offer), "Valmont (nord) · Électricité");
    assert.equal(norm(termsText(offer)), "100 unités d'électricité par an à 5 $ l'unité");
    assert.equal(norm(incomeText(500)), "Recette : 500 $ par an");
    const water = { neighbour: 3, resource: 1, amount: 1200, price: 55 };
    assert.equal(titleText(water), "Hautebrise (ouest) · Eau");
    assert.equal(norm(termsText(water)), "1 200 unités d'eau par an à 55 $ l'unité");
  });

  test("writes the surplus with a true minus sign", () => {
    assert.equal(formatUnits(-20), "−20");
    assert.equal(norm(surplusText([600, -20])), "Surplus disponible : électricité 600 unités, eau −20 unités.");
    assert.equal(norm(surplusText(undefined)), "Surplus disponible : électricité 0 unités, eau 0 unités.");
  });

  test("totals the incomes", () => {
    assert.equal(totalText([]), "Aucun accord en cours.");
    const deals = [{ income: 500 }, { income: 1200 }];
    assert.equal(norm(totalText(deals)), "Recettes des accords : 1 700 $ par an (2 en cours).");
  });

  test("states: covered or threatened, and the refusal reasons", () => {
    assert.equal(stateText({ covered: true }), "Honoré");
    assert.match(stateText({ covered: false }), /^Menacé/);
    assert.equal(reasonText(CODE.NO_SURPLUS), "Surplus insuffisant pour honorer cet accord.");
    assert.match(reasonText(CODE.ALREADY), /existe déjà/);
    assert.equal(reasonText(CODE.DONE), "");
    assert.equal(reasonText(77), "");
    assert.equal(norm(cancelHelp({ penalty: 250 })), "Résilier coûte une pénalité de 250 $.");
  });

  test("detects the deals a neighbour broke, not the ones the player cancelled", () => {
    const a = { neighbour: 0, resource: 0 };
    const b = { neighbour: 2, resource: 1 };
    assert.equal(dealKey(b), "2:1");
    assert.deepEqual(brokenDeals([a, b], [a]), [b]);
    assert.deepEqual(brokenDeals([a, b], [a], new Set(["2:1"])), []);
    assert.deepEqual(brokenDeals([a], [a, b]), []);
    assert.deepEqual(brokenDeals([], []), []);
    assert.equal(brokenText({ ...b, resource: 1 }), "Accord rompu : Saint-Élan (sud) · Eau. Une pénalité a été payée.");
  });

  test("the snapshot key changes exactly with what the panel shows", () => {
    const offers = decodeOffers([0, 0, 100, 5, 500, 1]);
    const deals = decodeDeals([0, 0, 100, 5, 500, 1, 250]);
    const k = snapshotKey(true, [600, 0], offers, deals);
    assert.equal(k, snapshotKey(true, Int32Array.from([600, 0]), decodeOffers([0, 0, 100, 5, 500, 1]), decodeDeals([0, 0, 100, 5, 500, 1, 250])));
    assert.notEqual(k, snapshotKey(false, [600, 0], offers, deals));
    assert.notEqual(k, snapshotKey(true, [599, 0], offers, deals));
    assert.notEqual(k, snapshotKey(true, [600, 0], decodeOffers([0, 0, 100, 5, 500, -3]), deals));
    assert.notEqual(k, snapshotKey(true, [600, 0], offers, decodeDeals([0, 0, 100, 5, 500, 0, 250])));
  });

  test("supports() needs the whole API", () => {
    const full = Object.fromEntries(REQUIRED.map((m) => [m, () => {}]));
    assert.equal(supports(full), true);
    for (const m of REQUIRED) {
      const half = { ...full };
      delete half[m];
      assert.equal(supports(half), false, m);
    }
    assert.equal(supports(undefined), false);
    assert.equal(supports({}), false);
  });
});
