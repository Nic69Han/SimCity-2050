//! The riot: fires in the unhappiest residential neighbourhood.

use super::{
    draw, MESSAGE_RIOTS_REPORTED, RIOT_APPROVAL_MAX, RIOT_CRIME_MIN, RIOT_FIRES, RIOT_RADIUS,
    RIOT_TRIES_PER_FIRE,
};
use crate::disasters::random_fire;
use crate::simulation::Simulation;
use crate::tile::{Tile, BURNBIT, HOSPITAL, LOMASK, RESBASE, ZONEBIT};

/// Whether the city is angry enough for a random riot: mean crime of [`RIOT_CRIME_MIN`] or more and
/// satisfaction under [`RIOT_APPROVAL_MAX`].
pub fn condition(sim: &Simulation) -> bool {
    i32::from(sim.crime_average) >= RIOT_CRIME_MIN && i32::from(sim.city_yes) < RIOT_APPROVAL_MAX
}

fn is_residential_centre(tile: Tile) -> bool {
    tile & ZONEBIT != 0 && (RESBASE..HOSPITAL).contains(&(tile & LOMASK))
}

/// The residential zone centre whose crime block is the highest; ties go to the smaller x, then
/// the smaller y. `None` without a residential zone.
pub fn centre(sim: &Simulation) -> Option<(i32, i32)> {
    let (w, h) = sim.world_size();
    let mut best: Option<(i32, (i32, i32))> = None;
    for x in 0..w {
        for y in 0..h {
            if !sim.tile(x, y).is_some_and(is_residential_centre) {
                continue;
            }
            let crime = i32::from(sim.crime_rate_map.world_get(x, y));
            if best.is_none_or(|(c, _)| crime > c) {
                best = Some((crime, (x, y)));
            }
        }
    }
    best.map(|(_, at)| at)
}

/// Whether a riot fire may start on `tile`: a building tile that burns, not a zone centre.
fn can_burn(sim: &Simulation, tile: Tile) -> bool {
    tile & BURNBIT != 0 && sim.vulnerable(i32::from(tile))
}

/// Starts a riot: [`RIOT_FIRES`] classic fires around the centre. The place, or `None` when the
/// city has no residential zone (nothing is drawn then).
pub fn start(sim: &mut Simulation) -> Option<(i32, i32)> {
    let (cx, cy) = centre(sim)?;
    let span = 2 * RIOT_RADIUS + 1;
    for _ in 0..RIOT_FIRES {
        for _ in 0..RIOT_TRIES_PER_FIRE {
            let (x, y) = (
                cx + draw(sim, span) - RIOT_RADIUS,
                cy + draw(sim, span) - RIOT_RADIUS,
            );
            if sim.tile(x, y).is_some_and(|t| can_burn(sim, t)) {
                let fire = random_fire(&mut sim.rng);
                sim.set_tile(x, y, fire);
                break;
            }
        }
    }
    sim.send_message(MESSAGE_RIOTS_REPORTED, cx as i16, cy as i16, true, true);
    Some((cx, cy))
}
