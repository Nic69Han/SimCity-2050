// 3D rewards and special deals (genres 50-54 and 60-63, docs/game-design-v12.md): the mayor's house, city hall,
// statue, courthouse and arch (rewards); casino, state prison, toxic dump and missile base (special deals). Built
// from the same blocks and slabs as the other structures: a mayor's house (white block, red roof), city hall (wide
// stone block, central tower, front columns), statue (stone base, obelisk figure), courthouse (stone block, front
// columns, flat roof), arch (two pillars, a lintel), casino (purple block, gold roof), state prison (dark block,
// low wall), toxic dump (green mound, yellow barrels), missile base (sand slab, tall silos). Heights in world units,
// footprints in tiles. The shared helpers come from the model file through `rewardBuilders(h)`, so this module
// imports nothing and there is no import cycle.

export const MAYOR = Object.freeze({ height: 0.6, roof: 0.08 }); // white block, red roof slab
export const HALL = Object.freeze({
  height: 0.7, inset: 0.15, columns: 4, column: 0.12, // wide stone block, HALL.columns thin columns in front
  tower: Object.freeze({ fraction: 0.3, height: 1.4 }), // central tower, a fraction of the footprint's sides
});
export const STATUE = Object.freeze({ base: 0.12, figure: Object.freeze({ width: 0.3, height: 1.1 }) });
export const COURTHOUSE = Object.freeze({
  height: 0.5, inset: 0.2, columns: 4, column: 0.12, columnHeight: 0.6, roof: 0.08, // columns rise to the roof slab
});
export const ARCH = Object.freeze({ pillar: Object.freeze({ width: 0.25, height: 1.4 }), lintel: 0.15 });
export const CASINO = Object.freeze({ height: 0.8, roof: 0.08 }); // purple block, gold roof slab
export const STATE_PRISON = Object.freeze({
  height: 0.9, inset: 0.5, wall: Object.freeze({ height: 0.3, thick: 0.1 }), // dark block, low wall around the yard
});
export const TOXIC_DUMP = Object.freeze({
  mound: 0.12, barrel: Object.freeze({ width: 0.22, height: 0.3 }),
  // Barrel centres as fractions of the footprint (kept inside it); one yellow block each.
  barrels: Object.freeze([[0.2, 0.25], [0.7, 0.3], [0.35, 0.7], [0.8, 0.75]]),
});
export const MISSILE_BASE = Object.freeze({
  sand: 0.06, silo: Object.freeze({ width: 0.25, height: 1.3 }),
  // Silo centres as fractions of the footprint (kept inside it); one grey block each.
  silos: Object.freeze([[0.25, 0.3], [0.75, 0.3], [0.5, 0.7]]),
});

// The colours of genres 50-54 and 60-63, merged into COLORS by the model file.
export const REWARD_COLORS = Object.freeze({
  mayorWall: "#fafafa", mayorRoof: "#b71c1c",
  hallStone: "#b9b4a8", hallColumn: "#e6e1d6", hallTower: "#9c978b",
  courtStone: "#c9c3b5", courtColumn: "#ebe7dc", courtRoof: "#5d4037",
  archStone: "#e4dfd2",
  casinoPurple: "#7b1fa2", casinoGold: "#ffd54f",
  statePrison: "#2b2b2b", statePrisonWall: "#546e7a",
  toxicMound: "#a3c44a", toxicBarrel: "#fdd835",
  missileSand: "#d7c49e", silo: "#8e9399",
});

