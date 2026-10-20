// The waste resource of the deals (web/deals-model.js, resource 2 «Déchets»): the name, the export terms and
// the export price read as a cost. The other resources keep their texts (deals-model.test.mjs).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RESOURCES, WASTE_RESOURCE, incomeText, termsText, titleText } from "../deals-model.js";

const norm = (s) => s.replace(/[  ]/g, " ");

describe("the waste resource", () => {
  test("resource 2 is named Déchets, the others are unchanged", () => {
    assert.equal(WASTE_RESOURCE, 2);
    assert.equal(RESOURCES.length, 3);
    assert.deepEqual(RESOURCES[2], { label: "Déchets", noun: "de déchets" });
    assert.equal(RESOURCES[0].label, "Électricité");
    assert.equal(RESOURCES[1].label, "Eau");
  });

  test("the title of an export offer", () => {
    assert.equal(titleText({ neighbour: 1, resource: 2 }), "Port-Aurore (est) · Déchets");
  });

  test("an export's terms say the city pays the price, the price is shown without its sign", () => {
    const offer = { neighbour: 0, resource: 2, amount: 100, price: -5 };
    assert.equal(norm(termsText(offer)), "100 unités de déchets par an : la ville paie 5 $ l'unité");
  });

  test("an export's income is a cost, shown positive", () => {
    assert.equal(norm(incomeText(-500, 2)), "Coût : 500 $ par an");
    assert.equal(norm(incomeText(-1200, WASTE_RESOURCE)), "Coût : 1 200 $ par an");
  });

  test("the other resources keep «Recette» and the price with its sign", () => {
    assert.equal(norm(incomeText(500, 0)), "Recette : 500 $ par an");
    assert.equal(norm(incomeText(500)), "Recette : 500 $ par an");
    assert.equal(norm(termsText({ resource: 1, amount: 200, price: 3 })), "200 unités d'eau par an à 3 $ l'unité");
  });
});
