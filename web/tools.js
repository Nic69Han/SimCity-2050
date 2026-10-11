// Building tools, presentation side (ARCHITECTURE.md rule 5): the engine decides costs,
// validity and effects; this module names, groups, displays and forwards.
// Everything above setupTools() is pure and importable without a DOM. setupTools() is
// the only function that touches the page, and it is called at runtime only.
import { ToolStroke, attachPointer, tileAt } from "./input.js";
import { formatZoneStatus } from "./query.js";

export const TILE_PX = 6; // canvas pixels per tile (same as main.js)

// ToolResult codes returned by tool_down (docs/tools-contract.md).
export const RESULT = Object.freeze({ NO_MONEY: -2, NEED_BULLDOZE: -1, FAILED: 0, OK: 1 });

// Engine methods the palette needs. Without all of them the page keeps its old behaviour.
const REQUIRED_METHODS = [
  "tool_count", "tool_info", "tool_key", "tool_down", "tool_drag", "tool_preview", "tool_footprint",
];

export function supportsTools(city) {
  return REQUIRED_METHODS.every((m) => typeof city?.[m] === "function");
}

// Message shown in the aria-live status for a tool_down result. Empty for success.
export function resultMessage(code) {
  switch (code) {
    case RESULT.OK:
      return "";
    case RESULT.NO_MONEY:
      return "Pas assez d'argent";
    case RESULT.NEED_BULLDOZE:
      return "Terrain à dégager d'abord (bulldozer)";
    case RESULT.FAILED:
      return "Impossible de construire ici";
    default:
      return "Action impossible";
  }
}

// French labels, presentation only. A key not listed here is shown as its raw key.
export const TOOL_LABELS = Object.freeze({
  road: "Route",
  railroad: "Voie ferrée",
  rail: "Voie ferrée",
  wire: "Ligne électrique",
  network: "Réseau",
  residential: "Zone résidentielle",
  commercial: "Zone commerciale",
  industrial: "Zone industrielle",
  fire_station: "Caserne de pompiers",
  police_station: "Commissariat",
  stadium: "Stade",
  park: "Parc",
  coal_power: "Centrale à charbon",
  nuclear_power: "Centrale nucléaire",
  seaport: "Port maritime",
  airport: "Aéroport",
  bulldozer: "Bulldozer",
  water: "Eau",
  land: "Terrain nu",
  forest: "Forêt",
  query: "Requête",
});

// Palette groups, in display order. Keys not listed fall into "Autres".
export const TOOL_GROUPS = Object.freeze([
  { id: "reseaux", label: "Réseaux", keys: ["road", "railroad", "rail", "wire", "network"] },
  { id: "zones", label: "Zones", keys: ["residential", "commercial", "industrial"] },
  { id: "services", label: "Services", keys: ["fire_station", "police_station", "stadium", "park"] },
  { id: "energie", label: "Énergie et transport", keys: ["coal_power", "nuclear_power", "seaport", "airport"] },
  { id: "terrain", label: "Terrain", keys: ["bulldozer", "water", "land", "forest"] },
  { id: "requete", label: "Information", keys: ["query"] },
]);
const OTHER_GROUP = Object.freeze({ id: "autres", label: "Autres" });

export function groupOf(key) {
  return TOOL_GROUPS.find((g) => g.keys.includes(key)) ?? OTHER_GROUP;
}

// Keyboard shortcuts, presentation only. Each letter/digit is used once (tested).
export const SHORTCUTS = Object.freeze({
  bulldozer: "b",
  road: "r",
  railroad: "t",
  wire: "e",
  residential: "1",
  commercial: "2",
  industrial: "3",
  fire_station: "f",
  police_station: "p",
  stadium: "s",
  park: "g",
  seaport: "m",
  coal_power: "c",
  nuclear_power: "n",
  airport: "a",
  water: "w",
  land: "l",
  forest: "v",
  query: "q",
});

export function shortcutFor(key) {
  return Object.hasOwn(SHORTCUTS, key) ? SHORTCUTS[key] : null;
}

