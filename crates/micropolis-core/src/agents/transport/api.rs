//! What a [`Simulation`] answers about the buses and taxis.

use super::{Audit, Transport, TransportCounters};
use crate::simulation::Simulation;

impl Simulation {
    fn transport(&self) -> Option<&Transport> {
        self.agent_run()?.transport.as_deref()
    }

    /// `[buses, taxis, waiting_riders, bus_trips_month, taxi_rides_month, income_month]`;
    /// zeros unless both the cars and the buildings rules are on. The `_month` values count from
    /// the last monthly balance.
    pub fn transport_stats(&self) -> [i32; 6] {
        self.transport().map_or([0; 6], Transport::stats)
    }

    /// `[trains, metro_cars, train_riders_month, metro_riders_month, rail_income_month,
    /// train_lines, metro_lines]`; zeros unless the transport runs. The `_month` values count
    /// from the last monthly balance.
    pub fn rail_stats(&self) -> [i32; 7] {
        self.transport().map_or([0; 7], Transport::rail_stats)
    }

    /// Everything the transport counted since it started (all zero while it is off).
    pub fn transport_counters(&self) -> TransportCounters {
        self.transport()
            .map_or_else(Default::default, |t| t.counters)
    }

    /// Where the riders are now (all zero while the transport is off).
    pub fn transport_audit(&self) -> Audit {
        self.transport()
            .map_or_else(Default::default, Transport::audit)
    }

    /// The transport itself, for tests that look inside (`None` while it is off).
    pub fn transport_state(&self) -> Option<&Transport> {
        self.transport()
    }

    /// The fares of the month in dollars, which the monthly balance takes (they start again
    /// from zero). Zero while the transport is off.
    pub(crate) fn take_transport_income(&mut self) -> i32 {
        let ext = self.extensions_mut();
        if !ext.agents {
            return 0;
        }
        let run = ext.fleet.run_mut();
        run.and_then(|r| r.transport.as_deref_mut())
            .map_or(0, |t| t.counters.take_month())
    }
}
