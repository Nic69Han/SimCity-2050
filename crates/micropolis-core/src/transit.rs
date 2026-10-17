//! Metro (docs/game-design-v02.md): stations and underground tunnels; traffic falls around the
//! linked stations and land value rises. Active when [`Extensions::transit_rules`] is on.
//!
//! Platform phase: this module is delivered empty. [`TransitNetwork`] only owns the underground
//! layer of the tunnels and stations (its bytes are the workstream's to define; 0 = nothing), and
//! the functions have the signatures the hooks of [`extensions`](crate::extensions) call,
//! returning their input unchanged. The network is saved in its own chunk (the layer's bytes).
//!
//! Rules for the workstream: no random number, no allocation in a hook, every line search
//! bounded by a named constant and tested.

use crate::simulation::Simulation;
use crate::underground::UndergroundLayer;

/// The metro network of a city: stations and tunnels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransitNetwork {
    /// Underground tunnels and stations, one byte per tile.
    pub underground: UndergroundLayer,
}

impl TransitNetwork {
    /// An empty network for a `width` x `height` map.
    pub fn new(width: i32, height: i32) -> TransitNetwork {
        TransitNetwork {
            underground: UndergroundLayer::new(width, height),
        }
    }

    /// Whether the network holds nothing (it then adds nothing to a saved file).
    pub fn is_empty(&self) -> bool {
        self.underground.is_empty()
    }

    /// The bytes of the transit chunk: the underground layer; nothing when the network is empty.
    pub fn encode(&self) -> Vec<u8> {
        self.underground.encode()
    }

    /// The network stored in `bytes` for a `width` x `height` map (empty: an empty network).
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<TransitNetwork, &'static str> {
        let underground = UndergroundLayer::from_raw(width, height, bytes)
            .ok_or("transit chunk does not match the map")?;
        Ok(TransitNetwork { underground })
    }
}

/// Net cost of the metro for one tax collection, in dollars (a cost is positive).
pub(crate) fn monthly_balance(_sim: &Simulation) -> i32 {
    0
}

/// Land value `v` (1..=250) at world tile `(x, y)`, after the metro.
pub(crate) fn land_value(_sim: &Simulation, _x: i32, _y: i32, v: i32) -> i32 {
    v
}

/// Traffic density `t` (0..=255) at world tile `(x, y)`, after the metro.
pub(crate) fn traffic(_sim: &Simulation, _x: i32, _y: i32, t: i32) -> i32 {
    t
}

/// Adjusts the zoning valves after `set_valves` computed them.
pub(crate) fn valves(_sim: &mut Simulation) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_network_encodes_to_nothing_and_round_trips_with_tunnels() {
        let mut t = TransitNetwork::new(80, 67);
        assert!(t.is_empty() && t.encode().is_empty());
        assert_eq!(TransitNetwork::decode(&[], 80, 67), Ok(t.clone()));
        t.underground.set(9, 9, 3);
        let bytes = t.encode();
        assert_eq!(TransitNetwork::decode(&bytes, 80, 67), Ok(t));
        assert!(TransitNetwork::decode(&[1, 2], 80, 67).is_err());
    }
}
