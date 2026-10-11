//! Outgoing port. The C++ engine notifies its front-end through
//! `callback("name", "params", ...)`; here the core appends [`Event`]s to a
//! queue and the adapter drains it (`Simulation::drain_events`). The core never
//! calls the outside world.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// A city was loaded or created: redraw everything.
    NewCity,
    /// Funds changed (`updateFunds`).
    FundsChanged(i64),
    /// Speed, tax or option flags changed (`mustUpdateOptions`).
    OptionsChanged,
}
