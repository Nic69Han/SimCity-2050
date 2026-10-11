//! Port of `generate.cpp` (and `generate.h`): terrain generation.
//!
//! Covers `generateMap`, `generateSomeCity`, islands, lakes, rivers, trees and
//! shoreline smoothing. The order of random draws is that of the C++ original,
//! so the same seed and terrain options give the same map tile by tile.
//!
//! Notes on fidelity (see also the core README):
//!
//! * World size: the C++ uses `WORLD_W`/`WORLD_H` (120x100). Here the runtime
//!   [`Simulation::world_size`] is used; for 120x100 results are identical.
//! * Overloads get distinct names: `generateMap()` is [`Simulation::generate_map`],
//!   `generateMap(int)` is [`Simulation::generate_map_seed`]; likewise
//!   `smoothTreesAt` is [`Simulation::smooth_trees_at`] and its `ToolEffects`
//!   variant is [`Simulation::smooth_trees_at_effects`].
//! * `Position::move` quirks: the terrain random walks depend on the original
//!   `Position::move` (see [`cpp_move`]), which differs from
//!   [`Position::step`]. The original behaviour is reproduced here locally;
//!   `position.rs` is left unchanged.
//! * Argument evaluation order: `Position(pos, getRandom(12)-6, getRandom(12)-6)`
//!   leaves the order unspecified in C++. The oracle is built with GCC on
//!   x86-64, which evaluates the last argument first; [`Simulation::make_single_lake`]
//!   does the same.
//! * `ToolEffects`: the tool module owns that type. The `ToolEffects` variant of
//!   `smoothTreesAt` is written against the [`MapEdits`] trait; the plain variant
//!   collects its single write in [`TileEdits`]. `ToolEffects::modifyWorld` also
//!   calls `spend(0)`, which leaves funds unchanged, and `updateFunds`, which is
//!   front-end only, so neither is performed here.
//! * Front-end callbacks: `callback("didGenerateMap")` becomes
//!   [`Event::NewCity`] (redraw everything).

use crate::events::Event;
use crate::position::{Direction, Position};
use crate::simulation::{Scenario, Simulation};
use crate::tile::{Tile, BLBNBIT, BULLBIT, LOMASK};
use crate::tile_chars::{
    CHANNEL, DIRT, REDGE, RIVER, TILE_INVALID, WATER_HIGH, WATER_LOW, WOODS, WOODS_HIGH, WOODS_LOW,
};

/// The default radius of an island, used by the terrain generator (`generate.h`).
const ISLAND_RADIUS: i16 = 18;

/// `DIR2_NORTH` ... `DIR2_NORTH_WEST` in order, for `DIR2_NORTH + getRandom(7)`.
const COMPASS: [Direction; 8] = [
    Direction::North,
    Direction::NorthEast,
    Direction::East,
    Direction::SouthEast,
    Direction::South,
    Direction::SouthWest,
    Direction::West,
    Direction::NorthWest,
];

/// Cardinal directions in the order of `DIR2_BEGIN` .. `DIR2_END` stepped by
/// `increment90`.
const CARDINALS: [Direction; 4] = [
    Direction::North,
    Direction::East,
    Direction::South,
    Direction::West,
];

/// Neighbour offsets `dx`/`dy` used by `smoothRiver` and `smoothTreesAt`.
const DX: [i32; 4] = [-1, 0, 1, 0];
const DY: [i32; 4] = [0, 1, 0, -1];

/// Big river blob, indexed `[y][x]` as in the original.
const BR_MATRIX: [[Tile; 9]; 9] = [
    [0, 0, 0, REDGE, REDGE, REDGE, 0, 0, 0],
    [0, 0, REDGE, RIVER, RIVER, RIVER, REDGE, 0, 0],
    [0, REDGE, RIVER, RIVER, RIVER, RIVER, RIVER, REDGE, 0],
    [
        REDGE, RIVER, RIVER, RIVER, RIVER, RIVER, RIVER, RIVER, REDGE,
    ],
    [
        REDGE, RIVER, RIVER, RIVER, CHANNEL, RIVER, RIVER, RIVER, REDGE,
    ],
    [
        REDGE, RIVER, RIVER, RIVER, RIVER, RIVER, RIVER, RIVER, REDGE,
    ],
    [0, REDGE, RIVER, RIVER, RIVER, RIVER, RIVER, REDGE, 0],
    [0, 0, REDGE, RIVER, RIVER, RIVER, REDGE, 0, 0],
    [0, 0, 0, REDGE, REDGE, REDGE, 0, 0, 0],
];