// Rows of the keyboard help: [{ key: "B", label: "Bulldozer" }, ...] sorted by key, for the
// tools the engine reports, then the fixed keys (Échap cancels the tool).
export function shortcutRows(catalog) {
  const rows = catalog
    .filter((t) => t.shortcut)
    .map((t) => ({ key: t.shortcut.toUpperCase(), label: t.label }))
    .sort((a, b) => a.key.localeCompare(b.key, "fr"));
  rows.push({ key: "Échap", label: "Abandonner l'outil choisi" });
  return rows;
}

// Tool id bound to a typed character, among the tools the engine actually reports.
export function toolIdForShortcut(char, catalog) {
  if (typeof char !== "string" || char.length !== 1) return null;
  const k = char.toLowerCase();
  const hit = catalog.find((t) => t.shortcut === k);
  return hit ? hit.id : null;
}

// Reads the engine's tool list: [{ id, key, label, group, groupLabel, cost, size, shortcut }].
export function readCatalog(city) {
  const n = city.tool_count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const [id, cost, size] = city.tool_info(i);
    const key = String(city.tool_key(i));
    const group = groupOf(key);
    out.push({
      id,
      key,
      label: Object.hasOwn(TOOL_LABELS, key) ? TOOL_LABELS[key] : key,
      group: group.id,
      groupLabel: group.label,
      cost,
      size,
      shortcut: shortcutFor(key),
    });
  }
  return out;
}

// Catalog grouped in display order; empty groups are dropped.
export function groupCatalog(catalog) {
  const groups = [...TOOL_GROUPS, OTHER_GROUP];
  return groups
    .map((g) => ({ id: g.id, label: g.label, tools: catalog.filter((t) => t.group === g.id) }))
    .filter((g) => g.tools.length > 0);
}

export function formatCost(cost) {
  return cost > 0 ? `${cost.toLocaleString("fr-FR")} $` : "gratuit";
}

// Cost shown on the hover label. When the placement is Ok, the cost is the one tool_preview
// returns (terrain can add cost: clearing trees or rubble), never the catalog price. Otherwise
// the preview's cost if it has one, else the catalog price, so the label always tells a cost.
export function costLabel(preview, price) {
  if (preview[0] === RESULT.OK) return formatCost(preview[1]);
  return formatCost(preview[1] > 0 ? preview[1] : price);
}

// tool_footprint [x0, y0, w, h] in tiles -> pixel rectangle on the overlay.
export function outlineRect(fp, px = TILE_PX) {
  const [x0, y0, w, h] = fp;
  return { x: x0 * px, y: y0 * px, w: w * px, h: h * px };
}

// tool_preview [result, cost] -> "ok" (green outline) or "bad" (red outline).
export function hoverVerdict(preview) {
  return preview[0] === RESULT.OK ? "ok" : "bad";
}

// ---------------------------------------------------------------------------
// Runtime (DOM). Called once from main.js, after the engine exists.

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Fills the keyboard help list (<dl>) with the shortcut rows.
function buildHelp(dl, rows) {
  dl.replaceChildren();
  for (const r of rows) {
    const dt = el("dt", null);
    dt.append(el("kbd", "tool-key", r.key));
    dl.append(dt, el("dd", null, r.label));
  }
}

// Builds the palette buttons into `container`. Returns { select(id | null) }.
function buildPalette(container, catalog, onPick) {
  const buttons = new Map();
  for (const group of groupCatalog(catalog)) {
    const fieldset = el("fieldset", "tool-group");
    fieldset.append(el("legend", null, group.label));
    const row = el("div", "tool-row");
    for (const t of group.tools) {
      const b = el("button", "tool");
      b.type = "button";
      b.dataset.tool = t.key;
      b.setAttribute("aria-pressed", "false");
      const shortcut = t.shortcut ? t.shortcut.toUpperCase() : null;
      b.title = `${t.label} : ${formatCost(t.cost)}, taille ${t.size}×${t.size}` +
        (shortcut ? ` (raccourci ${shortcut})` : "");
      if (shortcut) b.setAttribute("aria-keyshortcuts", shortcut);
      b.append(el("span", "tool-name", t.label), el("span", "tool-cost", formatCost(t.cost)));
      if (shortcut) b.append(el("kbd", "tool-key", shortcut));
      b.addEventListener("click", () => onPick(t.id));
      buttons.set(t.id, b);
      row.append(b);
    }
    fieldset.append(row);
    container.append(fieldset);
  }
  return {
    select(id) {
      for (const [tid, b] of buttons) {
        const on = tid === id;
        b.setAttribute("aria-pressed", String(on));
        b.classList.toggle("active", on);
      }
    },
  };
}

