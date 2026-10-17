//! wasm adapter: The metro (docs/game-design-v02.md): stations and tunnels; the rules live in micropolis_core::transit (translation only, ARCHITECTURE.md rule 4).
//!
//! Platform phase: delivered empty. The transit workstream adds its methods in the `impl` block
//! below (one owner per file) and nothing else in the adapter; no game rule lives here.

use wasm_bindgen::prelude::*;

/// The transit methods of the page's `City`: none yet.
#[wasm_bindgen]
impl crate::City {}
