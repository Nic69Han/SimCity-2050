//! The simulator state: replaces `class Micropolis` (micropolis.h/.cpp).
//!
//! Only state that exists in the C++ `Micropolis::init()` and is needed by the
//! engine is kept. Front-end plumbing (callbacks, resources, string tables,
//! sprite lists, file names) is left out for now; sprites come with the
//! `sprite` module. Dimensions are runtime parameters (see [`Simulation::new`]).
//!
//! Sources: `micropolis.cpp` (`init`), `allocate.cpp` (`initMapArrays`),
//! `initialize.cpp` (`initWillStuff`), `simulate.cpp` (`setCommonInits`,
//! `initSimMemory`, `doSimInit` outline) and `utilities.cpp`
//! (`setGameLevelFunds`).

use crate::events::Event;
use crate::map::Map;
use crate::position::Position;
use crate::rng::Rng;
use crate::tile::Tile;

pub const PASSES_PER_CITYTIME: i32 = 16;
pub const CITYTIMES_PER_MONTH: i32 = 4;
pub const CITYTIMES_PER_YEAR: i32 = CITYTIMES_PER_MONTH * 12;
/// The C++ allocates `HISTORY_LENGTH` *bytes* (480) for arrays of `short`, so
/// each graph holds 240 values; the misc history holds 120.
pub const HISTORY_LEN: usize = 240;
pub const MISC_HISTORY_LEN: usize = 120;
pub const NOWHERE: i32 = -1;
pub const MAX_TRAFFIC_DISTANCE: usize = 30;
pub const MAX_ROAD_EFFECT: i32 = 32;
pub const MAX_POLICE_STATION_EFFECT: i32 = 1000;
pub const MAX_FIRE_STATION_EFFECT: i32 = 1000;
pub const RES_VALVE_RANGE: i32 = 2000;
pub const COM_VALVE_RANGE: i32 = 1500;
pub const IND_VALVE_RANGE: i32 = 1500;
pub const PROBNUM: usize = 10;
pub const CVP_PROBLEM_COMPLAINTS: usize = 4;
pub const MAP_TYPE_COUNT: usize = 13;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum GameLevel {
    #[default]
    Easy = 0,
    Medium,
    Hard,
}

impl GameLevel {
    /// Starting funds (`setGameLevelFunds`).
    pub fn initial_funds(self) -> i64 {
        match self {
            GameLevel::Easy => 20_000,
            GameLevel::Medium => 10_000,
            GameLevel::Hard => 5_000,
        }
    }

