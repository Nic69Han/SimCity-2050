//! Port of `tool.cpp` and of the `ToolEffects` / `BuildingProperties` classes
//! of `tool.h`: the player's building tools.
//!
//! Every tool first collects its changes in a [`ToolEffects`] (the world
//! modifications and the cost). Only when the tool succeeds and the funds
//! cover the cost are the effects copied to the world, so a failed attempt
//! leaves the city untouched.
//!
//! Front-end plumbing is dropped, as described in `ARCHITECTURE.md`:
//! `FrontendMessage` objects (sounds and `didTool` notices), the `callback`
//! calls (`didTool`, `showZoneStatus`), and the messages `toolDown` sends for
//! "bulldoze first" and "not enough funds". `toolDown` returns the result
//! instead, so the adapter can show the matching message. `invalidateMaps`
//! keeps its state change (`mapSerial`), the front-end update is dropped.
//! `doZoneStatus` returns its status as [`ZoneStatus`] instead of a callback.
//!
//! Functions owned by other modules (`connectTile`, `isTree`,
//! `smoothTreesAt`) are reached through the shims in `shim_tool.rs`.
//! `spend` and `updateFunds` are inlined in [`ToolEffects::modify_world`]: they
//! set `total_funds` and push [`Event::FundsChanged`].
//!
//! Coordinates are `i32` rather than the original `short`, and the world size
//! is the runtime size of the [`Simulation`] instead of the `WORLD_W` /
//! `WORLD_H` constants. For the default 120x100 world the results are the same.

use std::collections::BTreeMap;

use crate::events::Event;
use crate::position::Position;
use crate::rng::Rng;
use crate::simulation::Simulation;
use crate::tile::*;

/// Tool result (`enum ToolResult` in `micropolis.h`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ToolResult {
    /// User has not enough money for the tool.
    NoMoney = -2,
    /// Clear the area first.
    NeedBulldoze = -1,
    /// Cannot build here.
    Failed = 0,
    /// The tool succeeded.
    Ok = 1,
}

/// Connect tile commands (`enum ConnectTileCommand` in `micropolis.h`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectTileCommand {
    /// Fix the zone (connect wire, road and rail).
    Fix,
    /// Bulldoze and fix the zone.
    Bulldoze,
    /// Lay road and fix the zone.
    Road,
    /// Lay rail and fix the zone.
    Railroad,
    /// Lay wire and fix the zone.
    Wire,
}

/// Available tools (`enum EditingTool` in `micropolis.h`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum EditingTool {
    Residential = 0,
    Commercial,
    Industrial,
    FireStation,
    PoliceStation,
    Query,
    Wire,
    Bulldozer,
    Railroad,
    Road,
    Stadium,
    Park,
    Seaport,
    CoalPower,
    NuclearPower,
    Airport,
    Network,
    Water,
    Land,
    Forest,
}

/// Number of tools (`TOOL_COUNT`).
pub const TOOL_COUNT: usize = 20;

impl EditingTool {
    /// All tools, in the order of the original `EditingTool` enum.
    pub const ALL: [EditingTool; TOOL_COUNT] = [
        EditingTool::Residential,
        EditingTool::Commercial,
        EditingTool::Industrial,
        EditingTool::FireStation,
        EditingTool::PoliceStation,
        EditingTool::Query,
        EditingTool::Wire,
        EditingTool::Bulldozer,
        EditingTool::Railroad,
        EditingTool::Road,
        EditingTool::Stadium,
        EditingTool::Park,
        EditingTool::Seaport,
        EditingTool::CoalPower,
        EditingTool::NuclearPower,
        EditingTool::Airport,
        EditingTool::Network,
        EditingTool::Water,
        EditingTool::Land,
        EditingTool::Forest,
    ];

    /// The tool with the given index, as in the original `EditingTool` enum.
    pub fn from_index(index: i32) -> Option<Self> {
        usize::try_from(index)
            .ok()
            .and_then(|i| Self::ALL.get(i).copied())
    }

    /// Cost of using the tool, in dollars (`gCostOf`).
    pub fn cost(self) -> i32 {
        COST_OF[self as usize]
    }

    /// Size of the tool's building, in tiles per side (`gToolSize`): 1, 3, 4 or 6.
    pub fn size(self) -> i32 {
        TOOL_SIZE[self as usize]
    }

    /// Stable ASCII identifier of the tool, for the adapters and the page.
    pub fn key(self) -> &'static str {
        match self {
            EditingTool::Residential => "residential",
            EditingTool::Commercial => "commercial",
            EditingTool::Industrial => "industrial",
            EditingTool::FireStation => "fire_station",
            EditingTool::PoliceStation => "police_station",
            EditingTool::Query => "query",
            EditingTool::Wire => "wire",
            EditingTool::Bulldozer => "bulldozer",
            EditingTool::Railroad => "railroad",
            EditingTool::Road => "road",
            EditingTool::Stadium => "stadium",
            EditingTool::Park => "park",
            EditingTool::Seaport => "seaport",
            EditingTool::CoalPower => "coal_power",
            EditingTool::NuclearPower => "nuclear_power",
            EditingTool::Airport => "airport",
            EditingTool::Network => "network",
            EditingTool::Water => "water",
            EditingTool::Land => "land",
            EditingTool::Forest => "forest",
        }
    }

    /// Tiles covered as `(x0, y0, w, h)` when the tool is used at `(x, y)`.
    ///
    /// A building of size `s > 1` is laid out from its top-left tile
    /// `(x - 1, y - 1)` (see `build_building`), so it covers `s x s` tiles
    /// starting there; its zone centre is the tile `(x, y)`. Tools of size 1
    /// cover the single tile `(x, y)`.
    pub fn footprint(self, x: i32, y: i32) -> (i32, i32, i32, i32) {
        match self.size() {
            s if s > 1 => (x - 1, y - 1, s, s),
            _ => (x, y, 1, 1),
        }
    }
}

/// Result of [`Simulation::tool_preview`]: what `tool_down` would return, and
/// the total the tool would charge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolPreview {
    /// The result `tool_down` would return.
    pub result: ToolResult,
    /// The total cost the tool would charge; 0 unless `result` is [`ToolResult::Ok`].
    pub cost: i32,
}

/// Cost of each tool, indexed by [`EditingTool`] (`gCostOf`).
const COST_OF: [i32; TOOL_COUNT + 1] = [
    100, 100, 100, 500, // res, com, ind, fire
    500, 0, 5, 1, // police, query, wire, bulldozer
    20, 10, 5000, 10, // rail, road, stadium, park
    3000, 3000, 5000, 10000, // seaport, coal, nuclear, airport
    100, 0, 0, 0, // network, water, land, forest
    0,
];

