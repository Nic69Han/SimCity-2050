//! The bus stops and depots of the city as the transport reads them: the intact buildings of
//! the structure list, each with the road tile that serves it. A building with no road next to
//! it is left out (it does nothing). Built in list order, so the order is fixed.

use super::{GENRE_BUS_DEPOT, GENRE_BUS_STOP, GENRE_TAXI_DEPOT, WALK_RADIUS};
use crate::agents::graph::{RoadGraph, STEPS};
use crate::simulation::Simulation;
use crate::structures::StructureView;

/// A building of the network: the index of its top-left tile (its identity) and its road.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Site {
    pub id: u32,
    /// Index of the first road tile touching the footprint (rows top to bottom, north, east,
    /// south, west).
    pub access: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Net {
    pub stops: Vec<Site>,
    pub bus_depots: Vec<Site>,
    pub taxi_depots: Vec<Site>,
}

/// The first road tile that touches the footprint of `v`.
fn access_of(g: &RoadGraph, v: &StructureView) -> Option<u32> {
    (0..v.height)
        .flat_map(|dy| (0..v.width).map(move |dx| (v.x + dx, v.y + dy)))
        .flat_map(|(x, y)| STEPS.map(|(sx, sy)| (x + sx, y + sy)))
        .filter(|&(x, y)| {
            let inside = (v.x..v.x + v.width).contains(&x) && (v.y..v.y + v.height).contains(&y);
            !inside
        })
        .filter_map(|(x, y)| g.index(x, y))
        .find(|&i| g.is_road(i))
}

impl Net {
    /// The intact stops and depots of `sim` that have a road.
    pub fn build(sim: &Simulation, g: &RoadGraph) -> Net {
        let mut net = Net::default();
        for v in sim.structures() {
            if !matches!(v.genre, GENRE_BUS_STOP | GENRE_BUS_DEPOT | GENRE_TAXI_DEPOT) {
                continue;
            }
            let (Some(id), Some(access)) = (g.index(v.x, v.y), access_of(g, &v)) else {
                continue;
            };
            let site = Site { id, access };
            match v.genre {
                GENRE_BUS_STOP => net.stops.push(site),
                GENRE_BUS_DEPOT => net.bus_depots.push(site),
                GENRE_TAXI_DEPOT => net.taxi_depots.push(site),
                _ => {}
            }
        }
        net
    }

    /// Index of the stop nearest to the tile `tile` (a zone centre) within [`WALK_RADIUS`]
    /// tiles; the first one on a tie.
    pub fn stop_near(&self, g: &RoadGraph, tile: u32) -> Option<usize> {
        let mut best: Option<(u32, usize)> = None;
        for (i, s) in self.stops.iter().enumerate() {
            let d = g.distance(tile, s.id);
            if d <= WALK_RADIUS as u32 && best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, i));
            }
        }
        best.map(|(_, i)| i)
    }
}
