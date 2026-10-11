//! Port of `simulate.cpp` — see PORTING.md. (Owned by one porting agent.)
//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::position::Position;
use crate::simulation::{GameLevel, Simulation};

impl Simulation {
    // evaluate.cpp
    pub(crate) fn city_evaluation(&mut self) {
        todo!("evaluate: cityEvaluation")
    }
    pub(crate) fn eval_init(&mut self) {
        todo!("evaluate: evalInit")
    }
    pub(crate) fn score_doer(&mut self) {
        todo!("evaluate: scoreDoer")
    }

    // power.cpp / zone.cpp / traffic.cpp
    pub(crate) fn do_power_scan(&mut self) {
        todo!("power: doPowerScan")
    }
    pub(crate) fn push_power_stack(&mut self, _pos: Position) {
        todo!("power: pushPowerStack")
    }
    pub(crate) fn set_zone_power(&mut self, _pos: Position) -> bool {
        todo!("zone: setZonePower")
    }
    pub(crate) fn find_perimeter_road(&mut self, _pos: &mut Position) -> bool {
        todo!("traffic: findPerimeterRoad")
    }
    pub(crate) fn do_zone(&mut self, _pos: Position) {
        todo!("zone: doZone")
    }

    // scan.cpp
    pub(crate) fn pollution_terrain_land_value_scan(&mut self) {
        todo!("scan: pollutionTerrainLandValueScan")
    }
    pub(crate) fn crime_scan(&mut self) {
        todo!("scan: crimeScan")
    }
    pub(crate) fn population_density_scan(&mut self) {
        todo!("scan: populationDensityScan")
    }
    pub(crate) fn fire_analysis(&mut self) {
        todo!("scan: fireAnalysis")
    }

    // disasters.cpp
    pub(crate) fn do_disasters(&mut self) {
        todo!("disasters: doDisasters")
    }
    pub(crate) fn do_flood(&mut self, _pos: Position) {
        todo!("disasters: doFlood")
    }

    // sprite.cpp
    pub(crate) fn generate_train(&mut self, _x: i32, _y: i32) {
        todo!("sprite: generateTrain")
    }
    pub(crate) fn generate_ship(&mut self) {
        todo!("sprite: generateShip")
    }
    pub(crate) fn generate_plane(&mut self, _pos: Position) {
        todo!("sprite: generatePlane")
    }
    pub(crate) fn generate_copter(&mut self, _pos: Position) {
        todo!("sprite: generateCopter")
    }
    pub(crate) fn make_explosion(&mut self, _x: i32, _y: i32) {
        todo!("sprite: makeExplosion")
    }
    pub(crate) fn make_explosion_at(&mut self, _x: i32, _y: i32) {
        todo!("sprite: makeExplosionAt")
    }
    pub(crate) fn move_objects(&mut self) {
        todo!("sprite: moveObjects")
    }
    /// `getSprite(kind) != NULL`.
    pub(crate) fn sprite_of_kind_exists(&self, _kind: i32) -> bool {
        todo!("sprite: getSprite")
    }
    /// Hot-spot `(x + xHot, y + yHot)` of every sprite with `type == SPRITE_SHIP`
    /// and `frame != 0`, for `getBoatDistance`.
    pub(crate) fn ship_hotspots(&self) -> Vec<(i32, i32)> {
        todo!("sprite: ship hot-spots")
    }

    // message.cpp
    pub(crate) fn send_message(
        &mut self,
        _mnum: i16,
        _x: i16,
        _y: i16,
        _picture: bool,
        _important: bool,
    ) {
        todo!("message: sendMessage")
    }
    pub(crate) fn send_messages(&mut self) {
        todo!("message: sendMessages")
    }

    // budget.cpp
    pub(crate) fn do_budget(&mut self) {
        todo!("budget: doBudget")
    }
    pub(crate) fn update_budget(&mut self) {
        todo!("budget: updateBudget")
    }

    // graph.cpp
    pub(crate) fn change_census(&mut self) {
        todo!("graph: changeCensus")
    }
    pub(crate) fn graph_doer(&mut self) {
        todo!("graph: graphDoer")
    }

    // update.cpp
    pub(crate) fn do_update_heads(&mut self) {
        todo!("update: doUpdateHeads")
    }

    // utilities.cpp
    pub(crate) fn set_game_level(&mut self, _level: GameLevel) {
        todo!("utilities: setGameLevel")
    }
    pub(crate) fn set_year(&mut self, _year: i32) {
        todo!("utilities: setYear")
    }
}