/// Size of each tool's building, indexed by [`EditingTool`] (`gToolSize`).
/// Tools larger than 1 are not dragged.
const TOOL_SIZE: [i32; TOOL_COUNT + 1] = [
    3, 3, 3, 3, //
    3, 1, 1, 1, //
    1, 1, 4, 1, //
    4, 4, 4, 6, //
    1, 1, 1, 1, //
    0,
];

/// Offsets of the eight neighbours, used by `putDownForest`.
const NEIGHBOUR_DX: [i32; 8] = [-1, 0, 1, -1, 1, -1, 0, 1];
const NEIGHBOUR_DY: [i32; 8] = [-1, -1, -1, 0, 0, 1, 1, 1];

/// String-table indices of the density categories (`STR202_*` in `text.h`).
const STR202_POPULATIONDENSITY_LOW: i32 = 0;
const STR202_LANDVALUE_SLUM: i32 = 4;
const STR202_LANDVALUE_LOWER_CLASS: i32 = 5;
const STR202_LANDVALUE_MIDDLE_CLASS: i32 = 6;
const STR202_LANDVALUE_HIGH_CLASS: i32 = 7;
const STR202_CRIME_NONE: i32 = 8;
const STR202_POLLUTION_NONE: i32 = 12;
const STR202_GROWRATE_DECLINING: i32 = 16;
const STR202_GROWRATE_STABLE: i32 = 17;
const STR202_GROWRATE_SLOWGROWTH: i32 = 18;
const STR202_GROWRATE_FASTGROWTH: i32 = 19;

/// Properties of a building with respect to its construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuildingProperties {
    /// Number of tiles in the horizontal direction.
    pub size_x: i32,
    /// Number of tiles in the vertical direction.
    pub size_y: i32,
    /// Tile value at the top-left corner of the building.
    pub base_tile: Tile,
    /// Tool needed to make the building.
    pub tool: EditingTool,
    /// Name of the tool, used for the `didTool` notice.
    pub tool_name: &'static str,
    /// The building has animated tiles.
    pub building_is_animated: bool,
}

pub const RESIDENTIAL_ZONE_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 3,
    size_y: 3,
    base_tile: RESBASE,
    tool: EditingTool::Residential,
    tool_name: "Res",
    building_is_animated: false,
};

pub const COMMERCIAL_ZONE_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 3,
    size_y: 3,
    base_tile: COMBASE,
    tool: EditingTool::Commercial,
    tool_name: "Com",
    building_is_animated: false,
};

pub const INDUSTRIAL_ZONE_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 3,
    size_y: 3,
    base_tile: INDBASE,
    tool: EditingTool::Industrial,
    tool_name: "Ind",
    building_is_animated: false,
};

pub const POLICE_STATION_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 3,
    size_y: 3,
    base_tile: POLICESTBASE,
    tool: EditingTool::PoliceStation,
    tool_name: "Pol",
    building_is_animated: false,
};

pub const FIRE_STATION_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 3,
    size_y: 3,
    base_tile: FIRESTBASE,
    tool: EditingTool::FireStation,
    tool_name: "Fire",
    building_is_animated: false,
};

pub const STADIUM_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 4,
    size_y: 4,
    base_tile: STADIUMBASE,
    tool: EditingTool::Stadium,
    tool_name: "Stad",
    building_is_animated: false,
};

pub const COAL_POWER_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 4,
    size_y: 4,
    base_tile: COALBASE,
    tool: EditingTool::CoalPower,
    tool_name: "Coal",
    building_is_animated: false,
};

pub const NUCLEAR_POWER_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 4,
    size_y: 4,
    base_tile: NUCLEARBASE,
    tool: EditingTool::NuclearPower,
    tool_name: "Nuc",
    building_is_animated: true,
};

pub const SEAPORT_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 4,
    size_y: 4,
    base_tile: PORTBASE,
    tool: EditingTool::Seaport,
    tool_name: "Seap",
    building_is_animated: false,
};

pub const AIRPORT_BUILDING: BuildingProperties = BuildingProperties {
    size_x: 6,
    size_y: 6,
    base_tile: AIRPORTBASE,
    tool: EditingTool::Airport,
    tool_name: "Airp",
    building_is_animated: false,
};

/// Density categories reported by [`Simulation::do_zone_status`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ZoneStatus {
    /// String index of the category of the tile (`tileCategory`).
    pub category: i32,
    /// String indices of population density, land value, crime rate,
    /// pollution and growth rate, in that order.
    pub status: [i32; 5],
}

/// Set of modifications of the world, with the cost of making them.
///
/// Tools do not change the world directly. They record their changes here, so
/// the cost can be known before the funds are checked, and an unaffordable
/// change leaves the world as it was. Reads take earlier modifications into
/// account, so stacked tools see each other's changes.
#[derive(Debug, Clone, Default)]
pub struct ToolEffects {
    /// Accumulated cost.
    cost: i32,
    /// Collected world modifications, by position.
    modifications: BTreeMap<Position, Tile>,
}

impl ToolEffects {
    /// Empty effects (`ToolEffects(Micropolis *)`).
    pub fn new() -> Self {
        Self::default()
    }

    /// Discard all effects (`clear`).
    pub fn clear(&mut self) {
        self.cost = 0;
        self.modifications.clear();
    }

    /// Copy the effects to the world and spend the cost (`modifyWorld`).
    /// The effects are cleared afterwards.
    pub fn modify_world(&mut self, sim: &mut Simulation) {
        // spend(cost) -> setFunds(totalFunds - cost) -> updateFunds()
        sim.total_funds -= i64::from(self.cost);
        let funds = sim.total_funds;
        sim.push_event(Event::FundsChanged(funds));

        for (pos, value) in &self.modifications {
            sim.set_tile(pos.x, pos.y, *value);
        }
        self.clear();
    }

    /// Apply the effects only if the funds cover the cost
    /// (`modifyIfEnoughFunding`). Otherwise the effects are kept.
    pub fn modify_if_enough_funding(&mut self, sim: &mut Simulation) -> bool {
        if !self.is_affordable(sim) {
            return false;
        }
        self.modify_world(sim);
        true
    }

    /// Do the funds of `sim` cover the accumulated cost?
    pub fn is_affordable(&self, sim: &Simulation) -> bool {
        sim.total_funds >= i64::from(self.cost)
    }

