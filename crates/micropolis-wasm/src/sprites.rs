//! wasm adapter: moving objects (translation only, ARCHITECTURE.md rule 4).
//!
//! The engine keeps its sprites in a linked list (`Simulation::sprite_list`);
//! this file flattens the active ones into plain integers for the page.

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Active sprites in the engine's list order, as flat records of 8
    /// integers: `[kind, frame, x, y, x_hot, y_hot, width, height]`.
    ///
    /// `kind` is the `SpriteType` (1 train, 2 helicopter, 3 airplane, 4 ship,
    /// 5 monster, 6 tornado, 7 explosion, 8 bus). `x` and `y` are the sprite
    /// position in engine pixels (16 per tile). `x_hot`, `y_hot` give the
    /// point the engine uses for the sprite's location (`x + x_hot`,
    /// `y + y_hot`, as in its collision test). `width` and `height` are the
    /// size of the sprite's picture in engine pixels. Sprites whose `frame` is
    /// 0 are inactive and are left out.
    pub fn sprites(&self) -> Vec<i32> {
        let sim = &self.sim;
        let mut out = Vec::new();
        let mut cur = sim.sprite_list;
        while let Some(i) = cur {
            let s = &sim.sprites[i];
            if s.frame != 0 {
                out.extend_from_slice(&[
                    s.kind, s.frame, s.x, s.y, s.x_hot, s.y_hot, s.width, s.height,
                ]);
            }
            cur = s.next;
        }
        out
    }
}
