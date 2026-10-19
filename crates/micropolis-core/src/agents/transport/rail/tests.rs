//! Caps and the inside of the rail on small hand-built towns, driven without the fleet.

use super::*;
use crate::agents::graph::RoadGraph;
use crate::agents::path::PathFinder;
use crate::agents::transport::{Transport, MAX_WAITING_PER_STOP};
use crate::tile::{COMBASE, HRAIL, LASTRAIL, RAILBASE, ROADBASE, RZB, ZONEBIT};
use crate::tool::ToolResult;

pub(super) const RAIL_Y: i32 = 15;
pub(super) const ROAD_Y: i32 = 19;
pub(super) const GARE_A: (i32, i32) = (10, 14);
pub(super) const GARE_B: (i32, i32) = (53, 14);
/// Ids of the riders put by hand, apart from those the demand creates.
pub(super) const CROWD_ID: u32 = 1 << 20;

pub(super) fn crowd_left(rig: &Rig) -> usize {
    rig.t.rail.riders().filter(|r| r.id >= CROWD_ID).count()
}

/// A 70 x 24 map: a road along `ROAD_Y`, a home zone at x = 9 and a job zone at x = 55 north
/// of it, a rail along `RAIL_Y` for `x` in `rails`; both rules on.
pub(super) fn town(rails: std::ops::Range<i32>) -> Simulation {
    let mut s = Simulation::new(70, 24);
    for x in 2..68 {
        s.set_tile(x, ROAD_Y, ROADBASE);
    }
    for x in rails {
        s.set_tile(x, RAIL_Y, HRAIL);
    }
    s.set_tile(9, ROAD_Y - 2, (RZB + 27) | ZONEBIT);
    s.set_tile(55, ROAD_Y - 2, COMBASE | ZONEBIT);
    s.total_funds = 5_000_000;
    s.set_structure_rules(true);
    s.set_agent_rules(true);
    s
}

pub(super) fn put_gare(s: &mut Simulation, (x, y): (i32, i32)) {
    assert_eq!(s.place_structure(GENRE_STATION, x, y), ToolResult::Ok);
}

/// The town with two gares joined by rails.
pub(super) fn two_gares() -> Simulation {
    let mut s = town(12..53);
    put_gare(&mut s, GARE_A);
    put_gare(&mut s, GARE_B);
    s
}

pub(super) struct Rig {
    pub(super) g: RoadGraph,
    finder: PathFinder,
    load: Vec<u8>,
    pub(super) t: Transport,
    now: u64,
}

impl Rig {
    pub(super) fn new(sim: &Simulation) -> Rig {
        let g = RoadGraph::scan(sim);
        let mut rig = Rig {
            load: vec![0; g.class_len()],
            g,
            finder: PathFinder::default(),
            t: Transport::new(1, 0),
            now: 0,
        };
        rig.refresh(sim);
        rig
    }

    pub(super) fn refresh(&mut self, sim: &Simulation) {
        self.t
            .refresh(sim, &self.g, &mut self.finder, &self.load, self.now);
    }

    pub(super) fn step(&mut self, n: usize) {
        for _ in 0..n {
            self.now += 1;
            self.t.step(&self.g, &mut self.finder, &self.load, self.now);
            let a = self.t.audit();
            assert!(a.balanced(), "tick {}: {a:?}", self.now);
        }
    }

    /// `n` riders waiting at stop `from` of line 0, bound for stop `to`.
    pub(super) fn crowd(&mut self, n: usize, from: usize, to: usize) {
        let (home, job) = (self.g.zones[0].tile, self.g.zones[1].tile);
        let site = self.t.rail.lines[0].stops[to].site;
        for _ in 0..n {
            self.t.counters.created += 1;
            let id = CROWD_ID + self.t.counters.created as u32;
            let r = Rider {
                id,
                home,
                job,
                stop: site,
                born: self.now,
                failed: 0,
            };
            self.t.rail.queues[0][from].push(r);
        }
    }
}