// `price` is the tool's catalog cost, shown when the preview charges nothing (a failed
// placement), so the label always tells what the tool costs.
function paintHover(g, rect, preview, price) {
  const ok = hoverVerdict(preview) === "ok";
  const color = ok ? "#1e8e3e" : "#d93025";
  g.save();
  g.fillStyle = ok ? "rgba(30, 142, 62, 0.25)" : "rgba(217, 48, 37, 0.25)";
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  const text = costLabel(preview, price);
  g.font = "bold 14px system-ui, sans-serif";
  const boxW = g.measureText(text).width + 8;
  const boxH = 18;
  let by = rect.y - boxH - 2;
  if (by < 0) by = rect.y + rect.h + 2;
  const bx = Math.max(0, Math.min(rect.x, g.canvas.width - boxW));
  g.fillStyle = color;
  g.fillRect(bx, by, boxW, boxH);
  g.fillStyle = "#fff";
  g.textBaseline = "middle";
  g.fillText(text, bx + 4, by + boxH / 2);
  g.restore();
}

// Wires the palette, keyboard shortcuts, pointer input and the hover overlay.
// Returns { render() } to call after every redraw of the map, or null when the engine
// has no tool API (the palette and overlay are then hidden and the page works as before).
//   onChange(): redraws the whole page after an action (the map and funds change).
//   help (optional): <dl> that receives the keyboard shortcut rows; hidden without the tool API.
export function setupTools({ city, canvas, overlay, palette, message, queryPanel, help = null, onChange }) {
  if (!supportsTools(city)) {
    palette.hidden = true;
    overlay.hidden = true;
    queryPanel.hidden = true;
    if (help) help.closest("details").hidden = true;
    return null;
  }

  palette.hidden = false;
  overlay.hidden = false;
  const catalog = readCatalog(city);
  if (help) {
    buildHelp(help, shortcutRows(catalog));
    help.closest("details").hidden = false;
  }
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const queryId = catalog.find((t) => t.key === "query")?.id ?? null;
  const isInspect = (id) => id === queryId && typeof city.query === "function";
  const say = (text) => {
    message.textContent = text;
  };

  let activeId = null;
  let hover = null;

  const stroke = new ToolStroke(city, {
    isInspect,
    onResult: (code) => say(resultMessage(code)),
    onInspect: (tile) => {
      // [] (or nothing usable) -> the "rien à signaler" line; otherwise one line per fact.
      const lines = formatZoneStatus(city.query(tile.x, tile.y));
      queryPanel.hidden = false;
      queryPanel.replaceChildren(
        ...(lines.length ? lines : ["Rien à signaler ici."]).map((line, i) =>
          el("div", i === 0 ? "query-title" : "query-line", line)),
      );
    },
  });

  const ui = buildPalette(palette, catalog, (id) => select(id));

  function select(id) {
    activeId = id;
    ui.select(id);
    canvas.style.cursor = id === null ? "" : "crosshair";
    say("");
    render();
  }

  function render() {
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }
    const g = overlay.getContext("2d");
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (activeId === null || hover === null || isInspect(activeId)) return;
    const fp = city.tool_footprint(activeId, hover.x, hover.y);
    const preview = city.tool_preview(activeId, hover.x, hover.y);
    paintHover(g, outlineRect(fp), preview, byId.get(activeId)?.cost ?? 0);
  }

  attachPointer(canvas, {
    mapSize: () => ({ w: city.width(), h: city.height() }),
    onDown(tile) {
      if (activeId === null) return;
      hover = tile;
      stroke.down(activeId, tile);
      onChange();
    },
    onMove(tile, dragging) {
      hover = tile;
      if (dragging && stroke.active) {
        if (stroke.move(tile)) onChange();
        else render();
      } else {
        render();
      }
    },
    onUp() {
      stroke.up();
      render();
    },
    onLeave() {
      hover = null;
      render();
    },
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) {
      return;
    }
    if (ev.key === "Escape") {
      if (activeId !== null) select(null);
      return;
    }
    const id = toolIdForShortcut(ev.key, catalog);
    if (id !== null) select(id);
  });

  return { render };
}
