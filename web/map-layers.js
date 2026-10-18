// Layers of the 2D map (docs/game-design-v02.md, phase A): pictures a feature draws over the
// tiles (the water pipes, the metro lines...). render.js draws them after the tiles, in this
// order. Each layer is { name, visible(city), draw(ctx2d, city, scale) }: `visible` says whether
// to draw now (the feature is on, its view is chosen), `draw` paints on the map canvas, `scale`
// being canvas pixels per tile. A layer draws only what it owns: it never changes the tiles.
// Pure: no DOM, so node:test can check it with a fake context.

import { WATER_LAYER } from "./map-layer-water.js";
import { TRANSIT_LAYER } from "./map-layer-transit.js";
import { VEHICLES_LAYER } from "./map-layer-vehicles.js";

// The layers of the page, in drawing order (a workstream fills its own module).
export const MAP_LAYERS = Object.freeze([WATER_LAYER, TRANSIT_LAYER, VEHICLES_LAYER]);

// The layer painter of a renderer: `plan(city)` says which layers draw now and whether the tiles
// must be repainted in full first (a layer draws over them, so a dirty-rectangle repaint would
// stack its pixels; one more full repaint is also needed when the last layer goes away, to erase
// it). `draw(ctx, city, scale, active)` paints those layers.
export function createMapLayers(layers = MAP_LAYERS) {
  let shown = false;
  return {
    plan(city) {
      const active = layers.filter((layer) => layer.visible(city));
      const full = active.length > 0 || shown;
      shown = active.length > 0;
      return { active, full };
    },
    draw(ctx, city, scale, active) {
      for (const layer of active) layer.draw(ctx, city, scale);
    },
  };
}
