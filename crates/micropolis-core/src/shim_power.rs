//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::simulation::Simulation;

impl Simulation {
    /// Shim for `Micropolis::sendMessage` (message.cpp, owned by the message module).
    #[allow(dead_code)]
    pub(crate) fn send_message(
        &mut self,
        _mnum: i16,
        _x: i32,
        _y: i32,
        _picture: bool,
        _important: bool,
    ) {
        todo!("shim: send_message belongs to the message module")
    }
}
