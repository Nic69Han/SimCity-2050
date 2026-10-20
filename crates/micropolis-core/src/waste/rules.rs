//! The waste rules on a [`Simulation`]: the switch, the working buildings, the statistics and the
//! layer the adapter reads, the power of the waste-to-energy plants and the consistency of the
//! saved fills. See the module documentation of [`crate::waste`].

use super::{
    WasteReport, WasteState, GENRE_LANDFILL, GENRE_WASTE_TO_ENERGY, LANDFILL_CAPACITY,
    WTE_POWER_STRENGTH,
};
use crate::deals::RESOURCE_WASTE;
use crate::simulation::Simulation;
use crate::structures::Structure;

/// Numbers of [`Simulation::waste_stats`].
pub const STATS_SIZE: usize = 7;

fn clamp32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

impl Simulation {
    /// Whether the waste rules are on (off by default: the engine is the original). They act only
    /// while the extended buildings are on too ([`waste_active`](Self::waste_active)).
    pub fn waste_rules(&self) -> bool {
        self.extensions().waste
    }

    /// Whether the waste rules act: on, and the extended buildings on.
    pub fn waste_active(&self) -> bool {
        self.extensions().waste && self.structure_rules()
    }

    /// Turns the waste rules on or off. Off forgets the piles, the landfill fills and the waste
    /// deals, free of charge.
    pub fn set_waste_rules(&mut self, on: bool) {
        let ext = self.extensions_mut();
        ext.waste = on;
        if !on {
            ext.waste_state = WasteState::default();
            ext.waste_report = WasteReport::default();
            ext.deal_list.remove_resource(RESOURCE_WASTE);
        }
    }

    /// The report of the last month (all 0 before the first one, after a load and with the rules
    /// off).
    pub fn waste_report(&self) -> WasteReport {
        self.extensions().waste_report
    }

    /// The intact buildings of `genre` that work, oldest first.
    pub(crate) fn waste_sites(&self, genre: u8) -> Vec<Structure> {
        self.extensions()
            .structure_list
            .as_slice()
            .iter()
            .filter(|s| s.genre == genre && self.structure_works(s))
            .copied()
            .collect()
    }

    /// Units the working landfills can still take.
    pub fn landfill_room(&self) -> i64 {
        self.waste_sites(GENRE_LANDFILL)
            .iter()
            .map(|s| LANDFILL_CAPACITY - self.extensions().waste_state.fill_at(s.x, s.y))
            .sum()
    }

    /// `[produced, treated, recycled, exported]` of the last month, the garbage piled on the map,
    /// the room left in the landfills and the power tiles the waste-to-energy plants supply.
    /// All 0 while the rules do not act.
    pub fn waste_stats(&self) -> [i32; STATS_SIZE] {
        if !self.waste_active() {
            return [0; STATS_SIZE];
        }
        let r = self.waste_report();
        [
            clamp32(r.produced),
            clamp32(r.treated),
            clamp32(r.recycled),
            clamp32(r.exported),
            clamp32(self.extensions().waste_state.pile_total()),
            clamp32(self.landfill_room()),
            clamp32(self.waste_power_capacity()),
        ]
    }

    /// The garbage piled on each tile (`x * height + y`), 0..=255. All 0 while the rules do not
    /// act.
    pub fn waste_layer(&self) -> Vec<u8> {
        let (w, h) = self.world_size();
        let mut out = vec![0u8; (w * h) as usize];
        if self.waste_active() {
            for (index, units) in self.extensions().waste_state.piles() {
                if let Some(cell) = out.get_mut(index as usize) {
                    *cell = units;
                }
            }
        }
        out
    }

    /// Power tiles the working waste-to-energy plants supply (0 while the rules do not act).
    pub(crate) fn waste_power_capacity(&self) -> i64 {
        if !self.waste_active() {
            return 0;
        }
        self.waste_sites(GENRE_WASTE_TO_ENERGY).len() as i64 * WTE_POWER_STRENGTH
    }

    /// Puts the waste-to-energy plants on the power stack (their top-left tile is conductive) and
    /// returns their capacity, for `do_power_scan`.
    pub(crate) fn waste_power_sources(&mut self) -> i64 {
        if !self.waste_active() {
            return 0;
        }
        let plants = self.waste_sites(GENRE_WASTE_TO_ENERGY);
        for p in &plants {
            self.push_power_stack(crate::position::Position::new(p.x, p.y));
        }
        plants.len() as i64 * WTE_POWER_STRENGTH
    }

    /// Forgets the fills of landfills that are gone (bulldozed, burnt, replaced). With the rules
    /// off everything is forgotten. Bounded by [`MAX_FILLS`](super::MAX_FILLS).
    pub(crate) fn repair_waste(&mut self) {
        if !self.waste_rules() {
            self.extensions_mut().waste_state = WasteState::default();
            return;
        }
        let landfills: Vec<(i32, i32)> = self
            .extensions()
            .structure_list
            .as_slice()
            .iter()
            .filter(|s| s.genre == GENRE_LANDFILL)
            .map(|s| (s.x, s.y))
            .collect();
        self.extensions_mut()
            .waste_state
            .retain_fills(|f| landfills.contains(&(f.x, f.y)));
    }
}
