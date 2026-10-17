// Building tools, presentation side (ARCHITECTURE.md rule 5): the engine decides costs,
// validity and effects; this module names, groups, displays and forwards.
// Everything above setupTools() is pure and importable without a DOM. setupTools() is
// the only function that touches the page, and it is called at runtime only.
import { ToolStroke, attachPointer, tileAt } from "./input.js";
import { formatZoneStatus } from "./query.js";
import { extraCatalog, extraCalls, extraLabel, extraBlockedReason, isExtraTool } from "./extra-tools.js";

export const TILE_PX = 8; // canvas pixels per tile (same as main.js)

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
      // the engine's code for "something is on the tile" (rubble, trees, or water, where a
      // bulldozer cannot help): the message says what to do in either case
      return "Emplacement occupé : dégagez-le d'abord ou choisissez un autre endroit";
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

// The engine calls of one catalog entry: { footprint, preview, down, drag }, each taking tile
// coordinates. Engine tools go to tool_*; an entry of an extra tool module (extra-tools.js) goes
// to that module's calls.
export function callsFor(city, entry) {
  const extra = extraCalls(city, entry);
  if (extra) return extra;
  return {
    footprint: (x, y) => city.tool_footprint(entry.id, x, y),
    preview: (x, y) => city.tool_preview(entry.id, x, y),
    down: (x, y) => city.tool_down(entry.id, x, y),
    drag: (x0, y0, x1, y1) => city.tool_drag(entry.id, x0, y0, x1, y1),
  };
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

// Builds the palette buttons into `container`. Returns { select(id | null), setBlocked(reasonOf) }:
// setBlocked(entry => reason) enables the buttons of the extra tools whose reason is "" and
// disables the others, the reason being their title.
function buildPalette(container, catalog, onPick) {
  const buttons = new Map();
  const extraButtons = [];
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
      const costText = t.costText ?? formatCost(t.cost);
      b.title = `${t.label} : ${costText}, taille ${t.size}×${t.size}` +
        (shortcut ? ` (raccourci ${shortcut})` : "");
      if (shortcut) b.setAttribute("aria-keyshortcuts", shortcut);
      b.append(el("span", "tool-name", t.label), el("span", "tool-cost", costText));
      if (shortcut) b.append(el("kbd", "tool-key", shortcut));
      b.addEventListener("click", () => onPick(t.id));
      buttons.set(t.id, b);
      if (isExtraTool(t)) extraButtons.push({ tool: t, b });
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
    setBlocked(reasonOf) {
      for (const { tool, b } of extraButtons) {
        const reason = reasonOf(tool);
        b.disabled = reason !== "";
        b.title = `${tool.label} : ${reason || tool.idleHint || tool.costText || formatCost(tool.cost)}` +
          (tool.shortcut ? ` (raccourci ${tool.shortcut.toUpperCase()})` : "");
      }
    },
  };
}

// `price` is the tool's catalog cost, shown when the preview charges nothing (a failed
// placement), so the label always tells what the tool costs. `label` overrides the text (extra tools).
function paintHover(g, rect, preview, price, label) {
  const ok = hoverVerdict(preview) === "ok";
  const color = ok ? "#1e8e3e" : "#d93025";
  g.save();
  g.fillStyle = ok ? "rgba(30, 142, 62, 0.25)" : "rgba(217, 48, 37, 0.25)";
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  const text = label ?? costLabel(preview, price);
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

// The surface the tools draw on and take pointers from. The flat map is the default: its hover
// outline is painted on the overlay canvas. Another view (3D) gives the same four things:
//   canvas            the element the pointer events come from
//   tileOf(ev)        the tile under a pointer event, or null (optional: flat geometry without it)
//   clear()           removes the hover outline
//   outline(fp, preview, price)  draws the outline of footprint fp, with tool_preview's verdict
//   setTool(on)       optional: a tool was selected (on) or dropped
function flatSurface(canvas, overlay) {
  const sync = () => {
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }
    return overlay.getContext("2d");
  };
  return {
    canvas,
    clear() {
      const g = sync();
      g.clearRect(0, 0, overlay.width, overlay.height);
    },
    outline(fp, preview, price, label) {
      paintHover(sync(), outlineRect(fp), preview, price, label);
    },
  };
}

