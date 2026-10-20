//! Extended rules (docs/game-design-v02.md, phase A): the platform the v0.2 workstreams plug
//! into. Every extended rule is off by default; off, the engine is identical to the original
//! (the `compare-*.sh` scripts prove it).
//!
//! * [`Extensions`] holds the switches: the ordinances (a bitmask), `water_rules`,
//!   `transit_rules`. [`Simulation::extensions_active`] is true when any is on.
//! * The **hooks** are methods of [`Simulation`], each called from exactly one place of the
//!   engine (listed on each hook). While [`extensions_active`](Simulation::extensions_active)
//!   is false a hook returns its input unchanged, answers `true`, or does nothing; it never
//!   draws a random number and never allocates. Active, it delegates to the three feature
//!   modules [`ordinances`], [`water`] and [`transit`], which the workstreams fill in.
//! * The **file block** of an `MCTY` version-3 file (see `fileio`): a `u32` big-endian byte
//!   count, then tagged chunks `tag: u8, length: u32 big-endian, bytes`, in strictly increasing
//!   tag order, at most one per tag. [`encode_block`] writes it and [`decode_chunks`] checks it
//!   completely before anything is applied, so a bad block never touches the engine.

use crate::agents::{self, Fleet};
use crate::deals::DealList;
use crate::densities::{DensityList, Farms};
use crate::position::Position;
use crate::services::{ServiceCache, ServiceState};
use crate::simulation::Simulation;
use crate::structures::StructureList;
use crate::traffic::ZoneType;
use crate::transit::TransitNetwork;
use crate::water::WaterNetwork;
use crate::{deals, densities, ordinances, services, structures, transit, water};

/// Chunk tag: the water and transit rule switches (one flags byte).
pub const CHUNK_RULES: u8 = 1;
/// Chunk tag: the active ordinances ([`ordinances::encode`]).
pub const CHUNK_ORDINANCES: u8 = 2;
/// Chunk tag: the water network ([`WaterNetwork::encode`]).
pub const CHUNK_WATER: u8 = 3;
/// Chunk tag: the transit network ([`TransitNetwork::encode`]).
pub const CHUNK_TRANSIT: u8 = 4;
/// Chunk tag: the signed deals with the neighbours ([`DealList::encode`]).
pub const CHUNK_DEALS: u8 = 5;
/// Chunk tag: the placed extended buildings ([`StructureList::encode`]).
pub const CHUNK_STRUCTURES: u8 = 6;
/// Chunk tag: the light and medium zones ([`DensityList::encode`]).
pub const CHUNK_DENSITIES: u8 = 7;
/// Chunk tag: the EQ and the life expectancy ([`ServiceState::encode`]). Tag 8 belongs to another
/// milestone and is unknown here.
pub const CHUNK_SERVICES: u8 = 9;
/// Largest tag this reader knows; any bigger tag is refused.
pub const CHUNK_MAX_TAG: u8 = CHUNK_SERVICES;
/// Bytes of a chunk header: tag (1), length (4).
pub const CHUNK_HEADER_SIZE: usize = 5;
/// Bytes of the length that opens the block.
pub const BLOCK_LENGTH_SIZE: usize = 4;

const RULES_WATER: u8 = 0b01;
const RULES_TRANSIT: u8 = 0b10;
const RULES_DEALS: u8 = 0b100;
/// Bit 3 of the rules chunk: the simulated cars (`Extensions::agents`). The cars themselves
/// are not saved; a loaded city restarts them from the map.
const RULES_AGENTS: u8 = 0b1000;
/// Bit 4 of the rules chunk: the extended buildings (`Extensions::structures`).
const RULES_STRUCTURES: u8 = 0b1_0000;

/// Bit 5 of the rules chunk: the zoning densities (`Extensions::densities`).
const RULES_DENSITIES: u8 = 0b10_0000;

const RULES_KNOWN: u8 =
    RULES_WATER | RULES_TRANSIT | RULES_DEALS | RULES_AGENTS | RULES_STRUCTURES | RULES_DENSITIES;

/// Bit 0 of the optional second byte of the rules chunk: the public services
/// (`Extensions::services`). The byte is written only when one of its bits is set, so a city
/// without those rules keeps the one-byte chunk (or none) it always had.
const RULES2_SERVICES: u8 = 0b01;
const RULES2_KNOWN: u8 = RULES2_SERVICES;