pub(super) fn open_grid(w: i32, h: i32) -> Grid {
    Grid::new(w, h, vec![true; (w * h) as usize])
}

#[test]
fn the_classic_rail_tiles_are_accepted_and_nothing_else() {
    assert!(is_rail(RAILBASE) && is_rail(HRAIL) && is_rail(LASTRAIL));
    assert!(is_rail(crate::tile::RAILHPOWERV) && is_rail(crate::tile::RAILVPOWERH));
    assert!(
        is_rail(HRAIL | crate::tile::PWRBIT),
        "status bits are ignored"
    );
    assert!(!is_rail(ROADBASE) && !is_rail(0) && !is_rail(LASTRAIL + 1) && !is_rail(RAILBASE - 1));
}

#[test]
fn the_search_finds_the_shortest_path_and_none_when_walled_off() {
    let mut f = GridFinder::default();
    let g = open_grid(10, 10);
    let p = f.find(&g, 0, 9 * 10 + 9).expect("a path");
    assert_eq!((p.len(), p[0], *p.last().unwrap()), (19, 0, 99));
    assert!(p.windows(2).all(|w| g.distance(w[0], w[1]) == 1));
    // a closed tile is no end; a wall cuts the way
    let mut open = vec![true; 100];
    open[5 * 10..6 * 10].fill(false);
    let wall = Grid::new(10, 10, open);
    assert_eq!(f.find(&wall, 0, 99), None);
    assert_eq!(f.find(&wall, 0, 50), None);
}

#[test]
fn a_search_pops_at_most_max_rail_expansions_nodes() {
    // the goal is open but cut off: the search floods the 10 000 tiles it can reach
    let mut open = vec![true; 100 * 100];
    for (x, y) in [(98, 99), (99, 98)] {
        open[x * 100 + y] = false;
    }
    let g = Grid::new(100, 100, open);
    let mut f = GridFinder::default();
    assert_eq!(f.find(&g, 0, 99 * 100 + 99), None);
    assert_eq!(f.last_expansions, MAX_RAIL_EXPANSIONS + 1);
}

#[test]
fn a_path_never_has_more_than_max_rail_path_len_tiles() {
    let n = MAX_RAIL_PATH_LEN as i32;
    let mut f = GridFinder::default();
    let ok = Grid::new(n, 1, vec![true; n as usize]);
    assert_eq!(
        f.find(&ok, 0, n as u32 - 1).map(|p| p.len()),
        Some(MAX_RAIL_PATH_LEN)
    );
    let long = Grid::new(n + 1, 1, vec![true; n as usize + 1]);
    assert_eq!(f.find(&long, 0, n as u32), None);
}

#[test]
fn two_gares_joined_by_rails_make_one_line_of_two_stops() {
    let sim = two_gares();
    let rig = Rig::new(&sim);
    let lines = &rig.t.rail.lines;
    assert_eq!(lines.len(), 1);
    assert_eq!((lines[0].kind, lines[0].stops.len()), (LineKind::Train, 2));
    assert_eq!(lines[0].path.len(), 41, "the rail from x = 12 to x = 52");
    assert_eq!(rig.t.rail.line_count(LineKind::Train), 1);
}

#[test]
fn no_line_without_two_connected_gares() {
    // one gare
    let mut s = town(12..53);
    put_gare(&mut s, GARE_A);
    assert!(Rig::new(&s).t.rail.lines.is_empty());
    // two gares, the rail cut between them
    let mut s = two_gares();
    s.set_tile(30, RAIL_Y, 0);
    assert!(Rig::new(&s).t.rail.lines.is_empty());
    // with the rules of the structures off there are no gares at all
    let mut s = two_gares();
    s.set_structure_rules(false);
    assert!(Rig::new(&s).t.rail.lines.is_empty());
}

