//! Rust port of the Micropolis simulation engine (derived from MicropolisCore, GPL).
//!
//! The engine is UI-independent and deterministic: same seed, same city.
//! Unlike the C++ original, world dimensions are runtime parameters, so the
//! map can be made far larger than the original 120x100.

pub mod animate;
pub mod budget;
pub mod budget_api;
pub mod connect;
pub mod disasters;
pub mod evaluate;
pub mod generate;
pub mod graph;
pub mod initialize;
pub mod message;
pub mod power;
pub mod scan;
pub mod simulate;
pub mod sprite;
pub mod stubs;
pub mod tool;
pub mod traffic;
pub mod update;
pub mod utilities;
pub mod zone;

pub mod events;
pub mod fileio;
pub mod map;
pub mod position;
pub mod rng;
pub mod simulation;
pub mod tile;
pub mod tile_chars;

/// World size of the original game, kept as the default.
pub const DEFAULT_WORLD_W: i32 = 120;
pub const DEFAULT_WORLD_H: i32 = 100;
