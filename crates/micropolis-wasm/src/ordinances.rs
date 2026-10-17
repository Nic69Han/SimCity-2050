//! wasm adapter: Ordinances (docs/game-design-v02.md): the player's city-wide decisions; the rules live in micropolis_core::ordinances (translation only, ARCHITECTURE.md rule 4).
//!
//! Platform phase: delivered empty. The ordinances workstream adds its methods in the `impl` block
//! below (one owner per file) and nothing else in the adapter; no game rule lives here.

use wasm_bindgen::prelude::*;

/// The ordinances methods of the page's `City`: none yet.
#[wasm_bindgen]
impl crate::City {}
