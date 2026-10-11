//! Port of `connect.cpp` — see PORTING.md.
//!
//! Lays roads, rails and wires and repairs the road/rail/wire connections
//! around a tile. All world changes go through an [`Effects`] object, the
//! Rust counterpart of the C++ `ToolEffects` collector (tool.cpp / tool.h).

use crate::simulation::Simulation;
use crate::tile::{Tile, BLBNCNBIT, BULLBIT, BURNBIT, CONDBIT, LOMASK};
use crate::tile_chars::*;

pub use crate::tool::{ConnectTileCommand, ToolResult};

/// The part of `ToolEffects` (tool.h) that the connection code needs: read the
/// map value as the tool sees it (including its pending modifications), record
/// a modification, and add to the cost.
pub trait Effects {
    /// `ToolEffects::getMapValue`: tile including status bits.
    fn get_map_value(&self, sim: &Simulation, x: i32, y: i32) -> Tile;
    /// `ToolEffects::setMapValue`.
    fn set_map_value(&mut self, x: i32, y: i32, value: Tile);
    /// `ToolEffects::addCost`.
    fn add_cost(&mut self, amount: i32);

    /// `ToolEffects::getMapTile`: tile character without status bits.
    fn get_map_tile(&self, sim: &Simulation, x: i32, y: i32) -> Tile {
        self.get_map_value(sim, x, y) & LOMASK
    }
}

/// Table of road shapes indexed by the four neighbour bits (N, E, S, W).
static ROAD_TABLE: [Tile; 16] = [
    ROADS,
    ROADS2,
    ROADS,
    ROADS3,
    ROADS2,
    ROADS2,
    ROADS4,
    ROADS8,
    ROADS,
    ROADS6,
    ROADS,
    ROADS7,
    ROADS5,
    ROADS10,
    ROADS9,
    INTERSECTION,
];

static RAIL_TABLE: [Tile; 16] = [
    LHRAIL, LVRAIL, LHRAIL, LVRAIL2, LVRAIL, LVRAIL, LVRAIL3, LVRAIL7, LHRAIL, LVRAIL5, LHRAIL,
    LVRAIL6, LVRAIL4, LVRAIL9, LVRAIL8, LVRAIL10,
];

static WIRE_TABLE: [Tile; 16] = [
    LHPOWER, LVPOWER, LHPOWER, LVPOWER2, LVPOWER, LVPOWER, LVPOWER3, LVPOWER7, LHPOWER, LVPOWER5,
    LHPOWER, LVPOWER6, LVPOWER4, LVPOWER9, LVPOWER8, LVPOWER10,
];

/// Remove road from the tile (`neutralizeRoad`).
#[inline]
fn neutralize_road(tile: Tile) -> Tile {
    if (64..=207).contains(&tile) {
        (tile & 0x000F) + 64
    } else {
        tile
    }
}

impl Simulation {
    /// Port of `Micropolis::connectTile`: perform the command, and fix
    /// wire/road/rail/zone connections around it.
    pub fn connect_tile<E: Effects>(
        &self,
        x: i32,
        y: i32,
        cmd: ConnectTileCommand,
        effects: &mut E,
    ) -> ToolResult {
        let mut result = ToolResult::Ok;

        // Make sure the array subscripts are in bounds.
        if !self.on_map(x, y) {
            return ToolResult::Failed;
        }

        // Perform auto-doze if appropriate.
        match cmd {
            ConnectTileCommand::Road | ConnectTileCommand::Railroad | ConnectTileCommand::Wire => {
                // Silently skip auto-bulldoze if no money.
                if self.auto_bulldoze {
                    let mut map_val = effects.get_map_value(self, x, y);
                    if map_val & BULLBIT != 0 {
                        map_val &= LOMASK;
                        map_val = neutralize_road(map_val);

                        if (TINYEXP..=LASTTINYEXP).contains(&map_val)
                            || (map_val < HBRIDGE && map_val != DIRT)
                        {
                            effects.add_cost(1);
                            effects.set_map_value(x, y, DIRT);
                        }
                    }
                }
            }
            ConnectTileCommand::Fix | ConnectTileCommand::Bulldoze => {}
        }

        // Perform the command.
        match cmd {
            ConnectTileCommand::Fix => {
                self.fix_zone(x, y, effects);
            }
            ConnectTileCommand::Bulldoze => {
                result = self.lay_doze(x, y, effects);
                self.fix_zone(x, y, effects);
            }
            ConnectTileCommand::Road => {
                result = self.lay_road(x, y, effects);
                self.fix_zone(x, y, effects);
            }
            ConnectTileCommand::Railroad => {
                result = self.lay_rail(x, y, effects);
                self.fix_zone(x, y, effects);
            }
            ConnectTileCommand::Wire => {
                result = self.lay_wire(x, y, effects);
                self.fix_zone(x, y, effects);
            }
        }

        result
    }