    /// Value of a map position, with the earlier modifications applied
    /// (`getMapValue`). The position must be on the map.
    pub fn get_map_value(&self, sim: &Simulation, x: i32, y: i32) -> Tile {
        match self.modifications.get(&Position::new(x, y)) {
            Some(value) => *value,
            None => sim
                .tile(x, y)
                .expect("tool effects read a position outside the world"),
        }
    }

    /// Tile character of a map position (`getMapTile`), without the status bits.
    pub fn get_map_tile(&self, sim: &Simulation, x: i32, y: i32) -> Tile {
        self.get_map_value(sim, x, y) & LOMASK
    }

    /// Total cost collected so far (`getCost`).
    pub fn get_cost(&self) -> i32 {
        self.cost
    }

    /// Add to the total cost (`addCost`).
    pub fn add_cost(&mut self, amount: i32) {
        debug_assert!(amount >= 0, "costs are never negative");
        self.cost += amount;
    }

    /// Record a new map value (`setMapValue`).
    pub fn set_map_value(&mut self, x: i32, y: i32, value: Tile) {
        self.modifications.insert(Position::new(x, y), value);
    }
}

/// `checkBigZone`: the zone size and the offset of its centre, for a tile
/// that is not a zone centre. Returns `(size, delta_h, delta_v)`; size 0
/// means the tile is not part of a known multi-tile zone.
fn check_big_zone(id: Tile) -> (i32, i32, i32) {
    // (tile, size, delta_h, delta_v); table of the cases of the C++ switch.
    const BIG_ZONES: &[(Tile, i32, i32, i32)] = &[
        (POWERPLANT, 4, 0, 0),
        (PORT, 4, 0, 0),
        (NUCLEAR, 4, 0, 0),
        (STADIUM, 4, 0, 0),
        (POWERPLANT + 1, 4, -1, 0),
        (COALSMOKE3, 4, -1, 0),
        (COALSMOKE3 + 1, 4, -1, 0),
        (COALSMOKE3 + 2, 4, -1, 0),
        (PORT + 1, 4, -1, 0),
        (NUCLEAR + 1, 4, -1, 0),
        (STADIUM + 1, 4, -1, 0),
        (POWERPLANT + 4, 4, 0, -1),
        (PORT + 4, 4, 0, -1),
        (NUCLEAR + 4, 4, 0, -1),
        (STADIUM + 4, 4, 0, -1),
        (POWERPLANT + 5, 4, -1, -1),
        (PORT + 5, 4, -1, -1),
        (NUCLEAR + 5, 4, -1, -1),
        (STADIUM + 5, 4, -1, -1),
        (AIRPORT, 6, 0, 0),
        (AIRPORT + 1, 6, -1, 0),
        (AIRPORT + 2, 6, -2, 0),
        (AIRPORT + 3, 6, -3, 0),
        (AIRPORT + 6, 6, 0, -1),
        (AIRPORT + 7, 6, -1, -1),
        (AIRPORT + 8, 6, -2, -1),
        (AIRPORT + 9, 6, -3, -1),
        (AIRPORT + 12, 6, 0, -2),
        (AIRPORT + 13, 6, -1, -2),
        (AIRPORT + 14, 6, -2, -2),
        (AIRPORT + 15, 6, -3, -2),
        (AIRPORT + 18, 6, 0, -3),
        (AIRPORT + 19, 6, -1, -3),
        (AIRPORT + 20, 6, -2, -3),
        (AIRPORT + 21, 6, -3, -3),
    ];
    for &(tile, size, dh, dv) in BIG_ZONES {
        if tile == id {
            return (size, dh, dv);
        }
    }
    (0, 0, 0)
}

/// `Micropolis::tally` helper: is `v` within `lo..=hi`?
fn within(v: i32, lo: Tile, hi: Tile) -> bool {
    (i32::from(lo)..=i32::from(hi)).contains(&v)
}

impl Simulation {
    /// Can a tile be auto-bulldozed? (`tally`)
    pub fn tally(&self, tile_value: i32) -> bool {
        within(tile_value, FIRSTRIVEDGE, LASTRUBBLE)
            || within(tile_value, POWERBASE + 2, POWERBASE + 12)
            || within(tile_value, TINYEXP, LASTTINYEXP + 2)
    }

    /// Size of the zone that a tile belongs to, 0 if unknown (`checkSize`).
    pub fn check_size(&self, tile_value: i32) -> i32 {
        // Normal 3x3 zones, fire and police departments, churches.
        if within(tile_value, RESBASE - 1, PORTBASE - 1)
            || within(tile_value, LASTPOWERPLANT + 1, POLICESTATION + 4)
            || within(tile_value, CHURCH1BASE, CHURCH7LAST)
        {
            return 3;
        }
        // Seaport, power plants, stadium.
        if within(tile_value, PORTBASE, LASTPORT)
            || within(tile_value, COALBASE, LASTPOWERPLANT)
            || within(tile_value, STADIUMBASE, LASTZONE)
        {
            return 4;
        }
        0
    }

    /// Check and connect the tiles around a new zone (`checkBorder`).
    fn check_border(
        &self,
        x_map: i32,
        y_map: i32,
        size_x: i32,
        size_y: i32,
        effects: &mut ToolEffects,
    ) {
        // Upper row, left column, bottom row, right column.
        for cnt in 0..size_x {
            self.connect_tile(x_map + cnt, y_map - 1, ConnectTileCommand::Fix, effects);
        }
        for cnt in 0..size_y {
            self.connect_tile(x_map - 1, y_map + cnt, ConnectTileCommand::Fix, effects);
        }
        for cnt in 0..size_x {
            self.connect_tile(
                x_map + cnt,
                y_map + size_y,
                ConnectTileCommand::Fix,
                effects,
            );
        }
        for cnt in 0..size_y {
            self.connect_tile(
                x_map + size_x,
                y_map + cnt,
                ConnectTileCommand::Fix,
                effects,
            );
        }
    }

    /// Lay out a building, with its top-left tile at `(left_x, top_y)`.
    /// Tiles are numbered in row order (the `baseTile++` loop).
    #[allow(clippy::too_many_arguments)]
    fn put_building(
        &self,
        left_x: i32,
        top_y: i32,
        size_x: i32,
        size_y: i32,
        base_tile: Tile,
        ani_flag: bool,
        effects: &mut ToolEffects,
    ) {
        let mut base = base_tile;
        for dy in 0..size_y {
            let pos_y = top_y + dy;
            for dx in 0..size_x {
                let pos_x = left_x + dx;
                let mut tile_value = base | BNCNBIT;
                if dx == 1 {
                    if dy == 1 {
                        tile_value |= ZONEBIT;
                    } else if dy == 2 && ani_flag {
                        tile_value |= ANIMBIT;
                    }
                }
                effects.set_map_value(pos_x, pos_y, tile_value);
                base = base.wrapping_add(1);
            }
        }
    }