/// Small river blob, indexed `[y][x]` as in the original.
const SR_MATRIX: [[Tile; 6]; 6] = [
    [0, 0, REDGE, REDGE, 0, 0],
    [0, REDGE, RIVER, RIVER, REDGE, 0],
    [REDGE, RIVER, RIVER, RIVER, RIVER, REDGE],
    [REDGE, RIVER, RIVER, RIVER, RIVER, REDGE],
    [0, REDGE, RIVER, RIVER, REDGE, 0],
    [0, 0, REDGE, REDGE, 0, 0],
];

/// Shoreline lookup for `smoothRiver`, indexed by the 4-bit neighbourhood.
const RED_TAB: [Tile; 16] = [
    13 | BULLBIT,
    13 | BULLBIT,
    17 | BULLBIT,
    15 | BULLBIT,
    5 | BULLBIT,
    2,
    19 | BULLBIT,
    17 | BULLBIT,
    9 | BULLBIT,
    11 | BULLBIT,
    2,
    13 | BULLBIT,
    7 | BULLBIT,
    9 | BULLBIT,
    5 | BULLBIT,
    2,
];

/// Tree lookup for `smoothTreesAt`, indexed by the 4-bit neighbourhood.
const TREE_TABLE: [Tile; 16] = [0, 0, 0, 34, 0, 0, 36, 35, 0, 32, 0, 33, 30, 31, 29, 37];

/// Write access to map values with the semantics of `ToolEffects`: reads see
/// the pending writes first, then the world.
pub trait MapEdits {
    fn map_value(&self, sim: &Simulation, x: i32, y: i32) -> Tile;
    fn set_map_value(&mut self, x: i32, y: i32, value: Tile);
}

/// Pending writes applied to the world at once, in the spirit of `ToolEffects`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TileEdits {
    edits: Vec<(i32, i32, Tile)>,
}

impl TileEdits {
    /// Write all pending values into the world; a later write wins.
    pub fn apply(self, sim: &mut Simulation) {
        for (x, y, value) in self.edits {
            sim.map_set(x, y, value);
        }
    }
}

impl MapEdits for TileEdits {
    fn map_value(&self, sim: &Simulation, x: i32, y: i32) -> Tile {
        match self.edits.iter().rev().find(|e| e.0 == x && e.1 == y) {
            Some(e) => e.2,
            None => sim.map_get(x, y),
        }
    }

    fn set_map_value(&mut self, x: i32, y: i32, value: Tile) {
        self.edits.push((x, y, value));
    }
}

/// Port of the original `Position::move` (position.cpp), kept here for the
/// terrain generator, whose random walks depend on its exact behaviour.
///
/// Differences from [`Position::step`]:
/// * `NORTH_EAST` has no `break` in the original. When the diagonal is blocked
///   it falls through into `EAST` and moves east if it can.
/// * `SOUTH_WEST` always moves (x-1, y+1) and then clamps into the world; it
///   never refuses the move.
/// * Other blocked moves leave the position unchanged apart from clamping.
///
/// Returns whether the move was made, as the original does.
fn cpp_move(pos: &mut Position, dir: Direction, w: i32, h: i32) -> bool {
    let (x, y) = (pos.x, pos.y);
    let (dx, dy, moved) = match dir {
        Direction::Invalid => return true,
        Direction::North => (0, -1, y > 0),
        Direction::NorthEast if x < w - 1 && y > 0 => (1, -1, true),
        Direction::NorthEast | Direction::East => (1, 0, x < w - 1),
        Direction::SouthEast => (1, 1, x < w - 1 && y < h - 1),
        Direction::South => (0, 1, y < h - 1),
        Direction::SouthWest => (-1, 1, false),
        Direction::West => (-1, 0, x > 0),
        Direction::NorthWest => (-1, -1, x > 0 && y > 0),
    };
    let mut nx = x;
    let mut ny = y;
    if moved || dir == Direction::SouthWest {
        nx += dx;
        ny += dy;
    }
    pos.x = nx.clamp(0, w - 1);
    pos.y = ny.clamp(0, h - 1);
    moved
}

