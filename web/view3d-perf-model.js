// 3D view: adaptive render resolution (docs/game-design-v14.md, "Fluidité"). Pure functions only.
// The layer (view3d-perf.js) measures the time between two frames and passes it to decide(); the
// pixel ratio it returns is applied to the renderer. A frame gap includes the animation loop's wait
// (the loop renders at ANIMATION_FPS, about 67 ms a frame), so FRAME_BUDGET_MS sits well above it:
// a mean over the budget means the frames are late, a mean well under it means there is margin.

export const FRAME_WINDOW = 30; // frames kept for the mean (the window is bounded)
export const FRAME_BUDGET_MS = 120; // a mean above this lowers the resolution
export const RECOVER_FRACTION = 0.8; // a mean under FRAME_BUDGET_MS * this raises it again
export const PIXEL_RATIO_STEP = 0.25;
export const PIXEL_RATIO_MIN = 0.5;
export const PIXEL_RATIO_MAX = 2;
export const ADAPT_INTERVAL_MS = 2000; // at most one change per interval (hysteresis)
export const ADAPT_MIN_FRAMES = 10; // no change before this many frames since the last one
export const MAX_SAMPLE_MS = 1000; // a longer gap is a pause (hidden tab), not a frame: not sampled

// The state of the adaptation: the recent frame times, the ratio in use and the time of the last change.
export function initial(pixelRatio) {
  return { frames: [], pixelRatio, changedAt: null };
}

// The frame time to keep, or null when the gap is not a frame (not a finite positive number, or a pause).
export function sampleOf(gapMs) {
  if (!Number.isFinite(gapMs) || gapMs <= 0 || gapMs > MAX_SAMPLE_MS) return null;
  return gapMs;
}

// The frames with one more appended, at most FRAME_WINDOW of them (the oldest go).
export function pushSample(frames, ms) {
  const next = [...frames, ms];
  return next.length > FRAME_WINDOW ? next.slice(next.length - FRAME_WINDOW) : next;
}

// Mean of the frame times, or null with no frame yet.
export function mean(frames) {
  if (frames.length === 0) return null;
  return frames.reduce((sum, ms) => sum + ms, 0) / frames.length;
}

// The ratio clamped to [PIXEL_RATIO_MIN, min(PIXEL_RATIO_MAX, devicePixelRatio)]. A device ratio that
// is not a positive number counts as 1. The minimum wins over a lower device ratio.
export function clampRatio(ratio, devicePixelRatio) {
  const device = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const upper = Math.min(PIXEL_RATIO_MAX, device);
  return Math.max(PIXEL_RATIO_MIN, Math.min(ratio, upper));
}

// The ratio wanted for a mean frame time: one step down when the mean is over the budget, one step up
// when it is under the recover threshold, unchanged in between. Always clamped.
export function targetRatio(current, meanMs, devicePixelRatio) {
  let next = current;
  if (meanMs > FRAME_BUDGET_MS) next = current - PIXEL_RATIO_STEP;
  else if (meanMs < FRAME_BUDGET_MS * RECOVER_FRACTION) next = current + PIXEL_RATIO_STEP;
  return clampRatio(Math.round(next * 100) / 100, devicePixelRatio);
}

// True when a change is allowed now: none yet, or ADAPT_INTERVAL_MS have passed since the last one.
export function mayChange(changedAt, nowMs) {
  if (changedAt === null) return true;
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - changedAt >= ADAPT_INTERVAL_MS;
}

// The next state after one frame gap (frameMs) measured at nowMs. A change clears the window, so the
// next decision looks only at frames drawn at the new ratio.
export function decide(state, frameMs, nowMs, devicePixelRatio) {
  const sample = sampleOf(frameMs);
  const frames = sample === null ? state.frames : pushSample(state.frames, sample);
  if (frames.length < ADAPT_MIN_FRAMES || !mayChange(state.changedAt, nowMs)) {
    return { ...state, frames };
  }
  const next = targetRatio(state.pixelRatio, mean(frames), devicePixelRatio);
  if (next === state.pixelRatio) return { ...state, frames };
  return { frames: [], pixelRatio: next, changedAt: nowMs };
}