    /// Check a site and auto-bulldoze it (`prepareBuildingSite`). All changes
    /// go to `effects`.
    fn prepare_building_site(
        &self,
        left_x: i32,
        top_y: i32,
        size_x: i32,
        size_y: i32,
        effects: &mut ToolEffects,
    ) -> ToolResult {
        // The whole site must be on the map.
        let (world_w, world_h) = self.world_size();
        if !(0..=(world_w - size_x)).contains(&left_x) {
            return ToolResult::Failed;
        }
        if !(0..=(world_h - size_y)).contains(&top_y) {
            return ToolResult::Failed;
        }

        // Every tile must be clear, or be cleared by the auto-bulldozer.
        for dy in 0..size_y {
            let pos_y = top_y + dy;
            for dx in 0..size_x {
                let pos_x = left_x + dx;
                let tile_value = effects.get_map_tile(self, pos_x, pos_y);
                if tile_value == DIRT {
                    continue;
                }
                if !self.auto_bulldoze {
                    return ToolResult::NeedBulldoze;
                }
                if !self.tally(i32::from(tile_value)) {
                    return ToolResult::NeedBulldoze;
                }
                effects.set_map_value(pos_x, pos_y, DIRT);
                effects.add_cost(COST_OF[EditingTool::Bulldozer as usize]);
            }
        }
        ToolResult::Ok
    }

    /// Build a building whose centre tile is `(map_h, map_v)` (`buildBuilding`).
    fn build_building(
        &self,
        map_h: i32,
        map_v: i32,
        props: &BuildingProperties,
        effects: &mut ToolEffects,
    ) -> ToolResult {
        // Move the position to the top-left tile.
        let map_h = map_h - 1;
        let map_v = map_v - 1;

        let prepare = self.prepare_building_site(map_h, map_v, props.size_x, props.size_y, effects);
        if prepare != ToolResult::Ok {
            return prepare;
        }

        effects.add_cost(COST_OF[props.tool as usize]);
        self.put_building(
            map_h,
            map_v,
            props.size_x,
            props.size_y,
            props.base_tile,
            props.building_is_animated,
            effects,
        );
        self.check_border(map_h, map_v, props.size_x, props.size_y, effects);
        ToolResult::Ok
    }

    /// Density category text index for a tile (`getDensity`).
    /// `cat_no`: 0 population, 1 land value, 2 crime, 3 pollution, 4 growth.
    pub fn get_density(&self, cat_no: i32, map_h: i32, map_v: i32) -> i32 {
        match cat_no {
            1 => {
                let z = i32::from(self.land_value_map.world_get(map_h, map_v));
                if z < 30 {
                    STR202_LANDVALUE_SLUM
                } else if z < 80 {
                    STR202_LANDVALUE_LOWER_CLASS
                } else if z < 150 {
                    STR202_LANDVALUE_MIDDLE_CLASS
                } else {
                    STR202_LANDVALUE_HIGH_CLASS
                }
            }
            2 => {
                let z = i32::from(self.crime_rate_map.world_get(map_h, map_v));
                ((z >> 6) & 3) + STR202_CRIME_NONE
            }
            3 => {
                let z = i32::from(self.pollution_density_map.world_get(map_h, map_v));
                if (1..64).contains(&z) {
                    return 13;
                }
                ((z >> 6) & 3) + STR202_POLLUTION_NONE
            }
            4 => {
                let z = i32::from(self.rate_of_growth_map.world_get(map_h, map_v));
                if z < 0 {
                    STR202_GROWRATE_DECLINING
                } else if z == 0 {
                    STR202_GROWRATE_STABLE
                } else if z > 100 {
                    STR202_GROWRATE_FASTGROWTH
                } else {
                    STR202_GROWRATE_SLOWGROWTH
                }
            }
            // Case 0 and the default: population density.
            _ => {
                let z = i32::from(self.population_density_map.world_get(map_h, map_v));
                ((z >> 6) & 3) + STR202_POPULATIONDENSITY_LOW
            }
        }
    }

    /// Status report for the tile at `(map_h, map_v)` (`doZoneStatus`).
    /// `None` if the position is off the map.
    pub fn do_zone_status(&self, map_h: i32, map_v: i32) -> Option<ZoneStatus> {
        let mut tile_num = i32::from(self.tile(map_h, map_v)? & LOMASK);

        if (i32::from(COALSMOKE1)..i32::from(FOOTBALLGAME1)).contains(&tile_num) {
            tile_num = i32::from(COALBASE);
        }

        // Category: the last `idArray` entry that is not above the tile.
        // Index 0 of the table is never used (the search starts at 1).
        const ID_ARRAY: [i32; 29] = [
            DIRT as i32,
            RIVER as i32,
            TREEBASE as i32,
            RUBBLE as i32,
            FLOOD as i32,
            RADTILE as i32,
            FIRE as i32,
            ROADBASE as i32,
            POWERBASE as i32,
            RAILBASE as i32,
            RESBASE as i32,
            COMBASE as i32,
            INDBASE as i32,
            PORTBASE as i32,
            AIRPORTBASE as i32,
            COALBASE as i32,
            FIRESTBASE as i32,
            POLICESTBASE as i32,
            STADIUMBASE as i32,
            NUCLEARBASE as i32,
            HBRDG0 as i32,
            RADAR0 as i32,
            FOUNTAIN as i32,
            INDBASE2 as i32,
            FOOTBALLGAME1 as i32,
            VBRDG0 as i32,
            NUKESWIRL1 as i32,
            CHURCH1BASE as i32,
            9999, // a huge short
        ];
        let mut i: usize = 1;
        while i < 29 {
            if tile_num < ID_ARRAY[i] {
                break;
            }
            i += 1;
        }
        let mut i = i as i32 - 1;
        // The original breaks on DIRT here (the category is out of range).
        if !(1..=28).contains(&i) {
            i = 28;
        }
        let tile_category = i + 1;

        let mut status = [0i32; 5];
        for (cat, slot) in status.iter_mut().enumerate() {
            *slot = (self.get_density(cat as i32, map_h, map_v) + 1).clamp(1, 20);
        }
        Some(ZoneStatus {
            category: tile_category,
            status,
        })
    }

