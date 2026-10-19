//! The lines: a train line joins two gares whose rail tiles are connected; a metro line is a
//! working line of the transit network, toured station by station. A line is a path of tiles
//! that its vehicles shuttle along (forth and back) and the stops on it. Built only when the
//! inputs change, by bounded searches.

use super::grid::{Grid, GridFinder};
use super::{MAX_GARES, MAX_LINE_PATH_LEN, MAX_LINE_SEARCHES, MAX_LINE_STOPS, MAX_METRO_LINES};
use super::{MAX_TRAIN_LINES, MAX_TRAIN_SEARCHES};
use crate::agents::graph::STEPS;
use crate::agents::transport::net::Site;
use crate::structures::StructureView;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Train,
    Metro,
}

/// A stop of a line: who it is (the gare, the station tile) and the tile of the path it is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineStop {
    pub site: u32,
    pub tile: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub kind: LineKind,
    pub path: Vec<u32>,
    pub stops: Vec<LineStop>,
}

/// The first open tile touching the footprint of `v` (footprint tiles in order, then north,
/// east, south, west of each).
fn access_of(g: &Grid, v: &StructureView) -> Option<u32> {
    let inside = |x: i32, y: i32| (v.x..v.x + v.width).contains(&x) && (v.y..v.y + v.height).contains(&y);
    (0..v.height)
        .flat_map(|dy| (0..v.width).map(move |dx| (v.x + dx, v.y + dy)))
        .flat_map(|(x, y)| STEPS.map(|(sx, sy)| (x + sx, y + sy)))
        .filter(|&(x, y)| !inside(x, y))
        .filter_map(|(x, y)| g.index(x, y))
        .find(|&i| g.is_open(i))
}

/// The gares (at most [`MAX_GARES`], in list order) that have a rail next to them.
pub fn gare_sites(g: &Grid, gares: &[StructureView]) -> Vec<Site> {
    let sites = gares.iter().filter_map(|v| {
        let id = g.index(v.x, v.y)?;
        Some(Site {
            id,
            access: access_of(g, v)?,
        })
    });
    sites.take(MAX_GARES).collect()
}

/// One line per pair of gares that the rails connect: at most [`MAX_TRAIN_LINES`] lines and
/// [`MAX_TRAIN_SEARCHES`] searches.
pub fn train_lines(g: &Grid, gares: &[Site], finder: &mut GridFinder) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut searches = 0;
    for (i, a) in gares.iter().enumerate() {
        for b in &gares[i + 1..] {
            if lines.len() >= MAX_TRAIN_LINES || searches >= MAX_TRAIN_SEARCHES {
                return lines;
            }
            searches += 1;
            let Some(path) = finder.find(g, a.access, b.access).filter(|p| p.len() >= 2) else {
                continue;
            };
            let stops = vec![
                LineStop { site: a.id, tile: a.access },
                LineStop { site: b.id, tile: b.access },
            ];
            lines.push(Line { kind: LineKind::Train, path, stops });
        }
    }
    lines
}

/// The remaining station nearest to `from` (the first on a tie), as a position in `left`.
fn nearest(g: &Grid, left: &[u32], from: u32) -> usize {
    (0..left.len())
        .min_by_key(|&p| (g.distance(from, left[p]), p))
        .unwrap_or(0)
}

/// The metro lines: from the first station left, a tour through the nearest reachable stations
/// (at most [`MAX_LINE_STOPS`] stops, [`MAX_LINE_SEARCHES`] searches, a path of at most
/// [`MAX_LINE_PATH_LEN`] tiles); the stations the tour did not reach start the next line, up to
/// [`MAX_METRO_LINES`]. A line with a single stop is dropped.
pub fn metro_lines(g: &Grid, stations: &[u32], finder: &mut GridFinder) -> Vec<Line> {
    let mut left = stations.to_vec();
    let mut lines = Vec::new();
    for _ in 0..MAX_METRO_LINES {
        if left.is_empty() {
            break;
        }
        let first = left.remove(0);
        let mut line = Line {
            kind: LineKind::Metro,
            path: vec![first],
            stops: vec![LineStop { site: first, tile: first }],
        };
        let (mut here, mut skipped) = (first, Vec::new());
        for _ in 0..MAX_LINE_SEARCHES {
            if line.stops.len() >= MAX_LINE_STOPS || left.is_empty() {
                break;
            }
            let next = left.remove(nearest(g, &left, here));
            match finder.find(g, here, next) {
                Some(leg) if line.path.len() + leg.len() - 1 <= MAX_LINE_PATH_LEN => {
                    line.path.extend_from_slice(&leg[1..]);
                    line.stops.push(LineStop { site: next, tile: next });
                    here = next;
                }
                _ => skipped.push(next),
            }
        }
        left.extend(skipped);
        if line.stops.len() >= 2 {
            lines.push(line);
        }
    }
    lines
}
