//! Port of `initialize.cpp`. `initWillStuff` lives in `simulation.rs`
//! (`init_will_stuff`); the two functions below are empty in the original.

use crate::simulation::Simulation;

impl Simulation {
    /// Port of `resetMapState` (empty in the original).
    pub fn reset_map_state(&mut self) {}

    /// Port of `resetEditorState` (empty in the original).
    pub fn reset_editor_state(&mut self) {}
}