fn is_water(tile: Tile) -> bool {
    (WATER_LOW..=WATER_HIGH).contains(&tile)
}

fn is_woods(tile: Tile) -> bool {
    (WOODS_LOW..=WOODS_HIGH).contains(&tile)
}

impl Simulation {
    /// Map cell at a world position, as `map[x][y]`. The position must be on the map.
    #[inline]
    fn map_get(&self, x: i32, y: i32) -> Tile {
        debug_assert!(self.on_map(x, y));
        let (_, h) = self.world_size();
        self.tiles[x as usize * h as usize + y as usize]
    }

    /// Store into `map[x][y]`. The position must be on the map.
    #[inline]
    fn map_set(&mut self, x: i32, y: i32, value: Tile) {
        debug_assert!(self.on_map(x, y));
        let (_, h) = self.world_size();
        self.tiles[x as usize * h as usize + y as usize] = value;
    }

    /// Port of `generateMap()`: a new map from a seed drawn from the generator.
    pub fn generate_map(&mut self) {
        let seed = self.rng.random16();
        self.generate_some_city(seed);
    }

    /// Port of `generateSomeCity(int seed)`: generate terrain and set up a new city.
    pub fn generate_some_city(&mut self, seed: i32) {
        // cityFileName = "" has no counterpart: no file name is kept in the core.
        self.generate_map_seed(seed);
        self.scenario = Scenario::None;
        self.city_time = 0;
        self.init_sim_load = 2;
        self.do_initial_eval = false;

        // `initWillStuff` begins with `randomlySeedRandom()`. The oracle patch makes
        // that reseed from env `MICROPOLIS_SEED`, which the oracle sets to `seed`, so
        // the port reseeds with `seed` here (there is no environment in the core).
        self.rng.seed(seed);
        self.init_will_stuff();
        self.reset_map_state();
        self.reset_editor_state();
        self.invalidate_maps();
        self.update_funds();
        self.do_sim_init();

        self.sim_update();

        self.push_event(Event::NewCity);
    }

    /// A new random city, as the original reaches it: a fresh engine (the
    /// constructor's `simInit`) followed by `generateSomeCity(seed)`. Disasters
    /// stay as `simInit` sets them (on); callers choose the other settings.
    ///
    /// The engine is rebuilt first, so the city depends only on `seed` and never on what the
    /// engine held before (only the start year survives).
    pub fn new_random_city(&mut self, seed: i32) {
        let (w, h) = self.world_size();
        let starting_year = self.starting_year;
        *self = Simulation::new(w, h);
        self.starting_year = starting_year;
        self.sim_init();
        self.generate_some_city(seed);
    }

    /// Port of `generateMap(int seed)`: lay out the terrain from `seed`.
    pub fn generate_map_seed(&mut self, seed: i32) {
        self.generated_city_seed = seed;

        self.rng.seed(seed);

        // Construct land.
        if self.terrain_create_island < 0 && self.rng.random(100) < 10 {
            // Chance that an island is generated.
            self.make_island();
            return;
        }

        if self.terrain_create_island == 1 {
            self.make_naked_island();
        } else {
            self.clear_map();
        }

        // Lay a river.
        if self.terrain_curve_level != 0 {
            let (w, h) = self.world_size();
            let terrain_x_start = 40 + i32::from(self.rng.random((w - 80) as i16));
            let terrain_y_start = 33 + i32::from(self.rng.random((h - 67) as i16));
            self.do_rivers(Position::new(terrain_x_start, terrain_y_start));
        }

        // Lay a few lakes.
        if self.terrain_lake_level != 0 {
            self.make_lakes();
        }

        self.smooth_river();

        // And add trees.
        if self.terrain_tree_level != 0 {
            self.do_trees();
        }
    }

    /// Port of `clearMap()`: the whole world becomes `DIRT`.
    pub fn clear_map(&mut self) {
        self.tiles.fill(DIRT);
    }

    /// Port of `clearUnnatural()`: everything above `WOODS` becomes `DIRT`.
    pub fn clear_unnatural(&mut self) {
        for t in self.tiles.iter_mut() {
            if *t > WOODS {
                *t = DIRT;
            }
        }
    }

