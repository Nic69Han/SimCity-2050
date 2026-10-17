// Registry of the extra tool modules (docs/game-design-v02.md, phase A). tools.js knows only this
// file: a workstream adds its tools by writing a module and listing it here, without touching
// tools.js (ARCHITECTURE: open to extension, closed to modification).
//
// A tool module exports:
//   KIND                        string put in the `kind` of each of its catalog entries
//   catalog(city)               catalog entries (same shape as tools.js readCatalog's, plus `kind`
//                               and optional `costText` shown on the button, `idleHint` shown in
//                               its title while enabled); [] when the engine lacks the methods
//   calls(city, entry)          { footprint, preview, down, drag } for an entry of this module
//                               (each takes tile coordinates), null for another module's entry
//   label(preview)              text of the hover label for tool_preview-like `preview`
//                               ([result, cost]); undefined keeps the default cost label
//   blockedReason(city, { in3d, flags })  why the tools cannot be used now, in French; "" when
//                               they can. `in3d`: the 3D view is shown. `flags`: the engine flags
//                               the page has read, by name (flags.relief: relief rules on)
// Pure: no DOM.
import * as relief from "./tools-relief.js";
import * as water from "./tools-water.js";
import * as transit from "./tools-transit.js";

export const EXTRA_TOOL_MODULES = Object.freeze([relief, water, transit]);

// The module whose tools `entry` belongs to, or null (an engine tool).
function moduleOf(entry) {
  if (!entry?.kind) return null;
  return EXTRA_TOOL_MODULES.find((m) => m.KIND === entry.kind) ?? null;
}

// Whether `entry` is an extra tool (not an engine tool id).
export function isExtraTool(entry) {
  return moduleOf(entry) !== null;
}

// The catalog entries of every module, in registry order.
export function extraCatalog(city) {
  return EXTRA_TOOL_MODULES.flatMap((m) => m.catalog(city));
}

// The engine calls of an extra entry, or null for an engine tool.
export function extraCalls(city, entry) {
  return moduleOf(entry)?.calls(city, entry) ?? null;
}

// The hover label of an extra entry, or undefined (engine tool, or the default label).
export function extraLabel(entry, preview) {
  return moduleOf(entry)?.label(preview);
}

// Why an extra entry cannot be used now; "" for an engine tool or an allowed tool.
export function extraBlockedReason(entry, city, context) {
  return moduleOf(entry)?.blockedReason(city, context) ?? "";
}
