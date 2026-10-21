// 3D power plants (genres 40-46, docs/game-design-v10.md), pure part of view3d-structures-model.js, kept
// apart to keep that file short. Built from the same blocks and slabs: gas (grey block, two short stacks),
// oil (dark block, tall stack), wind (white mast, three blades), solar (rows of blue panels), hydro (concrete
// dam and water), microwave (block with a dish), fusion (block with a stepped dome). Heights in world units;
// the footprints are 1 to 4 tiles. The shared helpers come from the model file through `energyBuilders(h)`,
// so this module imports nothing and there is no import cycle.

export const GAS = Object.freeze({
  height: 0.7, stackFractions: Object.freeze([0.25, 0.75]), // two short stacks, at these fractions of the width
  stack: Object.freeze({ width: 0.2, height: 0.5 }),
});
export const OIL = Object.freeze({ height: 0.7, stack: Object.freeze({ width: 0.25, height: 2.0, inset: 0.5 }) });
export const WIND = Object.freeze({
  mast: Object.freeze({ width: 0.08, height: 1.6 }),
  blade: Object.freeze({ length: 0.4, width: 0.08, thick: 0.04 }), // three arms from the hub: east, west, south
});
export const SOLAR = Object.freeze({ rows: 3, thick: 0.05, lift: 0.25, step: 0.12, fill: 0.9 }); // panels per plant
export const HYDRO = Object.freeze({ dam: Object.freeze({ depth: 0.4, height: 0.7 }), water: Object.freeze({ height: 0.1 }) });
export const MICROWAVE = Object.freeze({
  height: 1.0, inset: 0.3, stand: Object.freeze({ width: 0.12, height: 0.4 }),
  dish: Object.freeze({ inset: 0.05, thick: 0.05 }),
});
export const FUSION = Object.freeze({ height: 0.8, dome: Object.freeze({ steps: 3, step: 0.3, shrink: 0.15 }) });

// The plant colours, merged into COLORS by the model file.
export const ENERGY_COLORS = Object.freeze({
  gas: "#b0bec5", oil: "#37474f", windMast: "#f5f5f0", windBlade: "#eeeeee", solarPanel: "#0d47a1",
  concrete: "#bdbdbd", water: "#29b6f6", microwave: "#eceff1", dish: "#90a4ae", fusion: "#78909c",
  fusionDome: "#b0bec5",
});

// The builders of genres 40-46. `h` holds the model's GENRE, SHAPES, COLORS and its helpers place, body,
// stackAt, cornerStack, cx and cz.
export function energyBuilders(h) {
  const { GENRE, SHAPES, COLORS, place, body, stackAt, cornerStack, cx, cz } = h;


  // Two short stacks on the back of a gas plant, standing on `top`.
  function gasStacks(s, top) {
    return GAS.stackFractions.map((fx) => stackAt(s.x + fx * s.w, cz(s), top, GAS.stack, COLORS.chimney));
  }

  // The wind turbine's blades: three arms from the hub at the centre, at height `top`. Each arm is as long as
  // WIND.blade.length allows, and at most half a side of the footprint, so the turbine stays inside its tiles.
  function bladesOn(s, top) {
    const { width, thick } = WIND.blade;
    const len = Math.min(WIND.blade.length, s.w / 2, s.h / 2);
    const x = cx(s), z = cz(s);
    return [
      place(x + len / 2, top, z, len, thick, width, COLORS.windBlade),
      place(x - len / 2, top, z, len, thick, width, COLORS.windBlade),
      place(x, top, z + len / 2, width, thick, len, COLORS.windBlade),
    ];
  }

  // The solar panels: SOLAR.rows thin slabs in rows across the footprint, each one step higher than the last.
  function solarPanels(s, base) {
    const { rows, thick, lift, step, fill } = SOLAR;
    const band = s.h / rows;
    const out = [];
    for (let i = 0; i < rows; i++) {
      const y = base + lift + i * step + thick / 2;
      out.push(place(cx(s), y, s.y + (i + 0.5) * band, s.w * fill, thick, band * fill, COLORS.solarPanel));
    }
    return out;
  }

  // The dam: a concrete block across the footprint (along x), with a blue water slab on its north side.
  function dam(s, base) {
    const { depth, height } = HYDRO.dam;
    const wall = place(cx(s), base + height / 2, cz(s), s.w, height, depth, COLORS.concrete);
    const reach = (s.h - depth) / 2; // the water's depth, between the north edge and the dam
    const water = place(cx(s), base + HYDRO.water.height / 2, s.y + reach / 2, s.w, HYDRO.water.height, reach, COLORS.water);
    return [[SHAPES.BLOCK, wall], [SHAPES.SLAB, water]];
  }

  // The dome of the fusion plant: FUSION.dome.steps blocks stacked on `top`, each one `shrink` fraction smaller.
  function dome(s, top) {
    const { steps, step, shrink } = FUSION.dome;
    const out = [];
    let y = top;
    for (let i = 0; i < steps; i++) {
      const k = 1 - (i + 1) * shrink;
      out.push([SHAPES.BLOCK, place(cx(s), y + step / 2, cz(s), s.w * k, step, s.h * k, COLORS.fusionDome)]);
      y += step;
    }
    return out;
  }

  return Object.freeze({
    [GENRE.GAS](s, base) {
      const b = body(s, base, GAS.height, COLORS.gas);
      return [[SHAPES.BLOCK, b.p], ...gasStacks(s, b.top).map((p) => [SHAPES.BLOCK, p])];
    },
    [GENRE.OIL](s, base) {
      const b = body(s, base, OIL.height, COLORS.oil);
      return [[SHAPES.BLOCK, b.p], [SHAPES.BLOCK, cornerStack(s, b.top, OIL.stack, COLORS.chimney)]];
    },
    [GENRE.WIND](s, base) {
      const { width, height } = WIND.mast;
      const mast = place(cx(s), base + height / 2, cz(s), width, height, width, COLORS.windMast);
      return [[SHAPES.SLAB, mast], ...bladesOn(s, base + height).map((p) => [SHAPES.SLAB, p])];
    },
    [GENRE.SOLAR](s, base) {
      return solarPanels(s, base).map((p) => [SHAPES.SLAB, p]);
    },
    [GENRE.HYDRO](s, base) {
      return dam(s, base);
    },
    [GENRE.MICROWAVE](s, base) {
      const { height, inset, stand, dish } = MICROWAVE;
      const b = body(s, base, height, COLORS.microwave, inset);
      const post = place(cx(s), b.top + stand.height / 2, cz(s), stand.width, stand.height, stand.width, COLORS.dish);
      const top = b.top + stand.height;
      const disc = place(cx(s), top + dish.thick / 2, cz(s), s.w - 2 * dish.inset, dish.thick, s.h - 2 * dish.inset, COLORS.dish);
      return [[SHAPES.BLOCK, b.p], [SHAPES.SLAB, post], [SHAPES.SLAB, disc]];
    },
    [GENRE.FUSION](s, base) {
      const b = body(s, base, FUSION.height, COLORS.fusion);
      return [[SHAPES.BLOCK, b.p], ...dome(s, b.top)];
    },
  });
}
