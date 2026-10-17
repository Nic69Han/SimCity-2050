//! wasm adapter: The water network (docs/game-design-v02.md): pumps and underground pipes; the rules live in micropolis_core::water (translation only, ARCHITECTURE.md rule 4).
//!
//! Platform phase: delivered empty. The water workstream adds its methods in the `impl` block
//! below (one owner per file) and nothing else in the adapter; no game rule lives here.

use wasm_bindgen::prelude::*;

/// The water methods of the page's `City`: none yet.
#[wasm_bindgen]
impl crate::City {}