/// The switches of the extended rules. Everything off by default.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Extensions {
    /// Active ordinances: bit `n` is ordinance `n`.
    pub ordinances: u32,
    /// The water network rules.
    pub water_rules: bool,
    /// The metro rules.
    pub transit_rules: bool,
    /// The deals with the neighbouring cities.
    pub deals: bool,
    /// The signed deals (kept only while `deals` is on; see [`deals`]).
    pub deal_list: DealList,
    /// The simulated cars (docs/game-design-v03.md). Only this switch is saved.
    pub agents: bool,
    /// The cars on the road: runtime state, never saved, ignored when comparing.
    pub fleet: Fleet,
    /// The extended buildings (docs/game-design-v04.md).
    pub structures: bool,
    /// The placed buildings (kept only while `structures` is on; see [`structures`]).
    pub structure_list: StructureList,
    /// The zoning densities (docs/game-design-v07.md).
    pub densities: bool,
    /// The light and medium zones; the other zones are dense (see [`densities`]).
    pub density_zones: DensityList,
    /// The farms: derived runtime state, never saved, ignored when comparing.
    pub farms: Farms,
    /// The public services (docs/game-design-v09.md).
    pub services: bool,
    /// The education quotient and the life expectancy (reset while `services` is off).
    pub service_state: ServiceState,
    /// What the last monthly pass measured: runtime state, never saved, ignored when comparing.
    pub service_cache: ServiceCache,
}

impl Extensions {
    /// Whether any extended rule is on.
    pub fn is_active(&self) -> bool {
        self.ordinances != 0
            || self.water_rules
            || self.transit_rules
            || self.deals
            || self.agents
            || self.structures
            || self.densities
            || self.services
    }

    /// The bytes of the rules chunk: none when no rule is on, the flags byte, and the second
    /// byte only when it is not 0.
    fn rules_bytes(&self) -> Vec<u8> {
        let second = if self.services { RULES2_SERVICES } else { 0 };
        match (self.rules_flags(), second) {
            (0, 0) => Vec::new(),
            (flags, 0) => vec![flags],
            (flags, second) => vec![flags, second],
        }
    }

    fn rules_flags(&self) -> u8 {
        let mut flags = 0;
        if self.water_rules {
            flags |= RULES_WATER;
        }
        if self.transit_rules {
            flags |= RULES_TRANSIT;
        }
        if self.deals {
            flags |= RULES_DEALS;
        }
        if self.agents {
            flags |= RULES_AGENTS;
        }
        if self.structures {
            flags |= RULES_STRUCTURES;
        }
        if self.densities {
            flags |= RULES_DENSITIES;
        }
        flags
    }
}

/// What a checked block holds, ready to be applied to an engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LoadedExtensions {
    pub extensions: Extensions,
    pub water: WaterNetwork,
    pub transit: TransitNetwork,
}

/// The block of a file for `sim`: its length, then its chunks (a chunk whose bytes are empty is
/// left out). Only written when [`Simulation::needs_extension_block`].
pub(crate) fn encode_block(sim: &Simulation) -> Vec<u8> {
    let ext = sim.extensions();
    let chunks: [(u8, Vec<u8>); 8] = [
        (CHUNK_RULES, ext.rules_bytes()),
        (CHUNK_ORDINANCES, ordinances::encode(ext)),
        (CHUNK_WATER, sim.water().encode()),
        (CHUNK_TRANSIT, sim.transit().encode()),
        (CHUNK_DEALS, ext.deal_list.encode()),
        (CHUNK_STRUCTURES, ext.structure_list.encode()),
        (CHUNK_DENSITIES, ext.density_zones.encode()),
        (CHUNK_SERVICES, ext.service_state.encode()),
    ];
    let mut body = Vec::new();
    for (tag, bytes) in chunks.iter().filter(|(_, b)| !b.is_empty()) {
        body.push(*tag);
        body.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        body.extend_from_slice(bytes);
    }
    let mut out = Vec::with_capacity(BLOCK_LENGTH_SIZE + body.len());
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(&body);
    out
}

