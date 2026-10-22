//! The SimCity 3000 disasters (docs/game-design-v13.md): a **riot**, a **UFO**, a **meteor** and a
//! **drought**, behind the switch [`Extensions::disasters2`](crate::extensions::Extensions::disasters2),
//! off by default. Off, nothing here acts: the hooks answer their input, the calls are refused, no
//! random number is drawn and the engine (and its generator's sequence) is the original.
//!
//! * **When.** At the yearly pass (`ext_monthly_balance`, once per tax collection) each kind gets one
//!   chance per year, in this order: riot, UFO, meteor, drought. Only while the rule is on **and**
//!   `Simulation::enable_disasters` is on; the draws come from the engine's own generator
//!   (`Simulation::rng`), one `random(999) < chance` per kind (per mille: [`RIOT_CHANCE`],
//!   [`UFO_CHANCE`], [`METEOR_CHANCE`], [`DROUGHT_CHANCE`]). The riot draws only when its
//!   condition holds, the drought only when none is running. On demand
//!   ([`trigger_disaster`](Simulation::trigger_disaster)) a disaster needs the rule but not
//!   `enable_disasters`, no chance and, for the riot, no crime condition.
//! * **Riot** ([`riot`]): needs a residential zone; centre = the residential zone whose crime block
//!   is the highest (ties: smaller x, then smaller y); [`RIOT_FIRES`] classic fires within
//!   [`RIOT_RADIUS`]; message [`MESSAGE_RIOTS_REPORTED`] (the classic riot message, number 44).
//! * **UFO** ([`ufo`]): a strip of [`UFO_LENGTH`] tiles in one of the 4 directions; each tile is
//!   destroyed like the monster does (`destroy_map_tile`, water spared); message [`MESSAGE_UFO`].
//! * **Meteor** ([`meteor`]): a 3 x 3 crater of classic rubble (water spared) with a classic fire at
//!   the centre; message [`MESSAGE_METEOR`].
//! * **Drought** ([`drought`]): [`DROUGHT_MONTHS`] months; while it lasts the residential valve loses
//!   [`DROUGHT_VALVE`] at each valves computation and, with the water rule on, the reach of the
//!   pumps is divided by [`DROUGHT_PUMP_DIV`]. One month goes by per game month
//!   (`city_time`), counted in the valves hook (every `set_valves`), not at the tax pass: a drought
//!   lasts exactly [`DROUGHT_MONTHS`] months, started at a pass, on demand or in a city without
//!   residents. Message [`MESSAGE_DROUGHT`].
//! * **Fires and rubble** are the classic tiles ([`random_fire`](crate::disasters::random_fire),
//!   [`random_rubble`](crate::disasters::random_rubble)); the engine's own `do_fire` then spreads
//!   and extinguishes them like any fire.
//! * **Save**: chunk 14 ([`DisasterState::encode`]): the months of drought left (2 bytes), written
//!   only when not 0. The last disaster reported by the stats is runtime state, not saved.
//!
//! Every loop is bounded by a named constant, a footprint or the map size.

pub mod drought;
pub mod meteor;
pub mod riot;
mod rules;
mod state;
pub mod ufo;

use rules::draw;
pub(crate) use rules::{monthly_balance, valves};
pub use rules::{DisasterResult, STATS_SIZE};
pub use state::{DisasterReport, DisasterState};

pub use crate::message::MESSAGE_RIOTS_REPORTED;

/// Message: a UFO crossed the city (x, y: where it came from).
pub const MESSAGE_UFO: i16 = 59;
/// Message: a meteor fell (x, y: the crater).
pub const MESSAGE_METEOR: i16 = 60;
/// Message: a drought begins (no position).
pub const MESSAGE_DROUGHT: i16 = 61;

/// Kind of disaster for [`trigger_disaster`](crate::simulation::Simulation::trigger_disaster).
pub const KIND_RIOT: i32 = 1;
pub const KIND_UFO: i32 = 2;
pub const KIND_METEOR: i32 = 3;
pub const KIND_DROUGHT: i32 = 4;
/// Last kind: the kinds are `1..=KIND_LAST`.
pub const KIND_LAST: i32 = KIND_DROUGHT;

/// Yearly chance of a riot, per mille, when its condition holds.
pub const RIOT_CHANCE: i16 = 200;
/// Yearly chance of a UFO, per mille.
pub const UFO_CHANCE: i16 = 20;
/// Yearly chance of a meteor, per mille.
pub const METEOR_CHANCE: i16 = 30;
/// Yearly chance of a drought, per mille.
pub const DROUGHT_CHANCE: i16 = 50;
/// Draw range of a chance: `random(CHANCE_RANGE - 1) < chance`.
pub const CHANCE_RANGE: i16 = 1000;

/// Mean crime (`crime_average`) from which a riot may break out.
pub const RIOT_CRIME_MIN: i32 = 120;
/// Satisfaction (`city_yes`, percent) below which a riot may break out.
pub const RIOT_APPROVAL_MAX: i32 = 40;
/// Fires of a riot.
pub const RIOT_FIRES: usize = 6;
/// Radius (in tiles, square) around the riot centre where the fires start.
pub const RIOT_RADIUS: i32 = 6;
/// Tiles tried for each fire of a riot.
pub const RIOT_TRIES_PER_FIRE: usize = 8;

/// Tiles in the strip of a UFO.
pub const UFO_LENGTH: i32 = 20;

/// Months of a drought.
pub const DROUGHT_MONTHS: u16 = 12;
/// Taken off the residential valve at each valves computation during a drought.
pub const DROUGHT_VALVE: i16 = 150;
/// Divisor of the reach of the pumps during a drought (with the water rule).
pub const DROUGHT_PUMP_DIV: u32 = 2;
/// Bytes of chunk 14.
pub const CHUNK_SIZE: usize = 2;
