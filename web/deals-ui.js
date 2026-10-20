// Page feature: deals with the neighbouring cities (docs/game-design-v02b.md), the panel
// #deals-panel: the rule switch, the surplus, the offers to sign and the signed deals to cancel.
// Presentation only (ARCHITECTURE.md rule 5): the engine owns the rules, the offers and the deals;
// the page keeps no copy it writes back. After a load or a new city update() reads the engine again,
// so the page never pushes its state into a fresh city. The French texts are in deals-model.js.
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
// api = { city(): the engine, $(id): getElementById, redraw(), isReady(), describe() }.
import {
  CODE, brokenDeals, brokenText, cancelHelp, dealKey, decodeDeals, decodeOffers, incomeText, reasonText,
  snapshotKey, stateText, supports, surplusText, termsText, titleText, totalText,
} from "./deals-model.js";

/** update() reads the offers and the surplus (a scan of the map) once in this many calls. */
export const READ_EVERY = 10;

let panel = null;
let ui = null; // the built elements, once the engine has the API
let lastKey = null;
let sinceRead = 0;
let known = []; // the deals of the last reading, to notice the ones a neighbour broke
let cityId = null; // which city `known` belongs to
let cancelled = new Set(); // dealKey of the deals the player cancelled since the last reading

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function notify(text, bad = false) {
  setText(ui.notice, text);
  ui.notice.setAttribute("class", bad ? "deal-notice deal-bad" : "deal-notice");
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "deals-rules" });
  box.onchange = () => {
    // The engine decides; the next update() shows its answer.
    api.city().set_deals_rules(box.checked);
    cancelled = new Set();
    known = [];
    lastKey = null;
    sinceRead = READ_EVERY;
    api.redraw();
  };
  const label = el("label", { for: "deals-rules", class: "deal-switch" });
  label.append(box, el("span", {}, "Accords avec les voisins"));
  const details = el("div", { class: "deal-details" });
  const surplus = el("p", { id: "deal-surplus", class: "deal-surplus" });
  const offers = el("ul", { id: "deal-offers", class: "deal-list" });
  const deals = el("ul", { id: "deal-active", class: "deal-list" });
  const total = el("p", { id: "deal-total", class: "deal-total" });
  details.append(
    surplus,
    el("h3", { id: "deal-offers-heading" }, "Offres"),
    offers,
    el("h3", { id: "deal-active-heading" }, "Accords en cours"),
    deals,
    total,
  );
  offers.setAttribute("aria-labelledby", "deal-offers-heading");
  deals.setAttribute("aria-labelledby", "deal-active-heading");
  const note = el(
    "p",
    { class: "deal-note" },
    "Vendez l'électricité et l'eau en trop aux villes voisines. La recette est versée à chaque collecte des impôts, une fois par an ; si la ville ne peut plus fournir, l'accord est rompu et une pénalité est payée.",
  );
  const notice = el("p", { id: "deal-notice", class: "deal-notice", role: "status", "aria-live": "polite" });
  panel.replaceChildren(el("h2", { id: "deal-heading" }, "Accords avec les voisins"), label, note, details, notice);
  panel.setAttribute("aria-labelledby", "deal-heading");
  return { box, details, surplus, offers, deals, total, notice };
}

function offerRow(offer, api) {
  const li = el("li", { class: "deal-row", "data-offer": String(offer.index) });
  const sign = el("button", { type: "button", class: "deal-sign" }, "Signer");
  const reason = offer.status === CODE.DONE ? "" : reasonText(offer.status);
  if (reason) {
    sign.disabled = true;
    sign.setAttribute("title", reason);
  }
  sign.onclick = () => {
    const code = api.city().accept_deal(offer.index);
    notify(code === CODE.DONE ? "Accord signé." : reasonText(code) || "Accord refusé.", code !== CODE.DONE);
    lastKey = null;
    sinceRead = READ_EVERY;
    api.redraw();
  };
  li.append(
    el("span", { class: "deal-title" }, titleText(offer)),
    el("span", { class: "deal-terms" }, `${termsText(offer)}. ${incomeText(offer.income, offer.resource)}`),
    el("span", { class: "deal-state" }, reason),
    sign,
  );
  return li;
}

function dealRow(deal, api) {
  const li = el("li", { class: deal.covered ? "deal-row" : "deal-row deal-threatened", "data-deal": String(deal.index) });
  const cancel = el("button", { type: "button", class: "deal-cancel", title: cancelHelp(deal) }, "Résilier");
  cancel.onclick = () => {
    const key = dealKey(deal);
    const code = api.city().cancel_deal(deal.index);
    if (code === CODE.DONE) {
      cancelled.add(key);
      notify("Accord résilié.");
    } else {
      notify(reasonText(code) || "Résiliation refusée.", true);
    }
    lastKey = null;
    sinceRead = READ_EVERY;
    api.redraw();
  };
  li.append(
    el("span", { class: "deal-title" }, titleText(deal)),
    el("span", { class: "deal-terms" }, `${termsText(deal)}. ${incomeText(deal.income, deal.resource)}`),
    el("span", { class: "deal-state" }, stateText(deal)),
    cancel,
  );
  return li;
}

export function setup(api) {
  panel = api.$("deals-panel");
  ui = null;
  lastKey = null;
  sinceRead = READ_EVERY;
  known = [];
  cityId = null;
  cancelled = new Set();
  if (!panel) return;
  panel.hidden = true; // shown by the first update() that finds the API
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  if (!supports(city)) {
    panel.hidden = true;
    return;
  }
  if (!ui) ui = build(api);
  const rulesOn = Boolean(city.deals_rules());
  if (ui.box.checked !== rulesOn) {
    ui.box.checked = rulesOn;
    sinceRead = READ_EVERY; // a load or a new city changed the rule: read everything now
  }
  panel.hidden = false;
  if (++sinceRead < READ_EVERY && lastKey !== null) return;
  sinceRead = 0;
  const offers = rulesOn ? decodeOffers(city.deal_offers()) : [];
  const deals = rulesOn ? decodeDeals(city.active_deals()) : [];
  const surplus = rulesOn ? Array.from(city.surplus()) : [0, 0];

  // A deal that vanished without the player cancelling it was broken by the city's shortfall.
  const id = JSON.stringify(api.describe?.() ?? null);
  if (id !== cityId) {
    cityId = id; // another city: its deals are not "broken" ones
  } else {
    for (const d of brokenDeals(known, deals, cancelled)) notify(brokenText(d), true);
  }
  known = deals;
  cancelled = new Set();

  const key = snapshotKey(rulesOn, surplus, offers, deals);
  if (key === lastKey) return; // nothing the panel shows has changed
  lastKey = key;
  ui.details.hidden = !rulesOn;
  setText(ui.surplus, surplusText(surplus));
  ui.offers.replaceChildren(...offers.map((o) => offerRow(o, api)));
  ui.deals.replaceChildren(...deals.map((d) => dealRow(d, api)));
  setText(ui.total, totalText(deals));
}