/// Checks and decodes the chunks of a block (the bytes after its length) for a `width` x
/// `height` map. `Err` with the reason on an unknown tag, a tag out of order or repeated, a
/// chunk cut short or one its module refuses. Nothing is applied here.
pub(crate) fn decode_chunks(
    chunks: &[u8],
    width: i32,
    height: i32,
) -> Result<LoadedExtensions, &'static str> {
    let mut loaded = LoadedExtensions {
        extensions: Extensions::default(),
        water: WaterNetwork::new(width, height),
        transit: TransitNetwork::new(width, height),
    };
    let mut at = 0;
    let mut last_tag = 0;
    // Every chunk is at least CHUNK_HEADER_SIZE bytes and tags strictly increase up to
    // CHUNK_MAX_TAG: the loop cannot run more than CHUNK_MAX_TAG times.
    for _ in 0..CHUNK_MAX_TAG {
        if at == chunks.len() {
            return Ok(loaded);
        }
        if chunks.len() - at < CHUNK_HEADER_SIZE {
            return Err("extension chunk header is cut short");
        }
        let tag = chunks[at];
        let len = u32::from_be_bytes([
            chunks[at + 1],
            chunks[at + 2],
            chunks[at + 3],
            chunks[at + 4],
        ]) as usize;
        at += CHUNK_HEADER_SIZE;
        if tag == 0 || tag > CHUNK_MAX_TAG {
            return Err("unknown extension chunk");
        }
        if tag <= last_tag {
            return Err("extension chunks are repeated or out of order");
        }
        last_tag = tag;
        if len > chunks.len() - at {
            return Err("extension chunk is longer than the block");
        }
        let bytes = &chunks[at..at + len];
        at += len;
        match tag {
            CHUNK_RULES => decode_rules(bytes, &mut loaded.extensions)?,
            CHUNK_ORDINANCES => loaded.extensions.ordinances = ordinances::decode(bytes)?,
            CHUNK_WATER => loaded.water = WaterNetwork::decode(bytes, width, height)?,
            CHUNK_DEALS => loaded.extensions.deal_list = DealList::decode(bytes)?,
            CHUNK_STRUCTURES => {
                loaded.extensions.structure_list = StructureList::decode(bytes, width, height)?
            }
            CHUNK_DENSITIES => {
                loaded.extensions.density_zones = DensityList::decode(bytes, width, height)?
            }
            CHUNK_TRANSIT => loaded.transit = TransitNetwork::decode(bytes, width, height)?,
            CHUNK_SERVICES => loaded.extensions.service_state = ServiceState::decode(bytes)?,
            _ => return Err("unknown extension chunk"),
        }
    }
    if at == chunks.len() {
        Ok(loaded)
    } else {
        Err("extension block has data after its last chunk")
    }
}

fn decode_rules(bytes: &[u8], ext: &mut Extensions) -> Result<(), &'static str> {
    match bytes {
        [] => Ok(()),
        [flags] | [flags, _] if flags & !RULES_KNOWN != 0 => Err("unknown rules flag"),
        [_, second] if second & !RULES2_KNOWN != 0 => Err("unknown rules flag"),
        [_, 0] => Err("rules chunk has an empty second byte"),
        [flags] | [flags, _] => {
            ext.water_rules = flags & RULES_WATER != 0;
            ext.transit_rules = flags & RULES_TRANSIT != 0;
            ext.deals = flags & RULES_DEALS != 0;
            ext.agents = flags & RULES_AGENTS != 0;
            ext.structures = flags & RULES_STRUCTURES != 0;
            ext.densities = flags & RULES_DENSITIES != 0;
            ext.services = bytes.get(1).is_some_and(|b| b & RULES2_SERVICES != 0);
            Ok(())
        }
        _ => Err("rules chunk is not 1 or 2 bytes"),
    }
}

impl Simulation {
    /// The switches of the extended rules.
    pub fn extensions(&self) -> &Extensions {
        &self.extensions
    }

    /// Mutable access to the switches. Turning a rule on or off changes the simulation from
    /// the next tick; it is saved with the city.
    pub fn extensions_mut(&mut self) -> &mut Extensions {
        &mut self.extensions
    }

    /// Whether any extended rule is on. When false, every hook below is inert.
    #[inline]
    pub fn extensions_active(&self) -> bool {
        self.extensions.is_active()
    }

