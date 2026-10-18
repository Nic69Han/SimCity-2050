// 2D map layer: the simulated vehicles (docs/game-design-v03.md). Placeholder: never visible.
export const VEHICLES_LAYER = Object.freeze({
  name: "vehicles",
  visible: () => false,
  draw: () => {},
});