    /// Make a `size` x `size` square of rubble with its top-left tile at `(x, y)`
    /// (`putRubble`). Dirt and radioactive waste are left alone; the other
    /// tiles become tiny explosions (animated when `do_animation` is set).
    fn put_rubble(&self, x: i32, y: i32, size: i32, effects: &mut ToolEffects, rng: &mut Rng) {
        for xx in x..x + size {
            for yy in y..y + size {
                if self.on_map(xx, yy) {
                    let mut tile = effects.get_map_tile(self, xx, yy);
                    if tile != RADTILE && tile != DIRT {
                        tile = if self.do_animation {
                            TINYEXP + (rng.random(2) as Tile)
                        } else {
                            SOMETINYEXP
                        };
                        effects.set_map_value(xx, yy, tile | ANIMBIT | BULLBIT);
                    }
                }
            }
        }
    }

    /// Query tool (`queryTool`). The status is available from
    /// [`Simulation::do_zone_status`].
    pub fn query_tool(&self, x: i32, y: i32) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        let _status = self.do_zone_status(x, y);
        ToolResult::Ok
    }

    /// Bulldozer tool, applied to the world directly (`bulldozerTool(x, y)`).
    ///
    /// The original does not check the funds for this overload, so the cost is
    /// spent even when it is more than the funds. The adapter should use
    /// [`Simulation::do_tool`] for player actions. This entry point is used by
    /// the sprites.
    pub fn bulldozer_tool(&mut self, x: i32, y: i32) -> ToolResult {
        let mut effects = ToolEffects::new();
        let mut rng = self.rng.clone();
        let result = self.bulldozer_tool_effects(x, y, &mut effects, &mut rng);
        self.rng = rng;
        if result == ToolResult::Ok {
            effects.modify_world(self);
        }
        result
    }

    /// Bulldozer tool, recorded in `effects` (`bulldozerTool(x, y, effects)`).
    pub fn bulldozer_tool_effects(
        &self,
        x: i32,
        y: i32,
        effects: &mut ToolEffects,
        rng: &mut Rng,
    ) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }

        let map_val = effects.get_map_value(self, x, y);
        let tile = map_val & LOMASK;

        // Zone centre: the size comes from the tile. Other tiles of a big zone:
        // the centre is found from the offset table.
        let (zone_size, delta_h, delta_v) = if (map_val & ZONEBIT) != 0 {
            (self.check_size(i32::from(tile)), 0, 0)
        } else {
            check_big_zone(tile)
        };

        if zone_size > 0 {
            effects.add_cost(COST_OF[EditingTool::Bulldozer as usize]);

            let center_x = x + delta_h;
            let center_y = y + delta_v;
            match zone_size {
                3 | 4 | 6 => self.put_rubble(center_x - 1, center_y - 1, zone_size, effects, rng),
                _ => unreachable!("zone sizes are 3, 4 or 6"),
            }
            return ToolResult::Ok;
        }

        if tile == RIVER || tile == REDGE || tile == CHANNEL {
            let result = self.connect_tile(x, y, ConnectTileCommand::Bulldoze, effects);
            // Bulldozing water costs extra, since it changed.
            if tile != effects.get_map_tile(self, x, y) {
                effects.add_cost(5);
            }
            result
        } else {
            self.connect_tile(x, y, ConnectTileCommand::Bulldoze, effects)
        }
    }

    /// Road tool (`roadTool`).
    pub fn road_tool(&self, x: i32, y: i32, effects: &mut ToolEffects) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        self.connect_tile(x, y, ConnectTileCommand::Road, effects)
    }

    /// Rail tool (`railroadTool`).
    pub fn railroad_tool(&self, x: i32, y: i32, effects: &mut ToolEffects) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        self.connect_tile(x, y, ConnectTileCommand::Railroad, effects)
    }

    /// Wire tool (`wireTool`).
    pub fn wire_tool(&self, x: i32, y: i32, effects: &mut ToolEffects) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        self.connect_tile(x, y, ConnectTileCommand::Wire, effects)
    }

    /// Park tool (`parkTool`).
    pub fn park_tool(
        &self,
        x: i32,
        y: i32,
        effects: &mut ToolEffects,
        rng: &mut Rng,
    ) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        self.put_down_park(x, y, effects, rng)
    }

    /// Put a park on a dirt tile (`putDownPark`).
    fn put_down_park(
        &self,
        map_h: i32,
        map_v: i32,
        effects: &mut ToolEffects,
        rng: &mut Rng,
    ) -> ToolResult {
        // The random number is drawn before the tile is checked, as in the original.
        let value = rng.random(4);
        let mut tile: Tile = BURNBIT | BULLBIT;
        if value == 4 {
            tile |= FOUNTAIN | ANIMBIT;
        } else {
            tile |= (value as Tile) + WOODS2;
        }

        // The whole value, status bits included, must be DIRT.
        if effects.get_map_value(self, map_h, map_v) != DIRT {
            return ToolResult::NeedBulldoze;
        }

        effects.add_cost(COST_OF[EditingTool::Park as usize]);
        effects.set_map_value(map_h, map_v, tile);
        ToolResult::Ok
    }

    /// Network tool (`networkTool`).
    pub fn network_tool(&self, x: i32, y: i32, effects: &mut ToolEffects) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        self.put_down_network(x, y, effects)
    }

    /// Lay a telecom network tile (`putDownNetwork`).
    fn put_down_network(&self, map_h: i32, map_v: i32, effects: &mut ToolEffects) -> ToolResult {
        let mut tile = effects.get_map_tile(self, map_h, map_v);

        // Auto-bulldoze an area that can be cleared.
        if tile != DIRT && self.tally(i32::from(tile)) {
            effects.add_cost(COST_OF[EditingTool::Bulldozer as usize]);
            effects.set_map_value(map_h, map_v, DIRT);
            tile = DIRT;
        }

        if tile != DIRT {
            return ToolResult::NeedBulldoze;
        }

        effects.set_map_value(
            map_h,
            map_v,
            TELEBASE | CONDBIT | BURNBIT | BULLBIT | ANIMBIT,
        );
        effects.add_cost(COST_OF[EditingTool::Network as usize]);
        ToolResult::Ok
    }

    /// Water tool (`waterTool`).
    pub fn water_tool(
        &self,
        x: i32,
        y: i32,
        effects: &mut ToolEffects,
        rng: &mut Rng,
    ) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        let mut result = self.bulldozer_tool_effects(x, y, effects, rng);
        if result == ToolResult::Ok {
            result = self.put_down_water(x, y, effects);
        }
        result
    }

    /// Lay water (`putDownWater`).
    fn put_down_water(&self, map_h: i32, map_v: i32, effects: &mut ToolEffects) -> ToolResult {
        let tile = effects.get_map_tile(self, map_h, map_v);
        if tile == RIVER {
            return ToolResult::Failed;
        }
        effects.set_map_value(map_h, map_v, RIVER);
        effects.add_cost(COST_OF[EditingTool::Water as usize]);
        ToolResult::Ok
    }

    /// Land tool (`landTool`). The bulldozer result is not checked: the tile
    /// is made dirt regardless, as in the original.
    pub fn land_tool(
        &self,
        x: i32,
        y: i32,
        effects: &mut ToolEffects,
        rng: &mut Rng,
    ) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }
        self.bulldozer_tool_effects(x, y, effects, rng);
        self.put_down_land(x, y, effects)
    }

    /// Lay dirt (`putDownLand`).
    fn put_down_land(&self, map_h: i32, map_v: i32, effects: &mut ToolEffects) -> ToolResult {
        let tile = effects.get_map_tile(self, map_h, map_v);
        if tile == DIRT {
            return ToolResult::Failed;
        }
        effects.set_map_value(map_h, map_v, DIRT);
        effects.add_cost(COST_OF[EditingTool::Land as usize]);
        ToolResult::Ok
    }

    /// Forest tool (`forestTool`).
    pub fn forest_tool(
        &self,
        x: i32,
        y: i32,
        effects: &mut ToolEffects,
        rng: &mut Rng,
    ) -> ToolResult {
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }

        let mut tile = effects.get_map_value(self, x, y);
        if Self::is_tree(tile) {
            return ToolResult::Ok;
        }

        // The bulldozer result is replaced below, as in the original.
        if (tile & LOMASK) != DIRT {
            self.bulldozer_tool_effects(x, y, effects, rng);
        }

        tile = effects.get_map_value(self, x, y);
        if tile == DIRT {
            self.put_down_forest(x, y, effects)
        } else {
            ToolResult::Failed
        }
    }

    /// Plant a forest (`putDownForest`).
    fn put_down_forest(&self, map_h: i32, map_v: i32, effects: &mut ToolEffects) -> ToolResult {
        effects.set_map_value(map_h, map_v, WOODS | BLBNBIT);

        for (dx, dy) in NEIGHBOUR_DX.iter().zip(NEIGHBOUR_DY.iter()) {
            let xx = map_h + dx;
            let yy = map_v + dy;
            if self.on_map(xx, yy) {
                self.smooth_trees_at_effects(xx, yy, true, effects);
            }
        }

        effects.add_cost(COST_OF[EditingTool::Forest as usize]);
        ToolResult::Ok
    }

    /// Planning step of a tool (the `switch` of `doTool`). Records the changes
    /// and the cost in `effects` and returns the result before the funds check.
    /// The world is only read; the random numbers drawn come from `rng`, so a
    /// caller decides whether the draws are kept.
    fn plan_tool(
        &self,
        tool: EditingTool,
        tile_x: i32,
        tile_y: i32,
        rng: &mut Rng,
        effects: &mut ToolEffects,
    ) -> ToolResult {
        match tool {
            EditingTool::Residential => {
                self.build_building(tile_x, tile_y, &RESIDENTIAL_ZONE_BUILDING, effects)
            }
            EditingTool::Commercial => {
                self.build_building(tile_x, tile_y, &COMMERCIAL_ZONE_BUILDING, effects)
            }
            EditingTool::Industrial => {
                self.build_building(tile_x, tile_y, &INDUSTRIAL_ZONE_BUILDING, effects)
            }
            EditingTool::FireStation => {
                self.build_building(tile_x, tile_y, &FIRE_STATION_BUILDING, effects)
            }
            EditingTool::PoliceStation => {
                self.build_building(tile_x, tile_y, &POLICE_STATION_BUILDING, effects)
            }
            EditingTool::Query => self.query_tool(tile_x, tile_y),
            EditingTool::Wire => self.wire_tool(tile_x, tile_y, effects),
            EditingTool::Bulldozer => self.bulldozer_tool_effects(tile_x, tile_y, effects, rng),
            EditingTool::Railroad => self.railroad_tool(tile_x, tile_y, effects),
            EditingTool::Road => self.road_tool(tile_x, tile_y, effects),
            EditingTool::Stadium => self.build_building(tile_x, tile_y, &STADIUM_BUILDING, effects),
            EditingTool::Park => self.park_tool(tile_x, tile_y, effects, rng),
            EditingTool::Seaport => self.build_building(tile_x, tile_y, &SEAPORT_BUILDING, effects),
            EditingTool::CoalPower => {
                self.build_building(tile_x, tile_y, &COAL_POWER_BUILDING, effects)
            }
            EditingTool::NuclearPower => {
                self.build_building(tile_x, tile_y, &NUCLEAR_POWER_BUILDING, effects)
            }
            EditingTool::Airport => self.build_building(tile_x, tile_y, &AIRPORT_BUILDING, effects),
            EditingTool::Network => self.network_tool(tile_x, tile_y, effects),
            EditingTool::Water => self.water_tool(tile_x, tile_y, effects, rng),
            EditingTool::Land => self.land_tool(tile_x, tile_y, effects, rng),
            EditingTool::Forest => self.forest_tool(tile_x, tile_y, effects, rng),
        }
    }

    /// Result of a planned tool once its cost is known: a successful plan
    /// that the funds do not cover becomes [`ToolResult::NoMoney`]. `Query`
    /// charges nothing.
    fn charged_result(
        &self,
        tool: EditingTool,
        planned: ToolResult,
        effects: &ToolEffects,
    ) -> ToolResult {
        if planned == ToolResult::Ok && tool != EditingTool::Query && !effects.is_affordable(self) {
            ToolResult::NoMoney
        } else {
            planned
        }
    }

    /// Apply a tool at a tile of the city (`doTool`). On success the effects
    /// are applied if the funds cover the cost, otherwise
    /// [`ToolResult::NoMoney`] is returned and nothing changes.
    ///
    /// The random numbers drawn while planning are kept even when the tool
    /// fails, as in the original.
    pub fn do_tool(&mut self, tool: EditingTool, tile_x: i32, tile_y: i32) -> ToolResult {
        let mut rng = self.rng.clone();
        let mut effects = ToolEffects::new();
        let planned = self.plan_tool(tool, tile_x, tile_y, &mut rng, &mut effects);
        self.rng = rng;

        let result = self.charged_result(tool, planned, &effects);
        if result == ToolResult::Ok && tool != EditingTool::Query {
            effects.modify_world(self);
        }
        result
    }

    /// Dry run of [`Simulation::do_tool`] (`tool_preview`). Changes nothing:
    /// the tiles, funds, random number generator, events and map serial are
    /// left as they are. `result` is what `tool_down` would return, and `cost`
    /// the total the tool would charge (0 unless `result` is `Ok`).
    pub fn tool_preview(&self, tool: EditingTool, tile_x: i32, tile_y: i32) -> ToolPreview {
        let mut rng = self.rng.clone();
        let mut effects = ToolEffects::new();
        let planned = self.plan_tool(tool, tile_x, tile_y, &mut rng, &mut effects);
        let result = self.charged_result(tool, planned, &effects);
        let cost = if result == ToolResult::Ok {
            effects.get_cost()
        } else {
            0
        };
        ToolPreview { result, cost }
    }

    /// Apply a tool from a mouse press (`toolDown`). Like the original it also queues the
    /// message and sound that explain a refused click ("bulldoze the area first", "not enough
    /// funds"); the result tells the adapter the same thing.
    pub fn tool_down(&mut self, tool: EditingTool, tile_x: i32, tile_y: i32) -> ToolResult {
        let result = self.do_tool(tool, tile_x, tile_y);
        // The original's `toolDown` tells the player why a click did nothing, with a message
        // and a sound (not `doTool`, which drags and previews also use).
        match result {
            ToolResult::NeedBulldoze => {
                self.send_message(
                    crate::message::MESSAGE_BULLDOZE_AREA_FIRST,
                    crate::simulation::NOWHERE as i16,
                    crate::simulation::NOWHERE as i16,
                    false,
                    true,
                );
                self.make_sound("interface", "UhUh", tile_x * 16, tile_y * 16);
            }
            ToolResult::NoMoney => {
                self.send_message(
                    crate::message::MESSAGE_NOT_ENOUGH_FUNDS,
                    crate::simulation::NOWHERE as i16,
                    crate::simulation::NOWHERE as i16,
                    false,
                    true,
                );
                self.make_sound("interface", "Sorry", tile_x * 16, tile_y * 16);
            }
            _ => {}
        }
        self.sim_pass = 0;
        self.tool_invalidate_maps();
        result
    }

    /// Apply a tool along a line from `(from_x, from_y)` to `(to_x, to_y)`
    /// (`toolDrag`). The line is walked as in the original, one `doTool` call
    /// per step; big tools are applied once, at the end point.
    pub fn tool_drag(&mut self, tool: EditingTool, from_x: i32, from_y: i32, to_x: i32, to_y: i32) {
        // Do not drag big tools.
        let tool_size = TOOL_SIZE[tool as usize];
        if tool_size > 1 {
            self.do_tool(tool, to_x, to_y);
            self.sim_pass = 0; // update editors overlapping this one
            self.tool_invalidate_maps();
            return;
        }

        let dir_x = if to_x > from_x { 1 } else { -1 };
        let dir_y = if to_y > from_y { 1 } else { -1 };

        if from_x == to_x && from_y == to_y {
            return;
        }

        let mut from_x = from_x;
        let mut from_y = from_y;
        self.do_tool(tool, from_x, from_y); // Ensure the start position is done.

        // Vertical line.
        if from_x == to_x && from_y != to_y {
            while from_y != to_y {
                from_y += dir_y;
                self.do_tool(tool, from_x, from_y);
            }
            self.sim_pass = 0;
            self.tool_invalidate_maps();
            return;
        }

        // Horizontal line.
        if from_x != to_x && from_y == to_y {
            while from_x != to_x {
                from_x += dir_x;
                self.do_tool(tool, from_x, from_y);
            }
            self.sim_pass = 0;
            self.tool_invalidate_maps();
            return;
        }

        // General case: both coordinates change. Each x step is `dy` sub-steps
        // and each y step is `dx` sub-steps, spread by a Bresenham-like counter.
        let dx = (from_x - to_x).abs(); // number of horizontal steps
        let dy = (from_y - to_y).abs(); // number of vertical steps
        let mut sub_x = 0;
        let mut sub_y = 0;
        let num_substeps = dx.min(dy);

        while from_x != to_x || from_y != to_y {
            sub_x += num_substeps;
            if sub_x >= dy {
                sub_x -= dy;
                from_x += dir_x;
                self.do_tool(tool, from_x, from_y);
            }

            sub_y += num_substeps;
            if sub_y >= dx {
                sub_y -= dx;
                from_y += dir_y;
                self.do_tool(tool, from_x, from_y);
            }
        }

        self.sim_pass = 0;
        self.tool_invalidate_maps();
    }

    /// `invalidateMaps` (stubs.cpp): the map serial changes, so the front-end
    /// redraws. Its update notice is dropped.
    fn tool_invalidate_maps(&mut self) {
        self.map_serial = self.map_serial.wrapping_add(1);
    }
}