    /// The water network (pumps and pipes).
    pub fn water(&self) -> &WaterNetwork {
        &self.water
    }

    pub fn water_mut(&mut self) -> &mut WaterNetwork {
        &mut self.water
    }

    /// The metro network (stations and tunnels).
    pub fn transit(&self) -> &TransitNetwork {
        &self.transit
    }

    pub fn transit_mut(&mut self) -> &mut TransitNetwork {
        &mut self.transit
    }

    /// Whether a saved city needs the extensions block: a rule is on, or a network holds
    /// something. Otherwise the file is exactly the one written before the block existed.
    pub fn needs_extension_block(&self) -> bool {
        self.extensions_active()
            || !self.water.is_empty()
            || !self.transit.is_empty()
            || self.extensions.has_deals()
            || !self.extensions.structure_list.is_empty()
            || !self.extensions.density_zones.is_empty()
            || self.extensions.service_state != ServiceState::default()
    }

    /// Applies a checked block (a loaded file).
    pub(crate) fn apply_extensions(&mut self, loaded: LoadedExtensions) {
        self.extensions = loaded.extensions;
        self.water = loaded.water;
        self.transit = loaded.transit;
        self.repair_structures_fully();
        self.repair_densities();
        self.recompute_farms();
    }

    /// Empties the networks, which belong to the map being replaced. The switches stay.
    pub(crate) fn clear_networks(&mut self) {
        let (w, h) = self.world_size();
        self.water = WaterNetwork::new(w, h);
        self.transit = TransitNetwork::new(w, h);
        self.extensions.deal_list = DealList::default();
        self.extensions.structure_list = StructureList::default();
        self.extensions.density_zones = DensityList::default();
        self.extensions.farms = Farms::default();
        self.extensions.service_state = ServiceState::default();
        self.extensions.service_cache = ServiceCache::default();
    }

    /// Hook: the running costs and revenues of the extended rules, paid once per tax
    /// collection through [`spend`](Simulation::spend) (a negative net is income).
    /// Called by `collect_tax` (`simulate.rs`) right after the budget of a populated city.
    pub fn ext_monthly_balance(&mut self) {
        if !self.extensions_active() {
            return;
        }
        if self.structure_rules() {
            self.repair_structures_fully();
        }
        if self.density_rules() {
            self.repair_densities();
            self.recompute_farms();
        }
        let fares = self.take_transport_income();
        let net = ordinances::monthly_balance(self)
            .saturating_add(water::monthly_balance(self))
            .saturating_add(transit::monthly_balance(self))
            .saturating_add(deals::monthly_balance(self))
            .saturating_add(structures::monthly_balance(self))
            .saturating_sub(fares);
        if net != 0 {
            self.spend(net);
        }
    }

    /// Hook: crime `z` (0..=250) of the block at world tile `(x, y)`. Called by `crime_scan`
    /// (`scan.rs`) once the original value is computed and clamped.
    #[inline]
    pub fn ext_crime(&self, x: i32, y: i32, z: i32) -> i32 {
        if !self.extensions_active() {
            return z;
        }
        services::crime(self, x, y, ordinances::crime(self, x, y, z))
    }

    /// Hook: pollution `p` (0..=255) of the block at world tile `(x, y)`. Called by
    /// `pollution_terrain_land_value_scan` (`scan.rs`) when the smoothed pollution is stored.
    #[inline]
    pub fn ext_pollution(&self, x: i32, y: i32, p: i32) -> i32 {
        if !self.extensions_active() {
            return p;
        }
        services::pollution(
            self,
            x,
            y,
            densities::pollution(self, x, y, ordinances::pollution(self, x, y, p)),
        )
    }

    /// Hook: land value `v` (1..=250) of the block at world tile `(x, y)`. Called by
    /// `pollution_terrain_land_value_scan` (`scan.rs`) once the original value is clamped.
    #[inline]
    pub fn ext_land_value(&self, x: i32, y: i32, v: i32) -> i32 {
        if !self.extensions_active() {
            return v;
        }
        services::land_value(
            self,
            x,
            y,
            structures::land_value(
                self,
                x,
                y,
                transit::land_value(self, x, y, ordinances::land_value(self, x, y, v)),
            ),
        )
    }