// The builders of genres 50-54 and 60-63. `h` holds the model's GENRE, SHAPES, COLORS and its helpers place, body,
// cx and cz (the others it passes are not needed here).
export function rewardBuilders(h) {
  const { GENRE, SHAPES, COLORS, place, body, cx, cz } = h;

  // `count` thin square columns in a row along the front (north) edge, standing on `base`, `height` tall.
  // They are spread evenly across the width and stay inside the footprint.
  function frontColumns(s, base, height, count, width, hex) {
    return Array.from({ length: count }, (_, i) => {
      const x = s.x + ((i + 0.5) * s.w) / count;
      return [SHAPES.SLAB, place(x, base + height / 2, s.y + width / 2, width, height, width, hex)];
    });
  }

  // The central tower of city hall: a block on `top`, HALL.tower.fraction of the footprint's sides.
  function tower(s, top) {
    const { fraction, height } = HALL.tower;
    const w = s.w * fraction, d = s.h * fraction;
    return [SHAPES.BLOCK, place(cx(s), top + height / 2, cz(s), w, height, d, COLORS.hallTower)];
  }

  // The low wall around a yard: four thin slabs on the edges of the footprint, standing on `base`.
  function yardWalls(s, base) {
    const { height, thick } = STATE_PRISON.wall;
    const y = base + height / 2;
    const hex = COLORS.statePrisonWall;
    return [
      [SHAPES.SLAB, place(cx(s), y, s.y + thick / 2, s.w, height, thick, hex)],
      [SHAPES.SLAB, place(cx(s), y, s.y + s.h - thick / 2, s.w, height, thick, hex)],
      [SHAPES.SLAB, place(s.x + thick / 2, y, cz(s), thick, height, s.h, hex)],
      [SHAPES.SLAB, place(s.x + s.w - thick / 2, y, cz(s), thick, height, s.h, hex)],
    ];
  }

  // The two pillars of the arch, at the west and east edges, standing on `base`.
  function archPillars(s, base) {
    const { width, height } = ARCH.pillar;
    const y = base + height / 2, z = cz(s);
    return [
      [SHAPES.BLOCK, place(s.x + width / 2, y, z, width, height, width, COLORS.archStone)],
      [SHAPES.BLOCK, place(s.x + s.w - width / 2, y, z, width, height, width, COLORS.archStone)],
    ];
  }

  // The lintel across the top of the pillars, from edge to edge, standing on `top`.
  function lintel(s, top) {
    const { pillar, lintel: thick } = ARCH;
    return [SHAPES.SLAB, place(cx(s), top + thick / 2, cz(s), s.w, thick, pillar.width, COLORS.archStone)];
  }

  // The barrels of the toxic dump, standing on the mound top; each centre is a fraction of the footprint.
  function barrels(s, top) {
    const { width, height } = TOXIC_DUMP.barrel;
    return TOXIC_DUMP.barrels.map(([fx, fz]) =>
      [SHAPES.BLOCK, place(s.x + fx * s.w, top + height / 2, s.y + fz * s.h, width, height, width, COLORS.toxicBarrel)]);
  }

  // The silos of the missile base, standing on the sand top; each centre is a fraction of the footprint.
  function silos(s, top) {
    const { width, height } = MISSILE_BASE.silo;
    return MISSILE_BASE.silos.map(([fx, fz]) =>
      [SHAPES.BLOCK, place(s.x + fx * s.w, top + height / 2, s.y + fz * s.h, width, height, width, COLORS.silo)]);
  }

  return Object.freeze({
    [GENRE.MAYOR_HOUSE](s, base) {
      const b = body(s, base, MAYOR.height, COLORS.mayorWall);
      const roof = body(s, b.top, MAYOR.roof, COLORS.mayorRoof);
      return [[SHAPES.BLOCK, b.p], [SHAPES.SLAB, roof.p]];
    },
    [GENRE.CITY_HALL](s, base) {
      const b = body(s, base, HALL.height, COLORS.hallStone, HALL.inset);
      const columns = frontColumns(s, base, HALL.height, HALL.columns, HALL.column, COLORS.hallColumn);
      return [[SHAPES.BLOCK, b.p], ...columns, tower(s, b.top)];
    },
    [GENRE.STATUE](s, base) {
      const b = body(s, base, STATUE.base, COLORS.stone);
      const { width, height } = STATUE.figure;
      const figure = place(cx(s), b.top + height / 2, cz(s), width, height, width, COLORS.obelisk);
      return [[SHAPES.BLOCK, b.p], [SHAPES.OBELISK, figure]];
    },
    [GENRE.COURTHOUSE](s, base) {
      const { height, inset, columns, column, columnHeight, roof } = COURTHOUSE;
      const b = body(s, base, height, COLORS.courtStone, inset);
      const cols = frontColumns(s, base, columnHeight, columns, column, COLORS.courtColumn);
      const top = body(s, base + columnHeight, roof, COLORS.courtRoof);
      return [[SHAPES.BLOCK, b.p], ...cols, [SHAPES.SLAB, top.p]];
    },
    [GENRE.ARCH](s, base) {
      const { height } = ARCH.pillar;
      return [...archPillars(s, base), lintel(s, base + height)];
    },
    [GENRE.CASINO](s, base) {
      const b = body(s, base, CASINO.height, COLORS.casinoPurple);
      const roof = body(s, b.top, CASINO.roof, COLORS.casinoGold);
      return [[SHAPES.BLOCK, b.p], [SHAPES.SLAB, roof.p]];
    },
    [GENRE.STATE_PRISON](s, base) {
      const b = body(s, base, STATE_PRISON.height, COLORS.statePrison, STATE_PRISON.inset);
      return [[SHAPES.BLOCK, b.p], ...yardWalls(s, base)];
    },
    [GENRE.TOXIC_DUMP](s, base) {
      const mound = body(s, base, TOXIC_DUMP.mound, COLORS.toxicMound);
      return [[SHAPES.SLAB, mound.p], ...barrels(s, mound.top)];
    },
    [GENRE.MISSILE_BASE](s, base) {
      const sand = body(s, base, MISSILE_BASE.sand, COLORS.missileSand);
      return [[SHAPES.SLAB, sand.p], ...silos(s, sand.top)];
    },
  });
}