    /// Port of `Micropolis::layDoze`: bulldoze a tile (make it #RIVER or #DIRT).
    pub fn lay_doze<E: Effects>(&self, x: i32, y: i32, effects: &mut E) -> ToolResult {
        let mut tile = effects.get_map_value(self, x, y);

        if tile & BULLBIT == 0 {
            return ToolResult::Failed; // Check dozeable bit.
        }

        tile &= LOMASK;
        tile = neutralize_road(tile);

        match tile {
            HBRIDGE | VBRIDGE | BRWV | BRWH | HBRDG0 | HBRDG1 | HBRDG2 | HBRDG3 | VBRDG0
            | VBRDG1 | VBRDG2 | VBRDG3 | HPOWER | VPOWER | HRAIL | VRAIL => {
                // Dozing over water, replace with water.
                effects.set_map_value(x, y, RIVER);
            }
            _ => {
                // Dozing on land, replace with land.
                effects.set_map_value(x, y, DIRT);
            }
        }

        effects.add_cost(1); // Costs $1.00....

        ToolResult::Ok
    }

    /// Port of `Micropolis::layRoad`: lay a road, and update road around it.
    pub fn lay_road<E: Effects>(&self, x: i32, y: i32, effects: &mut E) -> ToolResult {
        let (w, h) = self.world_size();
        let mut cost = 10;

        let mut tile = effects.get_map_tile(self, x, y);

        match tile {
            DIRT => {
                effects.set_map_value(x, y, ROADS | BULLBIT | BURNBIT);
            }
            RIVER | REDGE | CHANNEL => {
                // Road on water: check how to build bridges, if possible.
                cost = 50;

                let mut bridge = None;
                if x < w - 1 {
                    tile = neutralize_road(effects.get_map_tile(self, x + 1, y));
                    if tile == VRAILROAD || tile == HBRIDGE || (ROADS..=HROADPOWER).contains(&tile)
                    {
                        bridge = Some(HBRIDGE | BULLBIT);
                    }
                }
                if bridge.is_none() && x > 0 {
                    tile = neutralize_road(effects.get_map_tile(self, x - 1, y));
                    if tile == VRAILROAD
                        || tile == HBRIDGE
                        || (ROADS..=INTERSECTION).contains(&tile)
                    {
                        bridge = Some(HBRIDGE | BULLBIT);
                    }
                }
                if bridge.is_none() && y < h - 1 {
                    tile = neutralize_road(effects.get_map_tile(self, x, y + 1));
                    if tile == HRAILROAD
                        || tile == VROADPOWER
                        || (VBRIDGE..=INTERSECTION).contains(&tile)
                    {
                        bridge = Some(VBRIDGE | BULLBIT);
                    }
                }
                if bridge.is_none() && y > 0 {
                    tile = neutralize_road(effects.get_map_tile(self, x, y - 1));
                    if tile == HRAILROAD
                        || tile == VROADPOWER
                        || (VBRIDGE..=INTERSECTION).contains(&tile)
                    {
                        bridge = Some(VBRIDGE | BULLBIT);
                    }
                }
                match bridge {
                    Some(v) => effects.set_map_value(x, y, v),
                    None => return ToolResult::Failed, // Can't do road...
                }
            }
            LHPOWER => {
                // Road on power
                effects.set_map_value(x, y, VROADPOWER | CONDBIT | BURNBIT | BULLBIT);
            }
            LVPOWER => {
                // Road on power #2
                effects.set_map_value(x, y, HROADPOWER | CONDBIT | BURNBIT | BULLBIT);
            }
            LHRAIL => {
                // Road on rail
                effects.set_map_value(x, y, HRAILROAD | BURNBIT | BULLBIT);
            }
            LVRAIL => {
                // Road on rail #2
                effects.set_map_value(x, y, VRAILROAD | BURNBIT | BULLBIT);
            }
            _ => return ToolResult::Failed, // Can't do road
        }

        effects.add_cost(cost);
        ToolResult::Ok
    }

