//! The rules of the services on a [`Simulation`]: the switch, the monthly pass, the statistics
//! and the coverage layers the adapter reads. See the module documentation of
//! [`crate::services`].

use super::report::Report;
use super::{
    step_toward, Class, ServiceCache, ServiceState, EQ_MAX, EQ_STEP, GENRE_CLINIC, GENRE_COLLEGE,
    GENRE_HOSPITAL, GENRE_SCHOOL, LIFE_BASE, LIFE_MAX, LIFE_MIN, LIFE_STEP,
};
use crate::simulation::Simulation;

/// Numbers of [`Simulation::service_stats`].
pub const STATS_SIZE: usize = 10;

/// Layer kind: education coverage.
pub const LAYER_EDUCATION: i32 = 0;
/// Layer kind: health coverage.
pub const LAYER_HEALTH: i32 = 1;
/// Layer kind: security coverage (the prisons).
pub const LAYER_SECURITY: i32 = 2;

impl Simulation {
    /// Whether the services are on (off by default: the engine is the original).
    pub fn service_rules(&self) -> bool {
        self.extensions().services
    }

    /// Whether the services act: the rule is on and so are the extended buildings.
    pub fn services_active(&self) -> bool {
        self.extensions().services && self.structure_rules()
    }

    /// Turns the services on or off. Off removes every service building (without refund) and
    /// forgets the EQ and the life expectancy.
    pub fn set_service_rules(&mut self, on: bool) {
        let ext = self.extensions_mut();
        ext.services = on;
        ext.service_state = ServiceState::default();
        ext.service_cache = ServiceCache::default();
        if !on {
            self.repair_structures();
        }
    }

    /// The education quotient, 0..=[`EQ_MAX`].
    pub fn education_quotient(&self) -> i32 {
        self.extensions().service_state.eq
    }

    /// The life expectancy in years, [`LIFE_MIN`]..=[`LIFE_MAX`].
    pub fn life_expectancy(&self) -> i32 {
        self.extensions().service_state.life
    }

    /// The EQ and the life expectancy the city is moving toward.
    pub fn service_targets(&self) -> (i32, i32) {
        targets(&self.service_report())
    }

    /// `[eq, life expectancy, students, school places, patients, care places, detainees,
    /// prison places, education coverage %, health coverage %]`. Students and school places are
    /// those of schools and colleges, patients and care places those of clinics and hospitals;
    /// the coverage percentages are the targets as a share of their range. All 0 while the
    /// services do not act.
    pub fn service_stats(&self) -> [i32; STATS_SIZE] {
        if !self.services_active() {
            return [0; STATS_SIZE];
        }
        let r = self.service_report();
        let (eq_target, life_target) = targets(&r);
        let both = |a: u8, b: u8, f: fn(&Report, u8) -> i32| f(&r, a) + f(&r, b);
        [
            self.education_quotient(),
            self.life_expectancy(),
            both(GENRE_SCHOOL, GENRE_COLLEGE, Report::served),
            both(GENRE_SCHOOL, GENRE_COLLEGE, Report::places),
            both(GENRE_CLINIC, GENRE_HOSPITAL, Report::served),
            both(GENRE_CLINIC, GENRE_HOSPITAL, Report::places),
            r.detainees(),
            r.places(super::GENRE_PRISON),
            eq_target * 100 / EQ_MAX,
            (life_target - LIFE_BASE) * 100 / (LIFE_MAX - LIFE_BASE),
        ]
    }

    /// One byte per tile (`x * height + y`): the coverage 0..=255 of `kind` ([`LAYER_EDUCATION`],
    /// [`LAYER_HEALTH`], [`LAYER_SECURITY`]). A working building gives 255 at its footprint,
    /// falling off linearly to 0 past its radius, scaled by the share of its residents it can
    /// serve (for a prison, the share of the demand); the highest building counts. All 0 for
    /// another kind or while the services do not act.
    pub fn coverage_layer(&self, kind: i32) -> Vec<u8> {
        let (w, h) = self.world_size();
        let mut layer = vec![0u8; (w as usize) * (h as usize)];
        let class = match kind {
            LAYER_EDUCATION => Class::Education,
            LAYER_HEALTH => Class::Health,
            LAYER_SECURITY => Class::Justice,
            _ => return layer,
        };
        if !self.services_active() {
            return layer;
        }
        let report = self.service_report();
        let prison_pct = report.prison_pct();
        for p in report.placed.iter().filter(|p| p.service.class == class) {
            let fill = if class == Class::Justice {
                prison_pct
            } else {
                p.fill_pct()
            };
            let s = p.structure;
            let radius = s.kind().radius;
            for x in (s.x - radius).max(0)..(s.x + s.kind().width + radius).min(w) {
                for y in (s.y - radius).max(0)..(s.y + s.kind().height + radius).min(h) {
                    let d = s.distance(x, y);
                    if d > radius {
                        continue;
                    }
                    let v = (255 * (radius + 1 - d) / (radius + 1) * fill / 100) as u8;
                    let cell = &mut layer[(x * h + y) as usize];
                    *cell = (*cell).max(v);
                }
            }
        }
        layer
    }

    /// The monthly pass, called from the valves hook: the first call after a load or a switch
    /// only measures; each new month moves the EQ and the life expectancy a bounded step toward
    /// their targets. Returns nothing; the cache holds the prison demand.
    pub(crate) fn service_month_pass(&mut self) {
        let month = self.city_time >> 2;
        let first = self.extensions().service_cache.month.is_none();
        if self.extensions().service_cache.month == Some(month) {
            return;
        }
        let report = self.service_report();
        let (eq_target, life_target) = targets(&report);
        let ext = self.extensions_mut();
        if !first {
            let s = &mut ext.service_state;
            s.eq = step_toward(s.eq, eq_target, EQ_STEP).clamp(0, EQ_MAX);
            s.life = step_toward(s.life, life_target, LIFE_STEP).clamp(LIFE_MIN, LIFE_MAX);
        }
        ext.service_cache = ServiceCache {
            month: Some(month),
            prison_demand: report.prison_demand,
        };
    }
}

/// `(eq target, life expectancy target)` of a measure.
fn targets(r: &Report) -> (i32, i32) {
    (
        r.score(Class::Education).min(EQ_MAX),
        (LIFE_BASE + r.score(Class::Health)).clamp(LIFE_MIN, LIFE_MAX),
    )
}
