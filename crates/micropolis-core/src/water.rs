//! Water network (docs/game-design-v02.md): pumps and underground pipes; a zone without water
//! does not grow beyond a density ceiling. Active when [`Extensions::water_rules`] is on.
//!
//! Platform phase: this module is delivered empty. [`WaterNetwork`] only owns the underground
//! layer of the pipes (its bytes are the workstream's to define; 0 = no pipe), and the functions
//! have the signatures the hooks of [`extensions`](crate::extensions) call, returning their
//! input unchanged. The network is saved in its own chunk (the layer's bytes).
//!
//! Rules for the workstream: no random number, no allocation in a hook, every propagation
//! bounded by a named constant and tested.

use crate::position::Position;
use crate::simulation::Simulation;
use crate::traffic::ZoneType;
use crate::underground::UndergroundLayer;

/// The water network of a city: pumps and pipes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WaterNetwork {
    /// Underground pipes, one byte per tile.
    pub pipes: UndergroundLayer,
}

impl WaterNetwork {
    /// An empty network for a `width` x `height` map.
    pub fn new(width: i32, height: i32) -> WaterNetwork {
        WaterNetwork {
            pipes: UndergroundLayer::new(width, height),
        }
    }

    /// Whether the network holds nothing (it then adds nothing to a saved file).
    pub fn is_empty(&self) -> bool {
        self.pipes.is_empty()
    }

    /// The bytes of the water chunk: the pipes layer; nothing when the network is empty.
    pub fn encode(&self) -> Vec<u8> {
        self.pipes.encode()
    }

    /// The network stored in `bytes` for a `width` x `height` map (empty: an empty network).
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<WaterNetwork, &'static str> {
        let pipes = UndergroundLayer::from_raw(width, height, bytes)
            .ok_or("water chunk does not match the map")?;
        Ok(WaterNetwork { pipes })
    }
}

/// Net cost of the water network for one tax collection, in dollars (a cost is positive).
pub(crate) fn monthly_balance(_sim: &Simulation) -> i32 {
    0
}

/// Adjusts the zoning valves after `set_valves` computed them.
pub(crate) fn valves(_sim: &mut Simulation) {}

/// Whether water lets a zone of `kind` at `pos` grow.
pub(crate) fn zone_can_grow(_sim: &Simulation, _pos: Position, _kind: ZoneType) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_network_encodes_to_nothing_and_round_trips_with_pipes() {
        let mut w = WaterNetwork::new(80, 67);
        assert!(w.is_empty() && w.encode().is_empty());
        assert_eq!(WaterNetwork::decode(&[], 80, 67), Ok(w.clone()));
        w.pipes.set(5, 6, 1);
        let bytes = w.encode();
        assert_eq!(bytes.len(), 80 * 67);
        assert_eq!(WaterNetwork::decode(&bytes, 80, 67), Ok(w));
        assert!(WaterNetwork::decode(&bytes[1..], 80, 67).is_err());
    }
}