    pub fn from_i16(v: i16) -> Option<Self> {
        match v {
            0 => Some(Self::Easy),
            1 => Some(Self::Medium),
            2 => Some(Self::Hard),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum CityClass {
    #[default]
    Village = 0,
    Town,
    City,
    Capital,
    Metropolis,
    Megalopolis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum Scenario {
    #[default]
    None = 0,
    Dullsville,
    SanFrancisco,
    Hamburg,
    Bern,
    Tokyo,
    Detroit,
    Boston,
    Rio,
}

#[derive(Debug, Clone)]
pub struct Simulation {
    // ---- world ----
    world_w: i32,
    world_h: i32,
    /// Tile map, column-major (`x * world_h + y`) like the original.
    pub tiles: Vec<Tile>,
    pub rng: Rng,
    events: Vec<Event>,

    // ---- density / effect maps (block size in the name of the field's doc) ----
    pub population_density_map: Map<u8>, // 2
    pub traffic_density_map: Map<u8>,    // 2
    pub pollution_density_map: Map<u8>,  // 2
    pub land_value_map: Map<u8>,         // 2
    pub crime_rate_map: Map<u8>,         // 2
    pub terrain_density_map: Map<u8>,    // 4
    pub temp_map1: Map<u8>,              // 2
    pub temp_map2: Map<u8>,              // 2
    pub temp_map3: Map<u8>,              // 4
    pub power_grid_map: Map<u8>,         // 1
    pub rate_of_growth_map: Map<i16>,    // 8
    pub fire_station_map: Map<i16>,      // 8
    pub fire_station_effect_map: Map<i16>,
    pub police_station_map: Map<i16>, // 8
    pub police_station_effect_map: Map<i16>,
    pub com_rate_map: Map<i16>, // 8

    // ---- histories ----
    pub res_hist: Vec<i16>,
    pub com_hist: Vec<i16>,
    pub ind_hist: Vec<i16>,
    pub money_hist: Vec<i16>,
    pub pollution_hist: Vec<i16>,
    pub crime_hist: Vec<i16>,
    pub misc_hist: Vec<i16>,
    pub res_hist10_max: i16,
    pub res_hist120_max: i16,
    pub com_hist10_max: i16,
    pub com_hist120_max: i16,
    pub ind_hist10_max: i16,
    pub ind_hist120_max: i16,
    pub graph10_max: i16,
    pub graph120_max: i16,

    // ---- census (allocate.cpp) ----
    pub road_total: i16,
    pub rail_total: i16,
    pub fire_pop: i16,
    pub res_pop: i16,
    pub com_pop: i16,
    pub ind_pop: i16,
    pub total_pop: i16,
    pub total_pop_last: i16,
    pub res_zone_pop: i16,
    pub com_zone_pop: i16,
    pub ind_zone_pop: i16,
    pub total_zone_pop: i16,
    pub hospital_pop: i16,
    pub church_pop: i16,
    pub faith: i16,
    pub stadium_pop: i16,
    pub police_station_pop: i16,
    pub fire_station_pop: i16,
    pub coal_power_pop: i16,
    pub nuclear_power_pop: i16,
    pub seaport_pop: i16,
    pub airport_pop: i16,
    pub need_hospital: i16,
    pub need_church: i16,
    pub crime_average: i16,
    pub pollution_average: i16,
    pub land_value_average: i16,
    pub census_changed: bool,

    // ---- time ----
    pub city_time: i64,
    pub city_month: i64,
    pub city_year: i64,
    pub starting_year: i16,

    // ---- budget ----
    pub road_spend: i64,
    pub police_spend: i64,
    pub fire_spend: i64,
    pub road_fund: i64,
    pub police_fund: i64,
    pub fire_fund: i64,
    pub road_effect: i32,
    pub police_effect: i32,
    pub fire_effect: i32,
    pub tax_fund: i64,
    pub city_tax: i16,
    pub tax_flag: bool,
    pub road_percent: f32,
    pub police_percent: f32,
    pub fire_percent: f32,
    pub road_value: i64,
    pub police_value: i64,
    pub fire_value: i64,
    pub total_funds: i64,
    pub auto_bulldoze: bool,
    pub auto_budget: bool,
    pub cash_flow: i16,
    pub city_tax_average: i16,

    // ---- evaluation ----
    pub city_yes: i16,
    pub problem_votes: [i16; PROBNUM],
    pub problem_order: [i16; CVP_PROBLEM_COMPLAINTS],
    pub city_pop: i64,
    pub city_pop_delta: i64,
    pub city_assessed_value: i64,
    pub city_class: CityClass,
    pub city_score: i16,
    pub city_score_delta: i16,
    pub traffic_average: i16,
    pub city_pop_last: i64,
    pub category_last: i16,

    // ---- terrain generation ----
    pub terrain_tree_level: i32,
    pub terrain_lake_level: i32,
    pub terrain_curve_level: i32,
    pub terrain_create_island: i32,

    // ---- game control ----
    pub sim_loops: i32,
    pub sim_passes: i32,
    pub sim_pass: i32,
    pub sim_paused: bool,
    pub sim_paused_speed: i32,
    pub sim_speed: i16,
    pub sim_speed_meta: i16,
    pub heat_steps: i32,
    pub heat_flow: i32,
    pub heat_rule: i32,
    pub heat_wrap: i32,
    pub city_name: String,
    pub game_level: GameLevel,
    pub scenario: Scenario,
    pub enable_disasters: bool,
    pub do_animation: bool,
    pub do_messages: bool,
    pub do_notices: bool,
    pub tiles_animated: bool,
    pub init_sim_load: i16,

    // ---- scan / power / traffic ----
    pub new_map: i16,
    pub new_map_flags: [i16; MAP_TYPE_COUNT],
    pub city_center_x: i16,
    pub city_center_y: i16,
    pub pollution_max_x: i16,
    pub pollution_max_y: i16,
    pub crime_max_x: i16,
    pub crime_max_y: i16,
    pub don_dither: i64,
    pub power_stack: Vec<Position>,
    pub power_stack_pointer: usize,
    pub cur_map_stack: [Position; MAX_TRAFFIC_DISTANCE + 1],
    pub cur_map_stack_pointer: i16,
    pub traf_max_x: i16,
    pub traf_max_y: i16,

    // ---- simulate.cpp ----
    pub valve_flag: bool,
    pub crime_ramp: i16,
    pub pollution_ramp: i16,
    pub res_cap: bool,
    pub com_cap: bool,
    pub ind_cap: bool,
    pub external_market: f32,
    pub disaster_event: Scenario,
    pub disaster_wait: i16,
    pub score_type: Scenario,
    pub score_wait: i16,
    pub powered_zone_count: i16,
    pub unpowered_zone_count: i16,
    pub new_power: bool,
    pub sim_cycle: i16,
    pub phase_cycle: i16,
    pub speed_cycle: i16,
    pub do_initial_eval: bool,
    pub map_serial: i32,
    pub res_valve: i16,
    pub com_valve: i16,
    pub ind_valve: i16,
    pub flood_count: i16,
    pub sprite_cycle: i16,

    // ---- update.cpp (last displayed values) ----
    pub city_time_last: i64,
    pub city_year_last: i64,
    pub city_month_last: i64,
    pub total_funds_last: i64,
    pub res_last: i64,
    pub com_last: i64,
    pub ind_last: i64,
    // @fields:power (agent power: add your extra Simulation fields right below this line)

    // @fields:scan (agent scan: add your extra Simulation fields right below this line)

    // @fields:evaluate (agent evaluate: add your extra Simulation fields right below this line)
    /// `evalChanged`: the evaluation window should be shown again.
    pub eval_changed: bool,
    /// `mustDrawBudget`: the budget window needs redrawing.
    pub must_draw_budget: bool,
    // @fields:generate (agent generate: add your extra Simulation fields right below this line)
    /// `generatedCitySeed`: the seed of the last `generate_map_seed` call.
    pub generated_city_seed: i32,
    // @fields:zone (agent zone: add your extra Simulation fields right below this line)

    // @fields:traffic (agent traffic: add your extra Simulation fields right below this line)

    // @fields:tool (agent tool: add your extra Simulation fields right below this line)

    // @fields:sprite (agent sprite: add your extra Simulation fields right below this line)
    /// Sprite pool; C++ `SimSprite` objects, addressed by index.
    pub sprites: Vec<crate::sprite::Sprite>,
    /// Head of the active sprite list (C++ `spriteList`).
    pub sprite_list: Option<usize>,
    /// Head of the free sprite pool (C++ `freeSprites`).
    pub free_sprites: Option<usize>,
    /// Per-type shortcut to a sprite (C++ `globalSprites`).
    pub global_sprites: [Option<usize>; crate::sprite::SPRITE_COUNT],
    /// Distance computed by the last `get_dir` call (C++ `absDist`).
    pub abs_dist: i32,
    // @fields:simulate (agent simulate: add your extra Simulation fields right below this line)

    // @fields:misc (agent misc: add your extra Simulation fields right below this line)
    pub enable_sound: bool,
    pub auto_goto: bool,
    pub must_update_funds: bool,
    pub must_update_options: bool,
    pub history_initialized: bool,
}

impl Simulation {
    /// Create a simulator for a `world_w` x `world_h` world, in the state of a
    /// freshly constructed `Micropolis` (`init()` + `initMapArrays()`).
    pub fn new(world_w: i32, world_h: i32) -> Self {
        assert!(world_w > 0 && world_h > 0, "invalid world size");
        let m = |block: i32| Map::<u8>::new(world_w, world_h, block, 0);
        let m8 = || Map::<i16>::new(world_w, world_h, 8, 0);
        let hist = |v: i16| vec![v; HISTORY_LEN];
        Self {
            world_w,
            world_h,
            tiles: vec![0; (world_w as usize) * (world_h as usize)],
            rng: Rng::new(1),
            events: Vec::new(),

            population_density_map: m(2),
            traffic_density_map: m(2),
            pollution_density_map: m(2),
            land_value_map: m(2),
            crime_rate_map: m(2),
            terrain_density_map: m(4),
            temp_map1: m(2),
            temp_map2: m(2),
            temp_map3: m(4),
            power_grid_map: m(1),
            rate_of_growth_map: m8(),
            fire_station_map: m8(),
            fire_station_effect_map: m8(),
            police_station_map: m8(),
            police_station_effect_map: m8(),
            com_rate_map: m8(),

            res_hist: hist(0),
            com_hist: hist(0),
            ind_hist: hist(0),
            money_hist: hist(0),
            pollution_hist: hist(0),
            crime_hist: hist(0),
            misc_hist: vec![0; MISC_HISTORY_LEN],
            res_hist10_max: 0,
            res_hist120_max: 0,
            com_hist10_max: 0,
            com_hist120_max: 0,
            ind_hist10_max: 0,
            ind_hist120_max: 0,
            graph10_max: 0,
            graph120_max: 0,

            road_total: 0,
            rail_total: 0,
            fire_pop: 0,
            res_pop: 0,
            com_pop: 0,
            ind_pop: 0,
            total_pop: 0,
            total_pop_last: 0,
            res_zone_pop: 0,
            com_zone_pop: 0,
            ind_zone_pop: 0,
            total_zone_pop: 0,
            hospital_pop: 0,
            church_pop: 0,
            faith: 0,
            stadium_pop: 0,
            police_station_pop: 0,
            fire_station_pop: 0,
            coal_power_pop: 0,
            nuclear_power_pop: 0,
            seaport_pop: 0,
            airport_pop: 0,
            need_hospital: 0,
            need_church: 0,
            crime_average: 0,
            pollution_average: 0,
            land_value_average: 0,
            census_changed: false,

            city_time: 0,
            city_month: 0,
            city_year: 0,
            starting_year: 0,

            road_spend: 0,
            police_spend: 0,
            fire_spend: 0,
            road_fund: 0,
            police_fund: 0,
            fire_fund: 0,
            road_effect: 0,
            police_effect: 0,
            fire_effect: 0,
            tax_fund: 0,
            city_tax: 0,
            tax_flag: false,
            road_percent: 0.0,
            police_percent: 0.0,
            fire_percent: 0.0,
            road_value: 0,
            police_value: 0,
            fire_value: 0,
            total_funds: 0,
            auto_bulldoze: true,
            auto_budget: true,
            cash_flow: 0,
            city_tax_average: 0,

            city_yes: 0,
            problem_votes: [0; PROBNUM],
            problem_order: [0; CVP_PROBLEM_COMPLAINTS],
            city_pop: 0,
            city_pop_delta: 0,
            city_assessed_value: 0,
            city_class: CityClass::Village,
            city_score: 0,
            city_score_delta: 0,
            traffic_average: 0,
            city_pop_last: 0,
            category_last: 0,

            terrain_tree_level: -1,
            terrain_lake_level: -1,
            terrain_curve_level: -1,
            terrain_create_island: -1,

            sim_loops: 0,
            sim_passes: 0,
            sim_pass: 0,
            sim_paused: false,
            sim_paused_speed: 3,
            sim_speed: 0,
            sim_speed_meta: 0,
            heat_steps: 0,
            heat_flow: -7,
            heat_rule: 0,
            heat_wrap: 3,
            city_name: String::new(),
            game_level: GameLevel::Easy,
            scenario: Scenario::None,
            enable_disasters: true,
            do_animation: true,
            do_messages: true,
            do_notices: true,
            tiles_animated: false,
            init_sim_load: 0,

            new_map: 0,
            new_map_flags: [0; MAP_TYPE_COUNT],
            city_center_x: 0,
            city_center_y: 0,
            pollution_max_x: 0,
            pollution_max_y: 0,
            crime_max_x: 0,
            crime_max_y: 0,
            don_dither: 0,
            power_stack: vec![Position::default(); ((world_w as usize) * (world_h as usize)) / 4],
            power_stack_pointer: 0,
            cur_map_stack: [Position::default(); MAX_TRAFFIC_DISTANCE + 1],
            cur_map_stack_pointer: 0,
            traf_max_x: 0,
            traf_max_y: 0,

            valve_flag: false,
            crime_ramp: 0,
            pollution_ramp: 0,
            res_cap: false,
            com_cap: false,
            ind_cap: false,
            external_market: 4.0,
            disaster_event: Scenario::None,
            disaster_wait: 0,
            score_type: Scenario::None,
            score_wait: 0,
            powered_zone_count: 0,
            unpowered_zone_count: 0,
            new_power: false,
            sim_cycle: 0,
            phase_cycle: 0,
            speed_cycle: 0,
            do_initial_eval: false,
            map_serial: 1,
            res_valve: 0,
            com_valve: 0,
            ind_valve: 0,
            flood_count: 0,
            sprite_cycle: 0,

            city_time_last: 0,
            city_year_last: 0,
            city_month_last: 0,
            total_funds_last: 0,
            res_last: 0,
            com_last: 0,
            ind_last: 0,
            // @init:power (agent power: initialise your extra fields right below this line)

            // @init:scan (agent scan: initialise your extra fields right below this line)
            eval_changed: false,
            must_draw_budget: false,
            // @init:evaluate (agent evaluate: initialise your extra fields right below this line)

            // @init:generate (agent generate: initialise your extra fields right below this line)
            generated_city_seed: 0,
            // @init:zone (agent zone: initialise your extra fields right below this line)

            // @init:traffic (agent traffic: initialise your extra fields right below this line)

            // @init:tool (agent tool: initialise your extra fields right below this line)

            // @init:sprite (agent sprite: initialise your extra fields right below this line)
            sprites: Vec::new(),
            sprite_list: None,
            free_sprites: None,
            global_sprites: [None; crate::sprite::SPRITE_COUNT],
            abs_dist: 0,
            // @init:simulate (agent simulate: initialise your extra fields right below this line)

            // @init:misc (agent misc: initialise your extra fields right below this line)
            enable_sound: false,
            auto_goto: false,
            must_update_funds: false,
            must_update_options: false,
            history_initialized: false,
        }
    }

    /// Simulator for the original 120x100 world.
    pub fn with_default_size() -> Self {
        Self::new(crate::DEFAULT_WORLD_W, crate::DEFAULT_WORLD_H)
    }

    /// Queue an event for the adapter (outgoing port).
    pub fn push_event(&mut self, e: Event) {
        self.events.push(e);
    }

    /// Take all pending events, oldest first.
    pub fn drain_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    /// `(year, month 0..12)` of the city clock (48 city times per year).
    pub fn calendar(&self) -> (i64, i64) {
        (
            self.city_time / CITYTIMES_PER_YEAR as i64 + self.starting_year as i64,
            (self.city_time % CITYTIMES_PER_YEAR as i64) / CITYTIMES_PER_MONTH as i64,
        )
    }

    pub fn world_size(&self) -> (i32, i32) {
        (self.world_w, self.world_h)
    }

    pub fn on_map(&self, x: i32, y: i32) -> bool {
        x >= 0 && x < self.world_w && y >= 0 && y < self.world_h
    }

    #[inline]
    fn tile_index(&self, x: i32, y: i32) -> usize {
        (x as usize) * (self.world_h as usize) + (y as usize)
    }

    /// Tile at `(x, y)`; out-of-world reads return `None`.
    pub fn tile(&self, x: i32, y: i32) -> Option<Tile> {
        self.on_map(x, y).then(|| self.tiles[self.tile_index(x, y)])
    }

    /// Writes are ignored outside the world; returns whether it was written.
    pub fn set_tile(&mut self, x: i32, y: i32, t: Tile) -> bool {
        if !self.on_map(x, y) {
            return false;
        }
        let i = self.tile_index(x, y);
        self.tiles[i] = t;
        true
    }

    /// Port of `initWillStuff` (without the front-end callbacks and sprite
    /// destruction, which have no counterpart yet). `randomlySeedRandom` is
    /// deliberately not done here: determinism is a goal, so the caller seeds
    /// `self.rng` explicitly.
    pub fn init_will_stuff(&mut self) {
        self.init_graph_max();
        self.destroy_all_sprites();
        self.road_effect = MAX_ROAD_EFFECT;
        self.police_effect = MAX_POLICE_STATION_EFFECT;
        self.fire_effect = MAX_FIRE_STATION_EFFECT;
        self.city_score = 500;
        self.city_pop = -1;
        self.city_time_last = -1;
        self.city_year_last = -1;
        self.city_month_last = -1;
        self.total_funds_last = -1;
        self.res_last = -999_999;
        self.com_last = -999_999;
        self.ind_last = -999_999;
        self.road_fund = 0;
        self.police_fund = 0;
        self.fire_fund = 0;
        self.valve_flag = true;
        self.disaster_event = Scenario::None;
        self.tax_flag = false;
        self.clear_derived_maps();
    }

    fn clear_derived_maps(&mut self) {
        self.population_density_map.clear();
        self.traffic_density_map.clear();
        self.pollution_density_map.clear();
        self.land_value_map.clear();
        self.crime_rate_map.clear();
        self.terrain_density_map.clear();
        self.rate_of_growth_map.clear();
        self.com_rate_map.clear();
        self.police_station_map.clear();
        self.police_station_effect_map.clear();
        self.fire_station_map.clear();
        self.fire_station_effect_map.clear();
    }

    /// Port of `initGraphMax` (graph.cpp): clamp history to >= 0 and compute
    /// the maxima of the 10-year window (indices 0..=118) and of the 120-year
    /// window (indices 120..=238).
    pub fn init_graph_max(&mut self) {
        fn window_max(h: &mut [i16], range: std::ops::RangeInclusive<usize>) -> i16 {
            let mut max = 0;
            for x in range.rev() {
                if h[x] < 0 {
                    h[x] = 0;
                }
                max = max.max(h[x]);
            }
            max
        }
        self.res_hist10_max = window_max(&mut self.res_hist, 0..=118);
        self.com_hist10_max = window_max(&mut self.com_hist, 0..=118);
        self.ind_hist10_max = window_max(&mut self.ind_hist, 0..=118);
        self.graph10_max = self
            .res_hist10_max
            .max(self.com_hist10_max)
            .max(self.ind_hist10_max);
        self.res_hist120_max = window_max(&mut self.res_hist, 120..=238);
        self.com_hist120_max = window_max(&mut self.com_hist, 120..=238);
        self.ind_hist120_max = window_max(&mut self.ind_hist, 120..=238);
        self.graph120_max = self
            .res_hist120_max
            .max(self.com_hist120_max)
            .max(self.ind_hist120_max);
    }

    /// Port of `setCommonInits` (`evalInit` is part of the evaluate module).
    pub fn set_common_inits(&mut self) {
        self.road_effect = MAX_ROAD_EFFECT;
        self.police_effect = MAX_POLICE_STATION_EFFECT;
        self.fire_effect = MAX_FIRE_STATION_EFFECT;
        self.tax_flag = false;
        self.tax_fund = 0;
    }

    /// Port of `initSimMemory`, minus `doPowerScan` (power module to come):
    /// state of a brand new city.
    pub fn init_sim_memory(&mut self) {
        self.set_common_inits();
        for x in 0..HISTORY_LEN {
            self.res_hist[x] = 0;
            self.com_hist[x] = 0;
            self.ind_hist[x] = 0;
            self.money_hist[x] = 128;
            self.crime_hist[x] = 0;
            self.pollution_hist[x] = 0;
        }
        self.crime_ramp = 0;
        self.pollution_ramp = 0;
        self.total_pop = 0;
        self.res_valve = 0;
        self.com_valve = 0;
        self.ind_valve = 0;
        self.res_cap = false;
        self.com_cap = false;
        self.ind_cap = false;
        self.external_market = 6.0;
        self.disaster_event = Scenario::None;
        self.score_type = Scenario::None;
        self.power_stack_pointer = 0;
        self.new_power = true;
        self.init_sim_load = 0;
    }

    /// Port of `setGameLevelFunds`.
    pub fn set_game_level_funds(&mut self, level: GameLevel) {
        self.total_funds = level.initial_funds();
        self.game_level = level;
    }

    /// Port of `initGame` (stubs.cpp): simulation running, speed 0.
    pub fn init_game(&mut self) {
        self.sim_paused = false;
        self.sim_paused_speed = 0;
        self.sim_pass = 0;
        self.sim_passes = 1;
        self.heat_steps = 0;
        self.sim_speed = 0;
    }

    /// A new city on an empty map: everything `initWillStuff` +
    /// `initSimMemory` + `setGameLevelFunds` + `initGame` do, with an explicit
    /// seed for the random generator.
    pub fn new_city(&mut self, level: GameLevel, seed: i32) {
        self.tiles.fill(0);
        self.rng.seed(seed);
        self.init_will_stuff();
        self.init_sim_memory();
        self.set_game_level_funds(level);
        self.init_game();
        self.push_event(Event::NewCity);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_size_map_dimensions_match_cpp() {
        let s = Simulation::with_default_size();
        assert_eq!(s.world_size(), (120, 100));
        assert_eq!(s.tiles.len(), 12_000);
        assert_eq!(s.population_density_map.size(), (60, 50));
        assert_eq!(s.terrain_density_map.size(), (30, 25));
        assert_eq!(s.power_grid_map.size(), (120, 100));
        assert_eq!(s.rate_of_growth_map.size(), (15, 13));
        // POWER_STACK_SIZE = WORLD_W * WORLD_H / 4
        assert_eq!(s.power_stack.len(), 3_000);
    }

    #[test]
    fn init_defaults_match_cpp() {
        let s = Simulation::with_default_size();
        assert_eq!(s.heat_flow, -7);
        assert_eq!(s.heat_wrap, 3);
        assert_eq!(s.sim_paused_speed, 3);
        assert_eq!(s.terrain_tree_level, -1);
        assert_eq!(s.external_market, 4.0);
        assert_eq!(s.map_serial, 1);
        assert!(s.auto_bulldoze && s.auto_budget && s.enable_disasters);
        assert_eq!(s.game_level, GameLevel::Easy);
    }

    #[test]
    fn tile_access_is_column_major_and_bounded() {
        let mut s = Simulation::new(10, 7);
        assert!(s.set_tile(3, 5, 42));
        assert_eq!(s.tiles[3 * 7 + 5], 42);
        assert_eq!(s.tile(3, 5), Some(42));
        assert!(!s.set_tile(10, 0, 1));
        assert_eq!(s.tile(-1, 0), None);
    }

    #[test]
    fn new_city_state_and_funds() {
        let mut s = Simulation::with_default_size();
        s.new_city(GameLevel::Hard, 7);
        assert_eq!(s.total_funds, 5_000);
        assert_eq!(s.city_score, 500);
        assert_eq!(s.road_effect, 32);
        assert_eq!(s.police_effect, 1000);
        assert_eq!(s.external_market, 6.0);
        assert!(s.valve_flag && s.new_power);
        assert!(s.money_hist.iter().all(|&v| v == 128));
        assert_eq!(s.res_last, -999_999);
        assert_eq!(s.sim_passes, 1);
    }

    #[test]
    fn new_city_is_deterministic() {
        let mut a = Simulation::with_default_size();
        let mut b = Simulation::with_default_size();
        a.new_city(GameLevel::Easy, 123);
        b.new_city(GameLevel::Easy, 123);
        assert_eq!(a.rng.random16(), b.rng.random16());
        assert_eq!(a.tiles, b.tiles);
    }

    #[test]
    fn init_graph_max_clamps_and_takes_max() {
        let mut s = Simulation::new(10, 10);
        s.res_hist[5] = 40;
        s.com_hist[7] = -3;
        s.ind_hist[118] = 90;
        s.ind_hist[119] = 500; // outside the 10-year window
        s.init_graph_max();
        assert_eq!(s.com_hist[7], 0);
        assert_eq!(s.res_hist10_max, 40);
        assert_eq!(s.ind_hist10_max, 90);
        assert_eq!(s.graph10_max, 90);
        s.res_hist[120] = 7;
        s.com_hist[238] = 11;
        s.com_hist[239] = 999; // outside both windows
        s.ind_hist[119] = -5; // between windows: untouched
        s.init_graph_max();
        assert_eq!(s.res_hist120_max, 7);
        assert_eq!(s.com_hist120_max, 11);
        assert_eq!(s.graph120_max, 11);
        assert_eq!(s.ind_hist[119], -5);
    }

    #[test]
    fn supports_large_worlds() {
        let s = Simulation::new(850, 700);
        assert_eq!(s.tiles.len(), 595_000);
    }
}