    /// Port of `makeNakedIsland()`: a plain island surrounded by river.
    pub fn make_naked_island(&mut self) {
        let (w, h) = self.world_size();

        for x in 0..w {
            for y in 0..h {
                let edge = x < 5 || x >= w - 5 || y < 5 || y >= h - 5;
                self.map_set(x, y, if edge { RIVER } else { DIRT });
            }
        }

        let mut x = 0;
        while x < w - 5 {
            let mut map_y = i32::from(self.rng.erandom(ISLAND_RADIUS));
            self.plop_b_river(Position::new(x, map_y));

            map_y = (h - 10) - i32::from(self.rng.erandom(ISLAND_RADIUS));
            self.plop_b_river(Position::new(x, map_y));

            self.plop_s_river(Position::new(x, 0));
            self.plop_s_river(Position::new(x, h - 6));
            x += 2;
        }

        let mut y = 0;
        while y < h - 5 {
            let mut map_x = i32::from(self.rng.erandom(ISLAND_RADIUS));
            self.plop_b_river(Position::new(map_x, y));

            map_x = (w - 10) - i32::from(self.rng.erandom(ISLAND_RADIUS));
            self.plop_b_river(Position::new(map_x, y));

            self.plop_s_river(Position::new(0, y));
            self.plop_s_river(Position::new(w - 6, y));
            y += 2;
        }
    }

    /// Port of `makeIsland()`: construct a new world as an island.
    pub fn make_island(&mut self) {
        self.make_naked_island();
        self.smooth_river();
        self.do_trees();
    }

    /// Port of `makeLakes()`: a number of lakes, depending on `terrainLakeLevel`.
    pub fn make_lakes(&mut self) {
        let (w, h) = self.world_size();

        let mut num_lakes: i16 = if self.terrain_lake_level < 0 {
            self.rng.random(10)
        } else {
            (self.terrain_lake_level / 2) as i16
        };

        while num_lakes > 0 {
            let x = i32::from(self.rng.random((w - 21) as i16)) + 10;
            let y = i32::from(self.rng.random((h - 20) as i16)) + 10;

            self.make_single_lake(Position::new(x, y));

            num_lakes -= 1;
        }
    }

    /// Port of `makeSingleLake(const Position &pos)`.
    pub fn make_single_lake(&mut self, pos: Position) {
        let mut num_plops = i32::from(self.rng.random(12)) + 2;

        while num_plops > 0 {
            // `Position(pos, getRandom(12) - 6, getRandom(12) - 6)`: GCC evaluates
            // the last argument first, so the y offset is drawn before the x offset.
            let dy = i32::from(self.rng.random(12)) - 6;
            let dx = i32::from(self.rng.random(12)) - 6;
            let plop_pos = pos.offset(dx, dy);

            if self.rng.random(4) != 0 {
                self.plop_s_river(plop_pos);
            } else {
                self.plop_b_river(plop_pos);
            }

            num_plops -= 1;
        }
    }

    /// Port of `treeSplash(short xloc, short yloc)`: splash trees around a point.
    ///
    /// The C++ `treePos.testBounds()` check after `move()` never fails because
    /// `move()` clamps into the world; it is kept for fidelity.
    pub fn tree_splash(&mut self, xloc: i32, yloc: i32) {
        let (w, h) = self.world_size();

        let mut num_trees: i16 = if self.terrain_tree_level < 0 {
            self.rng.random(150) + 50
        } else {
            self.rng.random((100 + self.terrain_tree_level * 2) as i16) + 50
        };

        let mut tree_pos = Position::new(xloc, yloc);

        while num_trees > 0 {
            let dir = COMPASS[self.rng.random(7) as usize];
            cpp_move(&mut tree_pos, dir, w, h);

            if !self.on_map(tree_pos.x, tree_pos.y) {
                return;
            }

            if self.map_get(tree_pos.x, tree_pos.y) & LOMASK == DIRT {
                self.map_set(tree_pos.x, tree_pos.y, WOODS | BLBNBIT);
            }

            num_trees -= 1;
        }
    }

    /// Port of `doTrees()`: splash trees around the world, then smooth them.
    pub fn do_trees(&mut self) {
        let (w, h) = self.world_size();

        let amount: i16 = if self.terrain_tree_level < 0 {
            self.rng.random(100) + 50
        } else {
            (self.terrain_tree_level + 3) as i16
        };

        for _ in 0..amount {
            let xloc = i32::from(self.rng.random((w - 1) as i16));
            let yloc = i32::from(self.rng.random((h - 1) as i16));
            self.tree_splash(xloc, yloc);
        }

        self.smooth_trees();
        self.smooth_trees();
    }