    /// Hook: traffic density `t` (0..=255) of the block at world tile `(x, y)`. Called by
    /// `dec_traffic_map` (`simulate.rs`), which decays every block once per cycle, after the
    /// decay.
    #[inline]
    pub fn ext_traffic(&self, x: i32, y: i32, t: i32) -> i32 {
        if !self.extensions_active() {
            return t;
        }
        if self.extensions.agents {
            // measured load replaces the statistical density (the agents rewrite the map too)
            return agents::traffic(self, x, y, t);
        }
        transit::traffic(self, x, y, t)
    }

    /// Hook: one step of the simulated cars. Called at the top of `simulate` (`simulate.rs`),
    /// once per simulated phase. Does nothing unless `Extensions::agents` is on; on, it uses its
    /// own generator (never the simulation's) and writes the measured load into the traffic
    /// density map.
    #[inline]
    pub fn ext_agents_tick(&mut self) {
        if !self.extensions.agents {
            return;
        }
        agents::tick(self);
    }

    /// Hook: adjusts the zoning valves. Called at the end of `set_valves` (`simulate.rs`).
    #[inline]
    pub fn ext_valves(&mut self) {
        if !self.extensions_active() {
            return;
        }
        ordinances::valves(self);
        water::valves(self);
        transit::valves(self);
        if self.structure_rules() {
            self.repair_structures();
        }
        if self.density_rules() {
            self.repair_densities();
        }
        services::valves(self);
    }

