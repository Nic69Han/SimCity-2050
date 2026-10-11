// Pointer input for the building tools (ARCHITECTURE.md rule 5: no game rule here).
// Importing this module touches no DOM; attachPointer() does, and is called at runtime only.

// Converts a client (viewport) position to a map tile.
// `rect` is the canvas content box as returned by getBoundingClientRect(); the canvas is
// drawn at SCALE pixels per tile but CSS may scale it, so the tile is taken from the
// fraction of the displayed width: tile = floor(fraction * mapWidth). Positions outside
// the canvas are clamped to the nearest edge tile (useful while dragging past the border).
// Returns null when the geometry is unusable (no size, no map).
export function tileAt(clientX, clientY, rect, mapW, mapH) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  if (!(mapW > 0) || !(mapH > 0)) return null;
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return {
    x: clamp(Math.floor(fx * mapW), 0, mapW - 1),
    y: clamp(Math.floor(fy * mapH), 0, mapH - 1),
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function sameTile(a, b) {
  return a !== null && b !== null && a.x === b.x && a.y === b.y;
}

// One press-drag-release of a tool. The engine decides everything: this only decides
// when to call it, following the C++ UI: tool_down on press, then tool_drag from the
// previous tile to the new one, each time the tile under the pointer changes.
//
// engine: object with tool_down(id, x, y) and tool_drag(id, x0, y0, x1, y1).
// options.isInspect(id) -> true for tools that only query (no engine action); they get
//   options.onInspect(tile) instead of tool_down / tool_drag.
// options.onResult(code, tile) receives tool_down's ToolResult code.
export class ToolStroke {
  #engine;
  #isInspect;
  #onResult;
  #onInspect;
  #toolId = null;
  #last = null;

  constructor(engine, options = {}) {
    this.#engine = engine;
    this.#isInspect = options.isInspect ?? (() => false);
    this.#onResult = options.onResult ?? (() => {});
    this.#onInspect = options.onInspect ?? (() => {});
  }

  get active() {
    return this.#toolId !== null;
  }

  // Button pressed on `tile` with tool `toolId`. Starts a stroke.
  down(toolId, tile) {
    this.#toolId = toolId;
    this.#last = tile;
    if (this.#isInspect(toolId)) {
      this.#onInspect(tile);
      return null;
    }
    const code = this.#engine.tool_down(toolId, tile.x, tile.y);
    this.#onResult(code, tile);
    return code;
  }

  // Pointer moved to `tile` while the stroke is active. Only a tile different from the
  // previous one produces a call. Returns true when a call was made.
  move(tile) {
    if (this.#toolId === null || tile === null) return false;
    if (sameTile(tile, this.#last)) return false;
    const from = this.#last;
    this.#last = tile;
    if (this.#isInspect(this.#toolId)) {
      this.#onInspect(tile);
      return true;
    }
    this.#engine.tool_drag(this.#toolId, from.x, from.y, tile.x, tile.y);
    return true;
  }

  // Button released or pointer cancelled.
  up() {
    this.#toolId = null;
    this.#last = null;
  }
}

// Wires pointer events on `canvas` (Pointer Events: mouse, pen and touch alike).
// handlers:
//   mapSize() -> {w, h}      map size in tiles, read at each event
//   onDown(tile)             primary button / first touch pressed
//   onMove(tile, dragging)   pointer moved (dragging = pressed); called for every tile change or move
//   onUp()                   released or cancelled
//   onLeave()                pointer left the canvas while not pressed
// The canvas must have `touch-action: none` so touch drags are not taken by scrolling.
export function attachPointer(canvas, handlers) {
  let dragging = false;

  const tileOf = (ev) => {
    const { w, h } = handlers.mapSize();
    return tileAt(ev.clientX, ev.clientY, canvas.getBoundingClientRect(), w, h);
  };

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || dragging) return;
    const tile = tileOf(ev);
    if (!tile) return;
    dragging = true;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      // capture is best effort: a drag that leaves the canvas still works via clamping
    }
    handlers.onDown(tile);
  });

  canvas.addEventListener("pointermove", (ev) => {
    const tile = tileOf(ev);
    if (tile) handlers.onMove(tile, dragging);
  });

  const end = (ev) => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      // already released
    }
    handlers.onUp();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener("pointerleave", () => {
    if (!dragging) handlers.onLeave();
  });
}