    /// Port of `smoothRiver()`: give river edges the right shape, in place.
    pub fn smooth_river(&mut self) {
        let (w, h) = self.world_size();

        for x in 0..w {
            for y in 0..h {
                if self.map_get(x, y) != REDGE {
                    continue;
                }

                let mut bit_index = 0usize;
                for z in 0..4 {
                    bit_index <<= 1;
                    let x_temp = x + DX[z];
                    let y_temp = y + DY[z];
                    if self.on_map(x_temp, y_temp) {
                        let t = self.map_get(x_temp, y_temp) & LOMASK;
                        if t != DIRT && !is_woods(t) {
                            bit_index += 1;
                        }
                    }
                }

                let mut temp = RED_TAB[bit_index & 15];

                if temp != RIVER && self.rng.random(1) != 0 {
                    temp += 1;
                }

                self.map_set(x, y, temp);
            }
        }
    }

    /// Port of `isTree(MapValue)`.
    pub fn is_tree(cell: Tile) -> bool {
        is_woods(cell & LOMASK)
    }

    /// Port of `smoothTrees()`: smooth every tree in the world.
    pub fn smooth_trees(&mut self) {
        let (w, h) = self.world_size();
        for x in 0..w {
            for y in 0..h {
                if Self::is_tree(self.map_get(x, y)) {
                    self.smooth_trees_at(x, y, false);
                }
            }
        }
    }

    /// Port of `smoothTreesAt(int x, int y, bool preserve)`.
    ///
    /// The original goes through a `ToolEffects` object and calls `modifyWorld()`
    /// afterwards; see the module notes for what that call does here.
    pub fn smooth_trees_at(&mut self, x: i32, y: i32, preserve: bool) {
        let mut edits = TileEdits::default();
        self.smooth_trees_at_effects(x, y, preserve, &mut edits);
        edits.apply(self);
    }

    /// Port of `smoothTreesAt(int x, int y, bool preserve, ToolEffects *effects)`.
    pub fn smooth_trees_at_effects<E: MapEdits>(
        &self,
        x: i32,
        y: i32,
        preserve: bool,
        effects: &mut E,
    ) {
        if !Self::is_tree(effects.map_value(self, x, y)) {
            return;
        }

        let mut bit_index = 0usize;
        for z in 0..4 {
            bit_index <<= 1;
            let x_temp = x + DX[z];
            let y_temp = y + DY[z];
            if self.on_map(x_temp, y_temp) && Self::is_tree(effects.map_value(self, x_temp, y_temp))
            {
                bit_index += 1;
            }
        }

        let mut temp = TREE_TABLE[bit_index & 15];
        if temp != 0 {
            if temp != WOODS && ((x + y) & 1) != 0 {
                temp -= 8;
            }
            effects.set_map_value(x, y, temp | BLBNBIT);
        } else if !preserve {
            effects.set_map_value(x, y, temp);
        }
    }

    /// Port of `doRivers(const Position &terrainPos)`.
    pub fn do_rivers(&mut self, terrain_pos: Position) {
        let mut river_dir = Direction::North.rotate45(self.rng.random(3) as i32 * 2);
        self.do_b_river(terrain_pos, river_dir, river_dir);

        river_dir = river_dir.rotate180();
        let terrain_dir = self.do_b_river(terrain_pos, river_dir, river_dir);

        river_dir = Direction::North.rotate45(self.rng.random(3) as i32 * 2);
        self.do_s_river(terrain_pos, river_dir, terrain_dir);
    }

    /// Curve rates for the river walks: `(rate1, rate2)`.
    fn river_rates(&self) -> (i16, i16) {
        if self.terrain_curve_level < 0 {
            (100, 200)
        } else {
            (
                (self.terrain_curve_level + 10) as i16,
                (self.terrain_curve_level + 100) as i16,
            )
        }
    }