    /// Hook: whether a zone of `kind` at `pos` may grow (immigration). Called at the top of
    /// `do_res_in`, `do_com_in` and `do_ind_in` (`zone.rs`), the three entry points of growth.
    #[inline]
    pub fn ext_zone_can_grow(&self, pos: Position, kind: ZoneType) -> bool {
        if !self.extensions_active() {
            return true;
        }
        ordinances::zone_can_grow(self, pos, kind)
            && water::zone_can_grow(self, pos, kind)
            && densities::zone_can_grow(self, pos, kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> Simulation {
        Simulation::new(80, 67)
    }

    #[test]
    fn everything_is_off_by_default() {
        let s = sim();
        assert_eq!(*s.extensions(), Extensions::default());
        assert!(!s.extensions_active());
        assert!(!s.needs_extension_block());
        assert!(s.water().is_empty() && s.transit().is_empty());
    }

    #[test]
    fn each_switch_activates_the_extensions() {
        for i in 0..3 {
            let mut s = sim();
            match i {
                0 => s.extensions_mut().ordinances = 1 << 31,
                1 => s.extensions_mut().water_rules = true,
                _ => s.extensions_mut().transit_rules = true,
            }
            assert!(s.extensions_active(), "switch {i}");
            assert!(s.needs_extension_block(), "switch {i}");
        }
    }

    #[test]
    fn a_network_with_content_needs_the_block_even_with_the_rules_off() {
        let mut s = sim();
        s.water_mut().pipes.set(3, 3, 1);
        assert!(!s.extensions_active());
        assert!(s.needs_extension_block());
    }

    #[test]
    fn hooks_are_inert_when_no_rule_acts() {
        for on in [false, true] {
            let mut s = sim();
            if on {
                // active, but only an ordinance bit beyond the table: no rule acts
                s.extensions_mut().ordinances = 1 << 31;
            }
            let funds = s.total_funds;
            let valves = (s.res_valve, s.com_valve, s.ind_valve);
            assert_eq!(s.ext_crime(5, 6, 77), 77);
            assert_eq!(s.ext_pollution(5, 6, 78), 78);
            assert_eq!(s.ext_land_value(5, 6, 79), 79);
            assert_eq!(s.ext_traffic(5, 6, 80), 80);
            assert!(s.ext_zone_can_grow(Position::new(5, 6), ZoneType::Residential));
            s.ext_valves();
            s.ext_monthly_balance();
            assert_eq!(s.total_funds, funds);
            assert_eq!(valves, (s.res_valve, s.com_valve, s.ind_valve));
        }
    }

    #[test]
    fn hooks_draw_no_random_number() {
        let mut s = sim();
        s.extensions_mut().ordinances = 1;
        s.extensions_mut().water_rules = true;
        s.extensions_mut().transit_rules = true;
        let before = s.rng.clone();
        s.ext_crime(1, 1, 1);
        s.ext_pollution(1, 1, 1);
        s.ext_land_value(1, 1, 1);
        s.ext_traffic(1, 1, 1);
        s.ext_zone_can_grow(Position::new(1, 1), ZoneType::Industrial);
        s.ext_valves();
        s.ext_monthly_balance();
        assert_eq!(s.rng.random16(), before.clone().random16());
    }

    #[test]
    fn the_block_round_trips() {
        let mut s = sim();
        s.extensions_mut().ordinances = 0x8000_0005;
        s.extensions_mut().water_rules = true;
        s.water_mut().pipes.set(2, 3, 7);
        s.transit_mut().underground.set(79, 66, 9);
        let block = encode_block(&s);
        let n = u32::from_be_bytes([block[0], block[1], block[2], block[3]]) as usize;
        assert_eq!(block.len(), BLOCK_LENGTH_SIZE + n);
        let loaded = decode_chunks(&block[BLOCK_LENGTH_SIZE..], 80, 67).unwrap();
        assert_eq!(loaded.extensions, *s.extensions());
        assert_eq!(loaded.water, *s.water());
        assert_eq!(loaded.transit, *s.transit());
        let mut t = sim();
        t.apply_extensions(loaded);
        assert_eq!(encode_block(&t), block);
    }

    #[test]
    fn the_deals_are_chunk_5_and_round_trip() {
        let mut s = sim();
        assert!(!s.needs_extension_block());
        s.set_deals_rules(true);
        assert!(s.extensions_active());
        let rules_only = encode_block(&s);
        assert!(s
            .extensions_mut()
            .deal_list
            .push(crate::deals::offer_for(1, 0, 0).unwrap()));
        let block = encode_block(&s);
        assert!(block.len() > rules_only.len());
        assert_eq!(block[BLOCK_LENGTH_SIZE], CHUNK_RULES);
        let loaded = decode_chunks(&block[BLOCK_LENGTH_SIZE..], 80, 67).unwrap();
        assert!(loaded.extensions.deals);
        assert_eq!(loaded.extensions.deal_list, s.extensions().deal_list);
        // deals saved with the rule off still need the block (and keep their chunk)
        s.extensions_mut().deals = false;
        assert!(s.needs_extension_block());
        let block = encode_block(&s);
        let loaded = decode_chunks(&block[BLOCK_LENGTH_SIZE..], 80, 67).unwrap();
        assert!(!loaded.extensions.deals && loaded.extensions.deal_list.len() == 1);
    }

    #[test]
    fn an_empty_block_decodes_to_the_defaults() {
        let loaded = decode_chunks(&[], 80, 67).unwrap();
        assert_eq!(loaded.extensions, Extensions::default());
        assert!(loaded.water.is_empty() && loaded.transit.is_empty());
    }

    fn chunk(tag: u8, bytes: &[u8]) -> Vec<u8> {
        let mut c = vec![tag];
        c.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        c.extend_from_slice(bytes);
        c
    }

    #[test]
    fn a_bad_block_is_refused_with_a_reason() {
        let cat = |parts: &[Vec<u8>]| parts.concat();
        let refused = [
            chunk(0, &[]),
            chunk(8, &[]),
            cat(&[chunk(2, &[0, 0, 0, 1]), chunk(1, &[1])]),
            cat(&[chunk(1, &[1]), chunk(1, &[1])]),
            chunk(1, &[0b1000_0000]),
            chunk(1, &[0b1000_0000, 1]),
            chunk(1, &[1, 0b10]),
            chunk(1, &[1, 0]),
            chunk(1, &[1, 1, 1]),
            chunk(9, &[1]),
            chunk(9, &[1, 2, 3]),
            chunk(10, &[]),
            chunk(2, &[1, 2, 3]),
            chunk(3, &[1, 2, 3]),
            chunk(4, &[1, 2, 3]),
            chunk(5, &[1, 2, 3]),
            vec![1, 0, 0],
            vec![1, 0, 0, 0, 9, 1],
            cat(&[chunk(1, &[1]), vec![9]]),
        ];
        for (i, bad) in refused.iter().enumerate() {
            assert!(decode_chunks(bad, 80, 67).is_err(), "case {i}");
        }
    }
}
