//! The energy rules on a [`Simulation`]: the switch, the power the plants and the purchases add
//! to the grid, the statistics and the consistency of the saved ages. See the module
//! documentation of [`crate::energy`].

use super::{is_plant_genre, spec_of, EnergyState, Plant};
use crate::deals::RESOURCE_POWER_BUY;
use crate::position::Position;
use crate::simulation::Simulation;
use crate::waste::GENRE_WASTE_TO_ENERGY;

/// Numbers of [`Simulation::energy_stats`].
pub const STATS_SIZE: usize = 6;

fn clamp32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// What the plants add to the power of the classic ones: the power of the catalog plants less
/// what the worn classic plants lost.
fn power_delta(plants: &[Plant]) -> i64 {
    plants
        .iter()
        .map(|p| {
            if is_plant_genre(p.genre) {
                p.power
            } else {
                p.power - p.base
            }
        })
        .sum()
}

impl Simulation {
    /// Whether the energy rules are on (off by default: the engine is the original). They act
    /// only while the extended buildings are on too ([`energy_active`](Self::energy_active)).
    pub fn energy_rules(&self) -> bool {
        self.extensions().energy
    }

    /// Whether the energy rules act: on, and the extended buildings on.
    pub fn energy_active(&self) -> bool {
        self.extensions().energy && self.structure_rules()
    }

    /// Turns the energy rules on or off. Off pulls down the plants of the catalog (no refund)
    /// and forgets the ages and the electricity deals.
    pub fn set_energy_rules(&mut self, on: bool) {
        let ext = self.extensions_mut();
        ext.energy = on;
        if !on {
            ext.energy_state = EnergyState::default();
            ext.deal_list.remove_resource(RESOURCE_POWER_BUY);
            self.repair_structures();
        }
    }

    /// Power tiles bought from the neighbours (0 while the rules do not act).
    pub fn energy_bought(&self) -> i64 {
        if !self.energy_active() {
            return 0;
        }
        self.extensions()
            .deal_list
            .as_slice()
            .iter()
            .filter(|d| d.resource == RESOURCE_POWER_BUY)
            .map(|d| i64::from(d.amount))
            .sum()
    }

    /// Power tiles the catalog plants add to the classic capacity, less what the worn classic
    /// plants lost (negative when the loss is the bigger). 0 while the rules do not act.
    pub(crate) fn energy_power_delta(&self) -> i64 {
        power_delta(&self.energy_plants())
    }

    /// `[production, consumption, bought, plants, plants_worn, air_pollution]` (tiles, tiles,
    /// tiles, count, count, intensity): the power of the whole grid, the tiles it asks for, the
    /// part bought, every plant, those past the start of their wear and the pollution of the
    /// running ones. All 0 while the rules do not act.
    pub fn energy_stats(&self) -> [i32; STATS_SIZE] {
        if !self.energy_active() {
            return [0; STATS_SIZE];
        }
        let plants = self.energy_plants();
        let bought = self.energy_bought();
        let mut seeds: Vec<(i32, i32)> = plants.iter().map(|p| (p.x, p.y)).collect();
        seeds.extend(
            self.waste_sites(GENRE_WASTE_TO_ENERGY)
                .iter()
                .map(|s| (s.x, s.y)),
        );
        let worn = plants
            .iter()
            .filter(|p| spec_of(p.genre).is_some_and(|s| super::curve::is_worn(s, p.age)))
            .count();
        [
            clamp32(self.power_capacity() + bought),
            clamp32(self.grid_demand(&seeds)),
            clamp32(bought),
            clamp32(plants.len() as i64),
            clamp32(worn as i64),
            clamp32(self.energy_pollution_made()),
        ]
    }

    /// Puts the running catalog plants on the power stack (their top-left tile is conductive)
    /// and returns what the energy rules add to the capacity: their power, less the loss of the
    /// worn classic plants, plus the electricity bought. For `do_power_scan`, which keeps the
    /// total from going under 0.
    pub(crate) fn energy_power_sources(&mut self) -> i64 {
        if !self.energy_active() {
            return 0;
        }
        let plants = self.energy_plants();
        for p in plants
            .iter()
            .filter(|p| is_plant_genre(p.genre) && p.power > 0)
        {
            self.push_power_stack(Position::new(p.x, p.y));
        }
        power_delta(&plants) + self.energy_bought()
    }

    /// Forgets the ages of plants that are gone (pulled down, burnt, replaced). With the rules
    /// off everything is forgotten. Bounded by the map size.
    pub(crate) fn repair_energy(&mut self) {
        if !self.energy_rules() {
            self.extensions_mut().energy_state = EnergyState::default();
            return;
        }
        let anchors: Vec<(i32, i32)> = self.energy_plants().iter().map(|p| (p.x, p.y)).collect();
        self.extensions_mut()
            .energy_state
            .retain(|a| anchors.binary_search(&(a.x, a.y)).is_ok());
    }
}
