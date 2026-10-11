//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::simulation::Simulation;

impl Simulation {
    /// Owned by the `stubs` module (`Micropolis::spend`).
    pub(crate) fn spend(&mut self, _dollars: i32) {
        todo!("shim: spend")
    }

    /// Owned by the `update` module (`Micropolis::doUpdateHeads`).
    pub(crate) fn do_update_heads(&mut self) {
        todo!("shim: do_update_heads")
    }

    /// Owned by the `utilities` module (`Micropolis::setAutoBudget`).
    pub(crate) fn set_auto_budget(&mut self, _value: bool) {
        todo!("shim: set_auto_budget")
    }

    /// Owned by the `message` module (`Micropolis::sendMessage`).
    pub(crate) fn send_message(
        &mut self,
        _mnum: i16,
        _x: i16,
        _y: i16,
        _picture: bool,
        _important: bool,
    ) {
        todo!("shim: send_message")
    }
}