// Wires the palette, keyboard shortcuts, pointer input and the hover outline.
// Returns { render(), useSurface(surface | null), setFlag(name, on) } or null when the engine has no
// tool API (the palette and overlay are then hidden and the page works as before). render() after
// every redraw of the map; useSurface(s) moves the pointer and the outline to another view (null:
// back to the flat map); setFlag(name, on) tells the extra tools an engine flag the page has read
// (`flags` of extra-tools.js), so that they can enable or disable their buttons.
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
  const catalog = [...readCatalog(city), ...extraCatalog(city)];
  if (help) {
    buildHelp(help, shortcutRows(catalog));
    help.closest("details").hidden = false;
  }
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const calls = new Map(catalog.map((t) => [t.id, callsFor(city, t)]));
  const queryId = catalog.find((t) => t.key === "query")?.id ?? null;
  const isInspect = (id) => id === queryId && typeof city.query === "function";
  const say = (text) => {
    message.textContent = text;
  };

  let activeId = null;
  let hover = null;
  const flags = {}; // the engine flags, as the page last read them (setFlag)
  const flat = flatSurface(canvas, overlay);
  let surface = flat;
  let pointerAbort = null;

  // ToolStroke talks to the engine by tool id; the adapter routes each id to its engine calls.
  const strokeEngine = {
    tool_down: (id, x, y) => calls.get(id).down(x, y),
    tool_drag: (id, x0, y0, x1, y1) => calls.get(id).drag(x0, y0, x1, y1),
  };
  const stroke = new ToolStroke(strokeEngine, {
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

  // Why tool `id` cannot be selected now ("" when it can). Only extra tools have a condition.
  function blockedReason(id) {
    return extraBlockedReason(byId.get(id), city, { in3d: surface !== flat, flags: { ...flags } });
  }

  function select(id) {
    if (id !== null) {
      const reason = blockedReason(id);
      if (reason) {
        say(reason);
        return;
      }
    }
    activeId = id;
    ui.select(id);
    surface.canvas.style.cursor = id === null ? "" : "crosshair";
    surface.setTool?.(id !== null);
    say("");
    render();
  }

  function render() {
    surface.clear();
    if (activeId === null || hover === null || isInspect(activeId)) return;
    const entry = byId.get(activeId);
    const c = calls.get(activeId);
    const fp = c.footprint(hover.x, hover.y);
    const preview = c.preview(hover.x, hover.y);
    const label = extraLabel(entry, preview);
    surface.outline(fp, preview, entry?.cost ?? 0, label);
  }

  // The extra tools' buttons follow the engine flags and the view: a selected one is dropped
  // when it stops being allowed.
  function refreshExtras() {
    ui.setBlocked((entry) => blockedReason(entry.id));
    if (activeId !== null && blockedReason(activeId)) select(null);
  }

  // Pointer events of the current surface only: the previous surface's listeners are removed.
  function useSurface(next = null) {
    pointerAbort?.abort();
    pointerAbort = new AbortController();
    surface.canvas.style.cursor = "";
    surface = next ?? flat;
    surface.setTool?.(activeId !== null);
    surface.canvas.style.cursor = activeId === null ? "" : "crosshair";
    const handlers = surface.tileOf ? { ...pointerHandlers, tileOf: surface.tileOf } : pointerHandlers;
    attachPointer(surface.canvas, handlers, { signal: pointerAbort.signal });
    refreshExtras();
    render();
  }

  // An engine flag, read by the page after each change or new city.
  function setFlag(name, on) {
    flags[name] = Boolean(on);
    refreshExtras();
  }

  const pointerHandlers = {
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
  };
  useSurface(null);

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

  return { render, useSurface, setFlag };
}