    /// Port of `Micropolis::layRail`: lay a rail, and update connections
    /// (rail, road, and wire) around it.
    pub fn lay_rail<E: Effects>(&self, x: i32, y: i32, effects: &mut E) -> ToolResult {
        let (w, h) = self.world_size();
        let mut cost = 20;

        let mut tile = effects.get_map_tile(self, x, y);

        tile = neutralize_road(tile);

        match tile {
            DIRT => {
                // Rail on Dirt
                effects.set_map_value(x, y, LHRAIL | BULLBIT | BURNBIT);
            }
            RIVER | REDGE | CHANNEL => {
                // Rail on water: check how to build underwater tunnel, if possible.
                cost = 100;

                let mut bridge = None;
                if x < w - 1 {
                    tile = neutralize_road(effects.get_map_tile(self, x + 1, y));
                    if tile == RAILHPOWERV || tile == HRAIL || (LHRAIL..=HRAILROAD).contains(&tile)
                    {
                        bridge = Some(HRAIL | BULLBIT);
                    }
                }
                if bridge.is_none() && x > 0 {
                    tile = neutralize_road(effects.get_map_tile(self, x - 1, y));
                    if tile == RAILHPOWERV
                        || tile == HRAIL
                        || (VRAIL + 1..VRAILROAD).contains(&tile)
                    {
                        bridge = Some(HRAIL | BULLBIT);
                    }
                }
                if bridge.is_none() && y < h - 1 {
                    tile = neutralize_road(effects.get_map_tile(self, x, y + 1));
                    if tile == RAILVPOWERH
                        || tile == VRAILROAD
                        || (HRAIL + 1..HRAILROAD).contains(&tile)
                    {
                        bridge = Some(VRAIL | BULLBIT);
                    }
                }
                if bridge.is_none() && y > 0 {
                    tile = neutralize_road(effects.get_map_tile(self, x, y - 1));
                    if tile == RAILVPOWERH
                        || tile == VRAILROAD
                        || (HRAIL + 1..HRAILROAD).contains(&tile)
                    {
                        bridge = Some(VRAIL | BULLBIT);
                    }
                }
                match bridge {
                    Some(v) => effects.set_map_value(x, y, v),
                    None => return ToolResult::Failed, // Can't do rail...
                }
            }
            LHPOWER => {
                // Rail on power
                effects.set_map_value(x, y, RAILVPOWERH | CONDBIT | BURNBIT | BULLBIT);
            }
            LVPOWER => {
                // Rail on power #2
                effects.set_map_value(x, y, RAILHPOWERV | CONDBIT | BURNBIT | BULLBIT);
            }
            ROADS => {
                // Rail on road
                effects.set_map_value(x, y, VRAILROAD | BURNBIT | BULLBIT);
            }
            ROADS2 => {
                // Rail on road #2
                effects.set_map_value(x, y, HRAILROAD | BURNBIT | BULLBIT);
            }
            _ => return ToolResult::Failed, // Can't do rail
        }

        effects.add_cost(cost);
        ToolResult::Ok
    }