    /// Shared body of `doBRiver` and `doSRiver`: walk from `river_pos`, plopping
    /// blobs while the walk stays `margin` tiles inside the world.
    fn walk_river(
        &mut self,
        river_pos: Position,
        river_dir: Direction,
        mut terrain_dir: Direction,
        margin: i32,
        big: bool,
    ) -> Direction {
        let (rate1, rate2) = self.river_rates();
        let (w, h) = self.world_size();
        let mut pos = river_pos;

        while self.on_map(pos.x + margin, pos.y + margin) {
            if big {
                self.plop_b_river(pos);
            } else {
                self.plop_s_river(pos);
            }

            if self.rng.random(rate1) < 10 {
                terrain_dir = river_dir;
            } else {
                if self.rng.random(rate2) > 90 {
                    terrain_dir = terrain_dir.rotate45(1);
                }
                if self.rng.random(rate2) > 90 {
                    terrain_dir = terrain_dir.rotate45(7);
                }
            }
            cpp_move(&mut pos, terrain_dir, w, h);
        }

        terrain_dir
    }

    /// Port of `doBRiver(const Position &riverPos, Direction2 riverDir, Direction2 terrainDir)`.
    /// Returns the last used local terrain direction.
    pub fn do_b_river(
        &mut self,
        river_pos: Position,
        river_dir: Direction,
        terrain_dir: Direction,
    ) -> Direction {
        self.walk_river(river_pos, river_dir, terrain_dir, 4, true)
    }

    /// Port of `doSRiver(const Position &riverPos, Direction2 riverDir, Direction2 terrainDir)`.
    /// Returns the last used local terrain direction.
    pub fn do_s_river(
        &mut self,
        river_pos: Position,
        river_dir: Direction,
        terrain_dir: Direction,
    ) -> Direction {
        self.walk_river(river_pos, river_dir, terrain_dir, 3, false)
    }

    /// Port of `putOnMap(MapValue mChar, short xLoc, short yLoc)`.
    pub fn put_on_map(&mut self, m_char: Tile, x: i32, y: i32) {
        if m_char == 0 {
            return;
        }

        if !self.on_map(x, y) {
            return;
        }

        let mut temp = self.map_get(x, y);

        if temp != DIRT {
            temp &= LOMASK;
            if temp == RIVER && m_char != CHANNEL {
                return;
            }
            if temp == CHANNEL {
                return;
            }
        }
        self.map_set(x, y, m_char);
    }

    /// Port of `plopBRiver(const Position &pos)`: a big diamond-shaped river blob.
    #[allow(clippy::needless_range_loop)] // Loop order kept as in the C++ (x outer).
    pub fn plop_b_river(&mut self, pos: Position) {
        for x in 0..9 {
            for y in 0..9 {
                self.put_on_map(BR_MATRIX[y][x], pos.x + x as i32, pos.y + y as i32);
            }
        }
    }

    /// Port of `plopSRiver(const Position &pos)`: a small diamond-shaped river blob.
    #[allow(clippy::needless_range_loop)] // Loop order kept as in the C++ (x outer).
    pub fn plop_s_river(&mut self, pos: Position) {
        for x in 0..6 {
            for y in 0..6 {
                self.put_on_map(SR_MATRIX[y][x], pos.x + x as i32, pos.y + y as i32);
            }
        }
    }

