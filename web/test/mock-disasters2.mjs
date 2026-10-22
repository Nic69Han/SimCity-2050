// Extended disasters of the mock engine (docs/game-design-v13.md), used by mock-engine.mjs when its `disasters2`
// option is on. A small in-memory state; the engine's real rules are the core's (crates/micropolis-core/src/disasters2.rs).
// The mock is not the engine: it models no luck and no effect on the tiles.
//
// Mock rules: disaster2_rules() is off by default and after a new city or a load. Switching it off forgets the
// drought and the last disaster. On: trigger_disaster(kind) answers 1 (done) for the kinds 1 riot, 2 UFO, 3 meteorite,
// 4 drought, and -1 for any other kind (the mock has no place where it is impossible; the page tests stub that).
// Riot, UFO and meteorite put the last disaster at the map centre (width >> 1, height >> 1); a drought sets
// MOCK_DROUGHT_MONTHS months and has no place. Off, trigger_disaster answers 0 (rule off).
// disaster2_stats() is [drought_months_left, last_kind (0 none), x, y] with -1 for no place; test hook
// mock_set_drought(months) sets the months left (not in the engine contract).

// The methods of the extended disasters API, hidden unless the constructor asks with `disasters2: true`.
export const DISASTER2_METHODS = Object.freeze(["disaster2_rules", "set_disaster2_rules", "trigger_disaster", "disaster2_stats"]);

export const MOCK_DROUGHT_MONTHS = 12;
export const KIND = Object.freeze({ RIOT: 1, UFO: 2, METEOR: 3, DROUGHT: 4 });
export const TRIGGER_DONE = 1;
export const TRIGGER_RULE_OFF = 0;
export const TRIGGER_IMPOSSIBLE = -1;

export class MockDisasters2 {
  #on = false;
  #drought = 0; // months left
  #last = 0; // kind of the last disaster, 0 none
  #x = -1;
  #y = -1;

  /** Back to the start: rule off, no drought, no last disaster. */
  reset() {
    this.#on = false;
    this.#drought = 0;
    this.#last = 0;
    this.#x = -1;
    this.#y = -1;
  }

  rule() {
    return this.#on;
  }

  setRule(on) {
    if (!on) this.reset();
    this.#on = Boolean(on);
  }

  /** trigger_disaster for a map of `width` x `height`: the code, and the state changed when it is TRIGGER_DONE. */
  trigger(kind, width, height) {
    if (!this.#on) return TRIGGER_RULE_OFF;
    if (!Object.values(KIND).includes(kind)) return TRIGGER_IMPOSSIBLE;
    this.#last = kind;
    if (kind === KIND.DROUGHT) {
      this.#drought = MOCK_DROUGHT_MONTHS;
      this.#x = -1;
      this.#y = -1;
    } else {
      this.#x = width >> 1;
      this.#y = height >> 1;
    }
    return TRIGGER_DONE;
  }

  /** Test hook: the months of drought left, clamped to 0..MOCK_DROUGHT_MONTHS. */
  setDrought(months) {
    this.#drought = Math.min(MOCK_DROUGHT_MONTHS, Math.max(0, Math.trunc(Number(months)) || 0));
  }

  /** [drought months left, last kind, x, y]: the position is -1 when there is none. */
  stats() {
    return Int32Array.of(this.#drought, this.#last, this.#x, this.#y);
  }
}
