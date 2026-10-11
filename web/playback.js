// The play loop (presentation, ARCHITECTURE.md rule 5): how many engine ticks a frame runs,
// and the single animation-frame loop that runs them. No DOM here: the frame functions are
// injected, so the loop is tested in node (web/test/playback.test.mjs).

// Simulation ticks per animation frame, by engine speed (1..3; the slider's values).
export const TICKS_PER_FRAME = Object.freeze({ 1: 1, 2: 4, 3: 16 });

export function ticksPerFrame(speed) {
  return Object.hasOwn(TICKS_PER_FRAME, speed) ? TICKS_PER_FRAME[speed] : 1;
}

// One loop at most. set(true) starts the loop unless one is already pending; set(false)
// cancels the pending frame, so no frame can run after a pause, whatever the toggling order.
//   tick(): runs once per frame while playing.
//   request(cb) / cancel(id): the animation-frame functions (looked up at call time by default).
export function createPlayback({
  tick,
  request = (cb) => globalThis.requestAnimationFrame(cb),
  cancel = (id) => globalThis.cancelAnimationFrame(id),
}) {
  let on = false;
  let pending = null; // id of the frame this loop has requested and not yet run
  const frame = () => {
    pending = null;
    if (!on) return;
    tick();
    if (on) pending = request(frame);
  };
  return {
    get playing() {
      return on;
    },
    set(value) {
      on = Boolean(value);
      if (on && pending === null) {
        pending = request(frame);
      } else if (!on && pending !== null) {
        cancel(pending);
        pending = null;
      }
    },
  };
}