    /// Port of `smoothWater()`.
    ///
    /// Not called by any other C++ code. Its neighbour lookups use the traffic
    /// module's `getTileFromMap`, so this is not yet validated by tests.
    pub fn smooth_water(&mut self) {
        let (w, h) = self.world_size();

        // First pass: water next to a non-water tile becomes a river edge.
        for x in 0..w {
            for y in 0..h {
                let tile = self.map_get(x, y) & LOMASK;
                if is_water(tile) {
                    let pos = Position::new(x, y);
                    for dir in CARDINALS {
                        // Off-map counts as water (default WATER_LOW).
                        let t = self.get_tile_from_map(pos, dir, WATER_LOW);
                        if !is_water(t) {
                            self.map_set(x, y, REDGE);
                            break;
                        }
                    }
                }
            }
        }

        // Second pass: water that is not a channel and is surrounded by water becomes river.
        for x in 0..w {
            for y in 0..h {
                let tile = self.map_get(x, y) & LOMASK;
                if tile != CHANNEL && is_water(tile) {
                    let pos = Position::new(x, y);
                    let mut make_river = true;
                    for dir in CARDINALS {
                        let t = self.get_tile_from_map(pos, dir, WATER_LOW);
                        if !is_water(t) {
                            make_river = false;
                            break;
                        }
                    }
                    if make_river {
                        self.map_set(x, y, RIVER);
                    }
                }
            }
        }

        // Third pass: woods next to a river or channel become river edge.
        for x in 0..w {
            for y in 0..h {
                let tile = self.map_get(x, y) & LOMASK;
                if is_woods(tile) {
                    let pos = Position::new(x, y);
                    for dir in CARDINALS {
                        let t = self.get_tile_from_map(pos, dir, TILE_INVALID as Tile);
                        if t == RIVER || t == CHANNEL {
                            self.map_set(x, y, REDGE);
                            break;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpp_move_north_east_falls_through_to_east_on_top_row() {
        let mut p = Position::new(5, 0);
        assert!(cpp_move(&mut p, Direction::NorthEast, 10, 10));
        assert_eq!(p, Position::new(6, 0));
        // Interior: a real diagonal step.
        let mut p = Position::new(5, 5);
        assert!(cpp_move(&mut p, Direction::NorthEast, 10, 10));
        assert_eq!(p, Position::new(6, 4));
        // Right edge: blocked, no fall-through possible.
        let mut p = Position::new(9, 3);
        assert!(!cpp_move(&mut p, Direction::NorthEast, 10, 10));
        assert_eq!(p, Position::new(9, 3));
    }

    #[test]
    fn cpp_move_south_west_moves_then_clamps() {
        let mut p = Position::new(5, 5);
        assert!(!cpp_move(&mut p, Direction::SouthWest, 10, 10));
        assert_eq!(p, Position::new(4, 6));
        // Left edge: x moves to -1 and is clamped back to 0, y still advances.
        let mut p = Position::new(0, 5);
        cpp_move(&mut p, Direction::SouthWest, 10, 10);
        assert_eq!(p, Position::new(0, 6));
        // Bottom edge: y moves to 10 and is clamped to 9.
        let mut p = Position::new(5, 9);
        cpp_move(&mut p, Direction::SouthWest, 10, 10);
        assert_eq!(p, Position::new(4, 9));
    }

    #[test]
    fn cpp_move_other_directions_clamp_in_place() {
        let mut p = Position::new(0, 0);
        assert!(!cpp_move(&mut p, Direction::NorthWest, 10, 10));
        assert_eq!(p, Position::new(0, 0));
        let mut p = Position::new(9, 0);
        assert!(!cpp_move(&mut p, Direction::North, 10, 10));
        assert_eq!(p, Position::new(9, 0));
        let mut p = Position::new(3, 9);
        assert!(cpp_move(&mut p, Direction::West, 10, 10));
        assert_eq!(p, Position::new(2, 9));
    }

    #[test]
    fn tree_table_and_shore_table_are_as_in_the_original() {
        assert_eq!(TREE_TABLE[15], WOODS);
        assert_eq!(RED_TAB[5], RIVER);
        assert_eq!(RED_TAB[0], 13 | BULLBIT);
    }

    #[test]
    fn river_blob_shapes() {
        assert_eq!(BR_MATRIX[4][4], CHANNEL);
        assert_eq!(SR_MATRIX[2][0], REDGE);
        assert_eq!(SR_MATRIX[0][0], 0);
    }

    #[test]
    fn clear_unnatural_keeps_natural_tiles() {
        let mut s = Simulation::new(4, 4);
        s.tiles.fill(WOODS + 1);
        s.tiles[0] = WOODS;
        s.tiles[1] = RIVER;
        s.clear_unnatural();
        assert_eq!(s.tiles[0], WOODS);
        assert_eq!(s.tiles[1], RIVER);
        assert_eq!(s.tiles[2], DIRT);
    }

    #[test]
    fn is_tree_uses_low_bits() {
        assert!(Simulation::is_tree(WOODS | BULLBIT));
        assert!(!Simulation::is_tree(DIRT));
    }

    #[test]
    fn tile_edits_last_write_wins() {
        let s = Simulation::new(4, 4);
        let mut e = TileEdits::default();
        e.set_map_value(1, 1, 7);
        e.set_map_value(1, 1, 9);
        assert_eq!(e.map_value(&s, 1, 1), 9);
        assert_eq!(e.map_value(&s, 0, 0), 0);
    }
}
