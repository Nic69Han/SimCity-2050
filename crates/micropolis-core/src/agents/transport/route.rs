//! The bus routes: from each depot a closed loop through the stops, built once when the
//! network changes with a bounded nearest-neighbour tour. At most [`MAX_ROUTE_STOPS`] stops are
//! visited, each reached by one bounded A* search; a stop with no road path from the tour so
//! far is skipped.

use super::net::{Net, Site};
use super::{MAX_ROUTE_SEARCHES, MAX_ROUTE_STOPS};
use crate::agents::graph::RoadGraph;
use crate::agents::path::PathFinder;

/// A stop of a route: its index in [`Net::stops`] and where on the loop the bus serves it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RouteStop {
    pub stop: usize,
    /// Index in [`Route::path`] of the road tile of the stop.
    pub at: usize,
}

/// A closed loop of road tiles (the bus goes from the last back to the first) and the stops on
/// it in the order they are met.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    pub path: Vec<u32>,
    pub stops: Vec<RouteStop>,
}

impl Route {
    /// Whether the route serves stop `stop` (an index of [`Net::stops`]).
    pub fn serves(&self, stop: usize) -> bool {
        self.stops.iter().any(|s| s.stop == stop)
    }
}

/// The remaining stop nearest to tile `from` (the first on a tie), as a position in `left`.
fn nearest(g: &RoadGraph, net: &Net, left: &[usize], from: u32) -> Option<usize> {
    let key = |p: usize| g.distance(from, net.stops[left[p]].access);
    (0..left.len()).min_by_key(|&p| (key(p), p))
}

/// The loop of `depot`, or `None` when no stop can be reached or the loop has fewer than two
/// tiles. Searches: at most `MAX_ROUTE_SEARCHES` (stops tried) plus the way home.
pub fn build(
    g: &RoadGraph,
    net: &Net,
    depot: &Site,
    finder: &mut PathFinder,
    load: &[u8],
) -> Option<Route> {
    let mut left: Vec<usize> = (0..net.stops.len()).collect();
    let mut route = Route {
        path: vec![depot.access],
        stops: Vec::new(),
    };
    let mut here = depot.access;
    for _ in 0..MAX_ROUTE_SEARCHES {
        if route.stops.len() >= MAX_ROUTE_STOPS {
            break;
        }
        let Some(p) = nearest(g, net, &left, here) else {
            break;
        };
        let stop = left.remove(p);
        let to = net.stops[stop].access;
        if to != here {
            let Some(leg) = finder.find(g, load, here, to) else {
                continue; // no road path: this stop is not served
            };
            route.path.extend_from_slice(&leg[1..]);
        }
        route.stops.push(RouteStop {
            stop,
            at: route.path.len() - 1,
        });
        here = to;
    }
    if route.stops.is_empty() {
        return None;
    }
    if here != depot.access {
        let leg = finder.find(g, load, here, depot.access)?;
        route.path.extend_from_slice(&leg[1..]);
    }
    close(route)
}

/// Drops the last tile (the depot's road again) so that the loop wraps without a repeat.
fn close(mut route: Route) -> Option<Route> {
    if route.path.len() > 1 && route.path.last() == route.path.first() {
        route.path.pop();
    }
    if route.path.len() < 2 {
        return None;
    }
    let len = route.path.len();
    for s in &mut route.stops {
        if s.at >= len {
            s.at = 0;
        }
    }
    Some(route)
}
