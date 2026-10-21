// The electricity purchase of the deals (web/deals-model.js, resource 3 «Achat d'électricité»): the name, the terms and
// the income read as the city pays, like the waste export. The other resources keep their texts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { POWER_BUY_RESOURCE, RESOURCES, WASTE_RESOURCE, incomeText, isPaid, termsText, titleText } from "../deals-model.js";

const norm = (s) => s.replace(/[  ]/g, " ");

describe("the electricity purchase", () => {
  test("resource 3 is named Achat d'électricité", () => {
    assert.equal(POWER_BUY_RESOURCE, 3);
    assert.deepEqual(RESOURCES[3], { label: "Achat d'électricité", noun: "d'électricité" });
    assert.equal(titleText({ neighbour: 2, resource: 3 }), "Saint-Élan (sud) · Achat d'électricité");
  });

  test("the city pays for the purchase and for the waste export, not for the sale", () => {
    assert.equal(isPaid(POWER_BUY_RESOURCE), true);
    assert.equal(isPaid(WASTE_RESOURCE), true);
    assert.equal(isPaid(0), false);
    assert.equal(isPaid(1), false);
    assert.equal(isPaid(undefined), false);
  });

  test("a purchase's terms say the city pays the price, shown without its sign", () => {
    const offer = { neighbour: 3, resource: 3, amount: 100, price: -5 };
    assert.equal(norm(termsText(offer)), "100 unités d'électricité par an : la ville paie 5 $ l'unité");
  });

  test("a purchase's income is a cost, shown positive", () => {
    assert.equal(norm(incomeText(-500, 3)), "Coût : 500 $ par an");
    assert.equal(norm(incomeText(-1200, POWER_BUY_RESOURCE)), "Coût : 1 200 $ par an");
  });

  test("the electricity sale keeps «Recette» and its price with the sign", () => {
    assert.equal(norm(termsText({ resource: 0, amount: 100, price: 5 })), "100 unités d'électricité par an à 5 $ l'unité");
    assert.equal(norm(incomeText(500, 0)), "Recette : 500 $ par an");
  });
});
