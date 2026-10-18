//! The road graph read from the tile map: which tiles a car can drive on and where the
//! residential and job zones are. A tile is a node, its four road neighbours are its edges, so
//! the graph is the classified map itself; it is rebuilt (by [`RoadGraph::scan`]) only when the
//! scan differs from the one in use. Tile indices are column-major, `x * height + y`, like
//! `Simulation::tiles`.

use crate::simulation::Simulation;
use crate::tile::{Tile, COMBASE, HOSPITALBASE, INDBASE, LOMASK, PORTBASE, POWERBASE, RESBASE};
use crate::tile::{HRAILROAD, ROADBASE, RZB, VRAILROAD, ZONEBIT};

pub const CLASS_NONE: u8 = 0;
pub const CLASS_ROAD: u8 = 1;
pub const CLASS_RES: u8 = 2;
pub const CLASS_COM: u8 = 3;
pub const CLASS_IND: u8 = 4;

/// Offsets around a 3x3 zone where an access road is looked for, in the classic order.
const ACCESS_RING: [(i32, i32); 12] = [
    (-1, -2),
    (0, -2),
    (1, -2),
    (2, -1),
    (2, 0),
    (2, 1),
    (1, 2),
    (0, 2),
    (-1, 2),
    (-2, 1),
    (-2, 0),
    (-2, -1),
];

/// Neighbour offsets: north, east, south, west.
pub const STEPS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// Class of a tile: road (rail crossings included, as in `Simulation::road_test`), or the centre
/// of a residential, commercial or industrial zone.
pub fn classify(tile: Tile) -> u8 {
    let t = tile & LOMASK;
    if (ROADBASE..POWERBASE).contains(&t) || t == HRAILROAD || t == VRAILROAD {
        return CLASS_ROAD;
    }
    if tile & ZONEBIT == 0 {
        return CLASS_NONE;
    }
    match t {
        t if (RZB.max(RESBASE)..HOSPITALBASE).contains(&t) => CLASS_RES,
        t if (COMBASE..INDBASE).contains(&t) => CLASS_COM,
        t if (INDBASE..PORTBASE).contains(&t) => CLASS_IND,
        _ => CLASS_NONE,
    }
}

/// A zone centre with the road tile that serves it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Zone {
    pub kind: u8,
    /// Index of the centre tile.
    pub tile: u32,
    /// Residents (residential zones only, else 0).
    pub pop: i32,
    /// Index of the first road tile of the access ring.
    pub access: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RoadGraph {
    pub w: i32,
    pub h: i32,
    class: Vec<u8>,
    /// Zones in tile order.
    pub zones: Vec<Zone>,
    /// Indices (into `zones`) of the residential zones with an access road.
    pub residential: Vec<u32>,
    /// Indices of the commercial and industrial zones with an access road.
    pub jobs: Vec<u32>,
    /// Road tile indices in increasing order.
    pub roads: Vec<u32>,
}

impl RoadGraph {
    /// Reads the map of `sim`.
    pub fn scan(sim: &Simulation) -> Self {
        let (w, h) = sim.world_size();
        let class: Vec<u8> = sim.tiles.iter().map(|&t| classify(t)).collect();
        let mut g = RoadGraph {
            w,
            h,
            class,
            ..RoadGraph::default()
        };
        for (i, &c) in g.class.clone().iter().enumerate() {
            let i = i as u32;
            match c {
                CLASS_ROAD => g.roads.push(i),
                CLASS_RES | CLASS_COM | CLASS_IND => g.add_zone(sim, i, c),
                _ => {}
            }
        }
        g
    }

    fn add_zone(&mut self, sim: &Simulation, tile: u32, kind: u8) {
        let (x, y) = self.xy(tile);
        let access = ACCESS_RING
            .iter()
            .filter_map(|&(dx, dy)| self.index(x + dx, y + dy))
            .find(|&i| self.is_road(i));
        let pop = if kind == CLASS_RES {
            i32::from(sim.get_res_zone_pop(sim.tiles[tile as usize] & LOMASK))
        } else {
            0
        };
        let at = self.zones.len() as u32;
        self.zones.push(Zone {
            kind,
            tile,
            pop,
            access,
        });
        if access.is_some() {
            if kind == CLASS_RES {
                self.residential.push(at);
            } else {
                self.jobs.push(at);
            }
        }
    }

    pub fn class_len(&self) -> usize {
        self.class.len()
    }

    pub fn is_road(&self, i: u32) -> bool {
        self.class.get(i as usize) == Some(&CLASS_ROAD)
    }

    pub fn xy(&self, i: u32) -> (i32, i32) {
        (i as i32 / self.h, i as i32 % self.h)
    }

    pub fn index(&self, x: i32, y: i32) -> Option<u32> {
        (x >= 0 && y >= 0 && x < self.w && y < self.h).then(|| (x * self.h + y) as u32)
    }

    /// The road neighbours of tile `i` (north, east, south, west order).
    pub fn road_neighbours(&self, i: u32) -> [Option<u32>; 4] {
        let (x, y) = self.xy(i);
        STEPS.map(|(dx, dy)| self.index(x + dx, y + dy).filter(|&n| self.is_road(n)))
    }

    /// Position in `zones` of the zone centred on tile `tile`.
    pub fn zone_at(&self, tile: u32) -> Option<usize> {
        self.zones.binary_search_by_key(&tile, |z| z.tile).ok()
    }
}