impl crate::connect::Effects for ToolEffects {
    fn get_map_value(&self, sim: &Simulation, x: i32, y: i32) -> Tile {
        ToolEffects::get_map_value(self, sim, x, y)
    }
    fn set_map_value(&mut self, x: i32, y: i32, value: Tile) {
        ToolEffects::set_map_value(self, x, y, value)
    }
    fn add_cost(&mut self, amount: i32) {
        ToolEffects::add_cost(self, amount)
    }
}

impl crate::generate::MapEdits for ToolEffects {
    fn map_value(&self, sim: &Simulation, x: i32, y: i32) -> Tile {
        ToolEffects::get_map_value(self, sim, x, y)
    }
    fn set_map_value(&mut self, x: i32, y: i32, value: Tile) {
        ToolEffects::set_map_value(self, x, y, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim_with(tiles: &[(i32, i32, Tile)]) -> Simulation {
        let mut s = Simulation::with_default_size();
        s.tiles.fill(0);
        for &(x, y, t) in tiles {
            s.set_tile(x, y, t);
        }
        s.total_funds = 1_000;
        s
    }

    #[test]
    fn enum_values_match_cpp() {
        assert_eq!(ToolResult::NoMoney as i32, -2);
        assert_eq!(ToolResult::NeedBulldoze as i32, -1);
        assert_eq!(ToolResult::Failed as i32, 0);
        assert_eq!(ToolResult::Ok as i32, 1);
        assert_eq!(EditingTool::Forest as i32, 19);
        assert_eq!(EditingTool::from_index(11), Some(EditingTool::Park));
        assert_eq!(EditingTool::from_index(20), None);
        assert_eq!(EditingTool::from_index(-1), None);
    }

    #[test]
    fn effects_overlay_the_world_until_applied() {
        let mut s = sim_with(&[(5, 5, RIVER)]);
        let mut fx = ToolEffects::new();
        assert_eq!(fx.get_map_value(&s, 5, 5), RIVER);
        fx.set_map_value(5, 5, DIRT);
        fx.add_cost(30);
        assert_eq!(fx.get_map_value(&s, 5, 5), DIRT);
        assert_eq!(s.tile(5, 5), Some(RIVER), "world untouched before apply");

        s.total_funds = 29;
        assert!(!fx.modify_if_enough_funding(&mut s));
        assert_eq!(s.tile(5, 5), Some(RIVER));
        assert_eq!(fx.get_cost(), 30, "effects kept when funds are short");

        s.total_funds = 30;
        assert!(fx.modify_if_enough_funding(&mut s));
        assert_eq!(s.tile(5, 5), Some(DIRT));
        assert_eq!(s.total_funds, 0);
        assert_eq!(fx.get_cost(), 0, "effects cleared after applying");
        assert!(s.drain_events().contains(&Event::FundsChanged(0)));
    }

    #[test]
    fn get_map_tile_drops_status_bits() {
        let s = sim_with(&[(1, 1, RIVER | PWRBIT | CONDBIT)]);
        let fx = ToolEffects::new();
        assert_eq!(fx.get_map_tile(&s, 1, 1), RIVER);
        assert_eq!(fx.get_map_value(&s, 1, 1), RIVER | PWRBIT | CONDBIT);
    }

    #[test]
    fn check_size_and_tally() {
        let s = Simulation::with_default_size();
        assert_eq!(s.check_size(244), 3); // residential centre
        assert_eq!(s.check_size(784), 4); // stadium
        assert_eq!(s.check_size(716), 0); // airport tiles use the big-zone table
        assert_eq!(s.check_size(DIRT as i32), 0);
        assert!(s.tally(RUBBLE as i32));
        assert!(s.tally(WOODS as i32));
        assert!(!s.tally(ROADBASE as i32));
        assert!(s.tally(TINYEXP as i32));
    }

    #[test]
    fn big_zone_offsets() {
        assert_eq!(check_big_zone(PORT + 5), (4, -1, -1));
        assert_eq!(check_big_zone(AIRPORT + 21), (6, -3, -3));
        assert_eq!(check_big_zone(AIRPORT + 4), (0, 0, 0));
        assert_eq!(check_big_zone(DIRT), (0, 0, 0), "padding must not match");
    }

    #[test]
    fn park_needs_dirt_and_draws_one_random_number_each_time() {
        let mut s = sim_with(&[(3, 3, DIRT), (4, 4, ROADBASE)]);
        s.rng.seed(99);
        let mut fresh = s.rng.clone();
        assert_eq!(s.do_tool(EditingTool::Park, 4, 4), ToolResult::NeedBulldoze);
        // The failed attempt still advanced the generator (the draw is before the check).
        let _ = fresh.random(4);
        assert_eq!(s.rng.random16(), fresh.random16());

        assert_eq!(s.do_tool(EditingTool::Park, 3, 3), ToolResult::Ok);
        assert_eq!(s.total_funds, 990);
    }

    #[test]
    fn no_money_leaves_world_alone() {
        let mut s = sim_with(&[(3, 3, DIRT)]);
        s.total_funds = 9;
        assert_eq!(s.do_tool(EditingTool::Park, 3, 3), ToolResult::NoMoney);
        assert_eq!(s.tile(3, 3), Some(DIRT));
        assert_eq!(s.total_funds, 9);
    }

    #[test]
    fn query_reports_status_and_bounds() {
        let s = Simulation::with_default_size();
        assert_eq!(s.query_tool(-1, 0), ToolResult::Failed);
        assert_eq!(s.query_tool(0, 0), ToolResult::Ok);
        // Dirt: the original reports the last category (29) for it.
        let st = s.do_zone_status(0, 0).unwrap();
        assert_eq!(st.category, 29);
        assert!(s.do_zone_status(120, 0).is_none());
    }

    #[test]
    fn bulldozer_zone_path_leaves_rubble_and_costs_one() {
        let mut s = sim_with(&[]);
        // A residential zone with its centre at (5, 5): tiles 3x3 from (4, 4).
        let base = RESBASE;
        let mut t = base;
        for dy in 0..3 {
            for dx in 0..3 {
                let mut v = t | BNCNBIT;
                if dx == 1 && dy == 1 {
                    v |= ZONEBIT;
                }
                s.set_tile(4 + dx, 4 + dy, v);
                t += 1;
            }
        }
        assert_eq!(s.do_tool(EditingTool::Bulldozer, 5, 5), ToolResult::Ok);
        assert_eq!(s.total_funds, 999);
        assert!((s.tile(5, 5).unwrap() & LOMASK) >= TINYEXP);
    }

    #[test]
    fn bulldozer_overload_spends_without_funds_check() {
        let mut s = sim_with(&[(5, 5, (RESBASE + 4) | ZONEBIT | BNCNBIT)]);
        s.total_funds = 0;
        assert_eq!(s.bulldozer_tool(5, 5), ToolResult::Ok);
        assert_eq!(s.total_funds, -1);
    }

    #[test]
    fn tool_down_returns_the_result() {
        let mut s = sim_with(&[(1, 1, ROADBASE)]);
        assert_eq!(
            s.tool_down(EditingTool::Park, 1, 1),
            ToolResult::NeedBulldoze
        );
        assert_eq!(s.sim_pass, 0);
    }

    #[test]
    fn drag_of_a_big_tool_applies_only_the_end_point() {
        // Residential at (12, 10) has the footprint (11..=13, 9..=11); the road
        // at (13, 11) makes it fail before any connect. Nothing else changes.
        let mut s = sim_with(&[(10, 10, DIRT), (11, 10, DIRT), (13, 11, ROADBASE)]);
        s.tool_drag(EditingTool::Residential, 10, 10, 12, 10);
        assert_eq!(s.tile(10, 10), Some(DIRT));
        assert_eq!(s.tile(13, 11), Some(ROADBASE));
        assert_eq!(s.total_funds, 1_000);
    }

    #[test]
    fn drag_visits_every_step_on_a_line() {
        let mut s = sim_with(&[(0, 0, DIRT), (1, 0, DIRT), (2, 0, DIRT), (3, 0, DIRT)]);
        s.tool_drag(EditingTool::Park, 0, 0, 3, 0);
        for x in 0..4 {
            // A park is one of the four woods tiles, or the fountain (draw 4).
            let t = s.tile(x, 0).unwrap() & LOMASK;
            assert!(
                [WOODS2, WOODS3, WOODS4, WOODS5, FOUNTAIN].contains(&t),
                "x={x} t={t}"
            );
        }
        assert_eq!(s.total_funds, 960);
    }
}