    /// Port of `Micropolis::layWire`: lay a wire, and update connections
    /// (rail, road, and wire) around it.
    pub fn lay_wire<E: Effects>(&self, x: i32, y: i32, effects: &mut E) -> ToolResult {
        let (w, h) = self.world_size();
        let mut cost = 5;

        let mut tile = effects.get_map_tile(self, x, y);

        tile = neutralize_road(tile);

        match tile {
            DIRT => {
                // Wire on Dirt
                effects.set_map_value(x, y, LHPOWER | CONDBIT | BURNBIT | BULLBIT);
            }
            RIVER | REDGE | CHANNEL => {
                // Wire on water: check how to lay underwater wire, if possible.
                cost = 25;

                let mut bridge = None;
                if x < w - 1 {
                    let t = effects.get_map_value(self, x + 1, y);
                    if t & CONDBIT != 0 {
                        let t = neutralize_road(t & LOMASK);
                        if t != HROADPOWER && t != RAILHPOWERV && t != HPOWER {
                            bridge = Some(VPOWER | CONDBIT | BULLBIT);
                        }
                    }
                }
                if bridge.is_none() && x > 0 {
                    let t = effects.get_map_value(self, x - 1, y);
                    if t & CONDBIT != 0 {
                        let t = neutralize_road(t & LOMASK);
                        if t != HROADPOWER && t != RAILHPOWERV && t != HPOWER {
                            bridge = Some(VPOWER | CONDBIT | BULLBIT);
                        }
                    }
                }
                if bridge.is_none() && y < h - 1 {
                    let t = effects.get_map_value(self, x, y + 1);
                    if t & CONDBIT != 0 {
                        let t = neutralize_road(t & LOMASK);
                        if t != VROADPOWER && t != RAILVPOWERH && t != VPOWER {
                            bridge = Some(HPOWER | CONDBIT | BULLBIT);
                        }
                    }
                }
                if bridge.is_none() && y > 0 {
                    let t = effects.get_map_value(self, x, y - 1);
                    if t & CONDBIT != 0 {
                        let t = neutralize_road(t & LOMASK);
                        if t != VROADPOWER && t != RAILVPOWERH && t != VPOWER {
                            bridge = Some(HPOWER | CONDBIT | BULLBIT);
                        }
                    }
                }
                match bridge {
                    Some(v) => effects.set_map_value(x, y, v),
                    None => return ToolResult::Failed, // Can't do wire...
                }
            }
            ROADS => {
                // Wire on Road
                effects.set_map_value(x, y, HROADPOWER | CONDBIT | BURNBIT | BULLBIT);
            }
            ROADS2 => {
                // Wire on Road #2
                effects.set_map_value(x, y, VROADPOWER | CONDBIT | BURNBIT | BULLBIT);
            }
            LHRAIL => {
                // Wire on rail
                effects.set_map_value(x, y, RAILHPOWERV | CONDBIT | BURNBIT | BULLBIT);
            }
            LVRAIL => {
                // Wire on rail #2
                effects.set_map_value(x, y, RAILVPOWERH | CONDBIT | BURNBIT | BULLBIT);
            }
            _ => return ToolResult::Failed, // Can't do wire
        }

        effects.add_cost(cost);
        ToolResult::Ok
    }

    /// Port of `Micropolis::fixZone`: update connections (rails, and wire
    /// connections) to a zone.
    pub fn fix_zone<E: Effects>(&self, x: i32, y: i32, effects: &mut E) {
        let (w, h) = self.world_size();

        self.fix_single(x, y, effects);

        if y > 0 {
            self.fix_single(x, y - 1, effects);
        }

        if x < w - 1 {
            self.fix_single(x + 1, y, effects);
        }

        if y < h - 1 {
            self.fix_single(x, y + 1, effects);
        }

        if x > 0 {
            self.fix_single(x - 1, y, effects);
        }
    }