#[test]
fn the_lines_are_rebuilt_only_when_the_rails_or_gares_changed() {
    let mut sim = two_gares();
    let mut rig = Rig::new(&sim);
    let rebuilds = rig.t.counters.rebuilds;
    assert!(rebuilds >= 1);
    rig.refresh(&sim);
    rig.refresh(&sim);
    assert_eq!(rig.t.counters.rebuilds, rebuilds, "nothing changed");
    sim.set_tile(30, RAIL_Y, 0);
    rig.refresh(&sim);
    assert_eq!(rig.t.counters.rebuilds, rebuilds + 1);
    assert!(rig.t.rail.lines.is_empty());
    sim.set_tile(30, RAIL_Y, HRAIL);
    rig.refresh(&sim);
    assert_eq!(rig.t.rail.lines.len(), 1);
}

#[test]
fn a_cut_rail_withdraws_the_trains_and_counts_their_riders_abandoned() {
    let mut sim = two_gares();
    let mut rig = Rig::new(&sim);
    rig.step(1);
    rig.crowd(10, 0, 1);
    rig.step(40);
    assert!(rig.t.rail.on_board() > 0 || rig.t.rail.waiting() > 0);
    let before = rig.t.counters.abandoned;
    let inside = rig.t.rail.waiting() + rig.t.rail.on_board();
    sim.set_tile(30, RAIL_Y, 0);
    rig.refresh(&sim);
    assert!(rig.t.rail.shuttles.is_empty() && rig.t.rail.waiting() == 0);
    assert_eq!(rig.t.counters.abandoned, before + inside as u64);
    assert!(rig.t.audit().balanced());
}

#[test]
fn an_unchanged_line_keeps_its_trains_and_riders_when_another_line_changes() {
    let mut sim = two_gares();
    let mut rig = Rig::new(&sim);
    rig.step(30);
    let shuttles = rig.t.rail.shuttles.len();
    assert!(shuttles > 0);
    // a rail elsewhere changes the grid, not the line
    sim.set_tile(30, RAIL_Y + 3, HRAIL);
    rig.refresh(&sim);
    assert_eq!(rig.t.rail.shuttles.len(), shuttles);
}

#[test]
fn at_most_max_gares_count_and_at_most_max_train_lines_exist() {
    let mut s = Simulation::new(70, 24);
    s.total_funds = 5_000_000;
    s.set_structure_rules(true);
    s.set_agent_rules(true);
    for x in 1..69 {
        s.set_tile(x, RAIL_Y, HRAIL);
    }
    for i in 0..(MAX_GARES as i32 + 2) {
        put_gare(&mut s, (2 * i + 1, RAIL_Y - 2));
    }
    let rig = Rig::new(&s);
    assert_eq!(rig.t.rail.gares.len(), MAX_GARES);
    assert_eq!(
        rig.t.rail.lines.len(),
        MAX_TRAIN_LINES,
        "120 pairs, 8 lines"
    );
}

#[test]
fn trains_per_line_and_riders_per_train_are_capped_and_they_do_fill_up() {
    let sim = two_gares();
    let mut rig = Rig::new(&sim);
    rig.step(1);
    let (mut most_trains, mut fullest) = (0, 0);
    for _ in 0..60 {
        rig.crowd(20, 0, 1);
        rig.step(10);
        most_trains = most_trains.max(rig.t.rail.count(LineKind::Train));
        fullest = fullest.max(
            rig.t
                .rail
                .shuttles
                .iter()
                .map(|s| s.riders.len())
                .max()
                .unwrap_or(0),
        );
        for s in &rig.t.rail.shuttles {
            assert!(s.riders.len() <= TRAIN_CAPACITY);
        }
        assert!(rig.t.rail.count(LineKind::Train) <= MAX_TRAINS_PER_LINE);
    }
    assert_eq!(
        (most_trains, fullest),
        (MAX_TRAINS_PER_LINE, TRAIN_CAPACITY)
    );
    assert_eq!(rig.t.counters.train_trips, rig.t.counters.arrived);
    assert_eq!(
        i64::from(rig.t.counters.month_rail_income),
        rig.t.counters.train_trips as i64 * i64::from(TRAIN_FARE)
    );
}

