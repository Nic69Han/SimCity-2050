//! The measure of the services: who is served by which building. A pure function of the
//! simulation, recomputed when asked (monthly pass, statistics, layers).

use super::{met_pct, service_of, Class, Service, PRISON_DEMAND_DIV};
use crate::densities::{zone_genre, GENRE_RESIDENTIAL};
use crate::position::Position;
use crate::simulation::Simulation;
use crate::structures::Structure;

/// A working service building and the residents assigned to it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Placed {
    pub structure: Structure,
    pub service: &'static Service,
    /// Residents whose nearest building of this genre it is.
    pub assigned: i32,
}

impl Placed {
    /// Residents it serves: its capacity is shared among the assigned ones.
    pub fn served(&self) -> i32 {
        self.assigned.min(self.service.capacity)
    }

    /// Percent of its residents it can serve (100 when none is assigned).
    pub fn fill_pct(&self) -> i32 {
        met_pct(self.service.capacity, self.assigned)
    }
}

/// Who is served, at one moment.
#[derive(Debug, Clone, Default)]
pub(crate) struct Report {
    /// Residents of the whole city (classic population of the residential zones).
    pub residents: i32,
    /// The working service buildings, oldest first.
    pub placed: Vec<Placed>,
    /// Detainees the city would send to prison.
    pub prison_demand: i32,
}

impl Report {
    /// Residents served by the buildings of `genre`.
    pub fn served(&self, genre: u8) -> i32 {
        self.of_genre(genre).map(Placed::served).sum()
    }

    /// Places of the working buildings of `genre`.
    pub fn places(&self, genre: u8) -> i32 {
        self.of_genre(genre).map(|p| p.service.capacity).sum()
    }

    /// Percent of all the residents the buildings of `genre` serve.
    pub fn coverage_pct(&self, genre: u8) -> i32 {
        if self.residents == 0 {
            return 0;
        }
        self.served(genre) * 100 / self.residents
    }

    /// The sum of `weight x coverage` over the genres of `class`, in weight units.
    pub fn score(&self, class: Class) -> i32 {
        super::SERVICES
            .iter()
            .filter(|s| s.class == class)
            .map(|s| s.weight * self.coverage_pct(s.genre) / 100)
            .sum()
    }

    /// Percent of the prison demand the working prisons have a place for.
    pub fn prison_pct(&self) -> i32 {
        met_pct(self.places(super::GENRE_PRISON), self.prison_demand)
    }

    /// Detainees held: the demand, up to the places.
    pub fn detainees(&self) -> i32 {
        self.prison_demand.min(self.places(super::GENRE_PRISON))
    }

    fn of_genre(&self, genre: u8) -> impl Iterator<Item = &Placed> {
        self.placed.iter().filter(move |p| p.service.genre == genre)
    }
}

impl Simulation {
    /// Every residential zone of the map with residents: centre and classic population. Bounded
    /// by the map size.
    fn residential_zones(&self) -> Vec<(i32, i32, i32)> {
        let (w, h) = self.world_size();
        let mut out = Vec::new();
        for x in 0..w {
            for y in 0..h {
                let tile = self.tile(x, y).unwrap_or(0);
                if zone_genre(tile) != Some(GENRE_RESIDENTIAL) {
                    continue;
                }
                let pop = self.zone_population(Position::new(x, y), tile, GENRE_RESIDENTIAL);
                if pop > 0 {
                    out.push((x, y, pop));
                }
            }
        }
        out
    }

    /// The working service buildings (powered), oldest first, with nobody assigned yet.
    fn working_services(&self) -> Vec<Placed> {
        let list = self.extensions().structure_list.as_slice();
        list.iter()
            .filter_map(|s| {
                let service = service_of(s.genre)?;
                self.structure_works(s).then_some(Placed {
                    structure: *s,
                    service,
                    assigned: 0,
                })
            })
            .collect()
    }

    /// Measures the services. Bounded by the residential zones x the listed buildings.
    pub(crate) fn service_report(&self) -> Report {
        let mut placed = self.working_services();
        let zones = self.residential_zones();
        for &(x, y, pop) in &zones {
            for class in [Class::Education, Class::Health] {
                for genre in super::SERVICES.iter().filter(|s| s.class == class) {
                    if let Some(i) = nearest(&placed, genre.genre, x, y) {
                        placed[i].assigned += pop;
                    }
                }
            }
        }
        let residents: i32 = zones.iter().map(|z| z.2).sum();
        let crime = i32::from(self.crime_average).max(0);
        Report {
            residents,
            placed,
            prison_demand: residents * crime / PRISON_DEMAND_DIV,
        }
    }
}

/// The index of the building of `genre` nearest to tile `(x, y)` within its radius (the oldest
/// on a tie).
fn nearest(placed: &[Placed], genre: u8, x: i32, y: i32) -> Option<usize> {
    let mut best: Option<(i32, usize)> = None;
    for (i, p) in placed.iter().enumerate() {
        if p.service.genre != genre {
            continue;
        }
        let d = p.structure.distance(x, y);
        if d <= p.structure.kind().radius && best.is_none_or(|(bd, _)| d < bd) {
            best = Some((d, i));
        }
    }
    best.map(|(_, i)| i)
}