    /// Port of `Micropolis::fixSingle`: modify road, rails, and wire
    /// connections at a given tile.
    pub fn fix_single<E: Effects>(&self, x: i32, y: i32, effects: &mut E) {
        let (w, h) = self.world_size();
        let mut adj_tile: usize = 0;

        let mut tile = effects.get_map_tile(self, x, y);

        tile = neutralize_road(tile);

        if (ROADS..=INTERSECTION).contains(&tile) {
            // Cleanup Road
            if y > 0 {
                tile = neutralize_road(effects.get_map_tile(self, x, y - 1));
                if (tile == HRAILROAD || (ROADBASE..=VROADPOWER).contains(&tile))
                    && tile != HROADPOWER
                    && tile != VRAILROAD
                    && tile != ROADBASE
                {
                    adj_tile |= 0x0001;
                }
            }

            if x < w - 1 {
                tile = neutralize_road(effects.get_map_tile(self, x + 1, y));
                if (tile == VRAILROAD || (ROADBASE..=VROADPOWER).contains(&tile))
                    && tile != VROADPOWER
                    && tile != HRAILROAD
                    && tile != VBRIDGE
                {
                    adj_tile |= 0x0002;
                }
            }

            if y < h - 1 {
                tile = neutralize_road(effects.get_map_tile(self, x, y + 1));
                if (tile == HRAILROAD || (ROADBASE..=VROADPOWER).contains(&tile))
                    && tile != HROADPOWER
                    && tile != VRAILROAD
                    && tile != ROADBASE
                {
                    adj_tile |= 0x0004;
                }
            }

            if x > 0 {
                tile = neutralize_road(effects.get_map_tile(self, x - 1, y));
                if (tile == VRAILROAD || (ROADBASE..=VROADPOWER).contains(&tile))
                    && tile != VROADPOWER
                    && tile != HRAILROAD
                    && tile != VBRIDGE
                {
                    adj_tile |= 0x0008;
                }
            }

            effects.set_map_value(x, y, ROAD_TABLE[adj_tile] | BULLBIT | BURNBIT);
            return;
        }

        if (LHRAIL..=LVRAIL10).contains(&tile) {
            // Cleanup Rail
            if y > 0 {
                tile = neutralize_road(effects.get_map_tile(self, x, y - 1));
                if (RAILHPOWERV..=VRAILROAD).contains(&tile)
                    && tile != RAILHPOWERV
                    && tile != HRAILROAD
                    && tile != HRAIL
                {
                    adj_tile |= 0x0001;
                }
            }

            if x < w - 1 {
                tile = neutralize_road(effects.get_map_tile(self, x + 1, y));
                if (RAILHPOWERV..=VRAILROAD).contains(&tile)
                    && tile != RAILVPOWERH
                    && tile != VRAILROAD
                    && tile != VRAIL
                {
                    adj_tile |= 0x0002;
                }
            }

            if y < h - 1 {
                tile = neutralize_road(effects.get_map_tile(self, x, y + 1));
                if (RAILHPOWERV..=VRAILROAD).contains(&tile)
                    && tile != RAILHPOWERV
                    && tile != HRAILROAD
                    && tile != HRAIL
                {
                    adj_tile |= 0x0004;
                }
            }

            if x > 0 {
                tile = neutralize_road(effects.get_map_tile(self, x - 1, y));
                if (RAILHPOWERV..=VRAILROAD).contains(&tile)
                    && tile != RAILVPOWERH
                    && tile != VRAILROAD
                    && tile != VRAIL
                {
                    adj_tile |= 0x0008;
                }
            }

            effects.set_map_value(x, y, RAIL_TABLE[adj_tile] | BULLBIT | BURNBIT);
            return;
        }

        if (LHPOWER..=LVPOWER10).contains(&tile) {
            // Cleanup Wire
            if y > 0 {
                let t = effects.get_map_value(self, x, y - 1);
                if t & CONDBIT != 0 {
                    let t = neutralize_road(t & LOMASK);
                    if t != VPOWER && t != VROADPOWER && t != RAILVPOWERH {
                        adj_tile |= 0x0001;
                    }
                }
            }

            if x < w - 1 {
                let t = effects.get_map_value(self, x + 1, y);
                if t & CONDBIT != 0 {
                    let t = neutralize_road(t & LOMASK);
                    if t != HPOWER && t != HROADPOWER && t != RAILHPOWERV {
                        adj_tile |= 0x0002;
                    }
                }
            }

            if y < h - 1 {
                let t = effects.get_map_value(self, x, y + 1);
                if t & CONDBIT != 0 {
                    let t = neutralize_road(t & LOMASK);
                    if t != VPOWER && t != VROADPOWER && t != RAILVPOWERH {
                        adj_tile |= 0x0004;
                    }
                }
            }

            if x > 0 {
                let t = effects.get_map_value(self, x - 1, y);
                if t & CONDBIT != 0 {
                    let t = neutralize_road(t & LOMASK);
                    if t != HPOWER && t != HROADPOWER && t != RAILHPOWERV {
                        adj_tile |= 0x0008;
                    }
                }
            }

            effects.set_map_value(x, y, WIRE_TABLE[adj_tile] | BLBNCNBIT);
        }
    }
}