#[test]
fn trains_leave_one_by_one_and_drive_at_train_speed_along_the_rails() {
    let sim = two_gares();
    let mut rig = Rig::new(&sim);
    rig.step(1);
    assert_eq!(rig.t.rail.shuttles.len(), 1);
    rig.step(TRAIN_SPAWN_INTERVAL as usize - 2);
    assert_eq!(rig.t.rail.shuttles.len(), 1);
    rig.step(2);
    assert_eq!(rig.t.rail.shuttles.len(), 2);
    let l = &rig.t.rail.lines[0];
    let s = &mut rig.t.rail.shuttles[0].clone();
    let (from, mut tiles) = (s.at, 0);
    s.dwell = 0;
    s.progress = 0;
    for _ in 0..16 {
        tiles += usize::from(s.advance(l, TRAIN_SPEED));
    }
    assert_eq!(
        tiles as u32,
        16 * TRAIN_SPEED / 16,
        "TRAIN_SPEED sixteenths per tick"
    );
    assert!(s.at > from || !s.forward);
    // the vehicle records say kind 3
    let kinds: Vec<i32> = rig.t.rail.vehicles(&rig.g).iter().map(|v| v[1]).collect();
    assert_eq!(kinds, [3, 3]);
}

#[test]
fn a_train_turns_at_both_ends_and_every_rider_gets_off_at_his_gare() {
    let sim = two_gares();
    let mut rig = Rig::new(&sim);
    rig.step(1);
    rig.crowd(5, 0, 1);
    rig.crowd(5, 1, 0);
    rig.step(900);
    assert!(rig.t.counters.train_trips >= 10);
    assert_eq!(crowd_left(&rig), 0, "they all got off at their gare");
    let ends: Vec<_> = rig.t.rail.shuttles.iter().map(|s| s.at).collect();
    assert!(ends.iter().all(|&a| a < rig.t.rail.lines[0].path.len()));
}

#[test]
fn riders_who_wait_too_long_at_a_gare_give_up() {
    let sim = two_gares();
    let mut rig = Rig::new(&sim);
    rig.t.rail.next_spawn[0] = u64::MAX;
    rig.crowd(MAX_WAITING_PER_STOP, 0, 1);
    rig.step(crate::agents::transport::MAX_WAIT_TICKS as usize);
    assert_eq!(crowd_left(&rig), MAX_WAITING_PER_STOP, "they still wait");
    rig.step(2);
    assert_eq!(crowd_left(&rig), 0);
    assert_eq!(rig.t.counters.abandoned, MAX_WAITING_PER_STOP as u64);
}

#[test]
fn a_riders_stop_is_the_site_of_his_exit_and_conservation_holds_while_lines_change() {
    let mut sim = two_gares();
    let mut rig = Rig::new(&sim);
    for round in 0..6 {
        rig.step(1);
        if !rig.t.rail.lines.is_empty() {
            rig.crowd(8, round % 2, 1 - round % 2);
        }
        rig.step(60);
        if round == 3 {
            sim.set_tile(30, RAIL_Y, 0);
            rig.refresh(&sim);
        }
        if round == 4 {
            sim.set_tile(30, RAIL_Y, HRAIL);
            rig.refresh(&sim);
        }
    }
    let a = rig.t.audit();
    assert!(a.balanced(), "{a:?}");
}

#[test]
fn at_most_max_train_searches_are_made_to_build_the_lines() {
    // 16 sites, each on its own rail tile with no rail around: 120 pairs, no line, 64 searches
    let mut open = vec![false; 70 * 24];
    let sites: Vec<_> = (0..MAX_GARES as u32)
        .map(|i| {
            let tile = (2 * i + 1) * 24 + 5;
            open[tile as usize] = true;
            Site {
                id: tile,
                access: tile,
            }
        })
        .collect();
    let g = Grid::new(70, 24, open);
    let mut finder = GridFinder::default();
    assert!(lines::train_lines(&g, &sites, &mut finder).is_empty());
    assert_eq!(finder.searches, MAX_TRAIN_SEARCHES as u64);
}
