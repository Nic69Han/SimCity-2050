// Page feature: «Récompenses et accords» (docs/game-design-v12.md), the panel #rewards-panel: the rule switch, the list of
// the rewards with their status, the list of the special offers with «Accepter» / «Refuser» while one is proposed, and
// the statistics. Presentation only (ARCHITECTURE.md rule 4): the engine owns the rule, the unlocks, the offers and the
// answers; update() reads them again after every change. The French texts and the decoding are in rewards-model.js
// (pure, tested). setup(api) runs once after the engine exists; update(api) runs after every redraw.
import {
  supports, readRulesOn, decodeRewards, decodeOffers, decodeRewardStats, rewardLine, offerText, offerAnswerable,
  statsLines, noteText, RULE_LABEL, ACCEPT_TEXT, REFUSE_TEXT,
} from "./rewards-model.js";
import { nameOf } from "./structures-model.js";

let panel = null;
let ui = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// The rule switch: the engine flag, then the change event on the relief checkbox, which relays the flags to the tool
// palette (as energy-ui.js does), so the buildings follow the switch at once.
function onRuleChange(api, box) {
  api.city().set_reward_rules(box.checked);
  const relief = api.$("relief");
  if (relief) relief.dispatchEvent(new Event("change"));
  else api.redraw();
}

// An answer button: the engine answers, then the whole page redraws (the list is rebuilt from the engine).
function answerButton(api, genre, accept, label, cls) {
  const button = el("button", { type: "button", class: cls, "aria-label": `${label} : ${nameOf(genre)}` }, label);
  button.onclick = () => {
    api.city().answer_offer(genre, accept);
    api.redraw();
  };
  return button;
}

// One offer as a list item: its text, and the two buttons while it is proposed.
function offerItem(api, o) {
  const li = el("li", { class: "offer" }, offerText(o));
  if (offerAnswerable(o)) {
    const buttons = el("span", { class: "offer-buttons" });
    buttons.append(
      answerButton(api, o.genre, true, ACCEPT_TEXT, "offer-accept"),
      answerButton(api, o.genre, false, REFUSE_TEXT, "offer-refuse"),
    );
    li.append(buttons);
  }
  return li;
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "rewards-rules" });
  box.onchange = () => onRuleChange(api, box);
  const label = el("label", { for: "rewards-rules", class: "rewards-switch" });
  label.append(box, el("span", {}, RULE_LABEL));
  const note = el("p", { id: "rewards-note", class: "rewards-note" });
  const rewards = el("ul", { id: "rewards-list", class: "rewards-list", "aria-label": "Récompenses" });
  const offers = el("ul", { id: "offers-list", class: "offers-list", "aria-label": "Accords spéciaux" });
  const stats = el("ul", { id: "rewards-stats", class: "rewards-stats" });
  panel.replaceChildren(
    el("h2", { id: "rewards-heading" }, "Récompenses et accords"),
    label, note,
    el("h3", {}, "Récompenses"), rewards,
    el("h3", {}, "Accords spéciaux"), offers,
    stats,
  );
  panel.setAttribute("aria-labelledby", "rewards-heading");
  return { box, note, rewards, offers, stats, keys: {} };
}

// Rebuilds a list only when its data changed (the lists are not rebuilt on every frame). `render` gives the items.
function setList(list, keys, name, data, render) {
  const key = JSON.stringify(data);
  if (keys[name] === key) return;
  keys[name] = key;
  list.replaceChildren(...render(data));
}

const rewardItems = (rewards) => rewards.map((r) => el("li", {}, rewardLine(r)));

export function setup(api) {
  panel = api.$("rewards-panel");
  ui = null;
  if (panel) panel.hidden = true;
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  if (!supports(city)) {
    panel.hidden = true;
    return;
  }
  if (!ui) ui = build(api);
  const on = readRulesOn(city);
  if (ui.box.checked !== on) ui.box.checked = on;
  setList(ui.rewards, ui.keys, "rewards", decodeRewards(city.rewards()), rewardItems);
  setList(ui.offers, ui.keys, "offers", decodeOffers(city.special_offers()), (list) => list.map((o) => offerItem(api, o)));
  setList(ui.stats, ui.keys, "stats", decodeRewardStats(city.reward_stats()), (s) => statsLines(s).map((t) => el("li", {}, t)));
  const note = noteText(on);
  if (ui.note.textContent !== note) ui.note.textContent = note;
  panel.hidden = false;
}
