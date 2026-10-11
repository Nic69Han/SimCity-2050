//! Port of `fileio.cpp`: the `.cty` city file format, as pure functions on
//! byte slices. Reading and writing files is the adapter's job.
//!
//! Layout (all values big-endian 16 bit): six histories of 240 values
//! (res, com, ind, crime, pollution, money), the misc history (120 values),
//! then the 120x100 tile map in column-major order. 27 120 bytes in total.
//! Longs inside the misc history are two shorts, high word first.

use crate::simulation::{Scenario, Simulation, HISTORY_LEN, MISC_HISTORY_LEN};
use crate::{DEFAULT_WORLD_H, DEFAULT_WORLD_W};

pub const CTY_SIZE: usize = 27_120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CtyError {
    /// The file is not exactly [`CTY_SIZE`] bytes.
    BadSize(usize),
    /// `.cty` files describe a 120x100 world; the simulation has another size.
    WorldSizeMismatch {
        expected: (i32, i32),
        actual: (i32, i32),
    },
}

impl std::fmt::Display for CtyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CtyError::BadSize(n) => write!(f, "invalid .cty size: {n} bytes (expected {CTY_SIZE})"),
            CtyError::WorldSizeMismatch { expected, actual } => {
                write!(
                    f,
                    "world size {actual:?} does not match .cty size {expected:?}"
                )
            }
        }
    }
}

impl std::error::Error for CtyError {}

// Indices into the misc history.
const M_CITY_TIME: usize = 8;
const M_FUNDS: usize = 50;
const M_AUTO_BULLDOZE: usize = 52;
const M_AUTO_BUDGET: usize = 53;
const M_CITY_TAX: usize = 56;
const M_SPEED: usize = 57;
const M_POLICE: usize = 58;
const M_FIRE: usize = 60;
const M_ROAD: usize = 62;

fn be_short(b: &[u8], i: usize) -> i16 {
    i16::from_be_bytes([b[2 * i], b[2 * i + 1]])
}

fn read_shorts(b: &[u8], offset_shorts: usize, out: &mut [i16]) {
    for (i, v) in out.iter_mut().enumerate() {
        *v = be_short(b, offset_shorts + i);
    }
}

fn long_at(misc: &[i16], i: usize) -> i32 {
    (((misc[i] as u16 as u32) << 16) | misc[i + 1] as u16 as u32) as i32
}

fn set_long(misc: &mut [i16], i: usize, v: i32) {
    misc[i] = (v >> 16) as i16;
    misc[i + 1] = v as i16;
}

impl Simulation {
    /// Port of `loadFile`: replace the city with the one in `bytes`, run
    /// `doSimInit` (scans, census, power) like the original does.
    pub fn load_cty(&mut self, bytes: &[u8]) -> Result<(), CtyError> {
        self.load_cty_data(bytes)?;
        self.init_will_stuff();
        self.scenario = Scenario::None;
        self.init_sim_load = 1;
        self.do_initial_eval = false;
        self.do_sim_init();
        self.map_serial += 1;
        self.push_event(crate::events::Event::NewCity);
        Ok(())
    }

    /// Only the data part of `loadFile`: histories, tiles, and the settings
    /// stored in the misc history. No scans: the tile map is the raw file's.
    pub fn load_cty_data(&mut self, bytes: &[u8]) -> Result<(), CtyError> {
        if self.world_size() != (DEFAULT_WORLD_W, DEFAULT_WORLD_H) {
            return Err(CtyError::WorldSizeMismatch {
                expected: (DEFAULT_WORLD_W, DEFAULT_WORLD_H),
                actual: self.world_size(),
            });
        }
        if bytes.len() != CTY_SIZE {
            return Err(CtyError::BadSize(bytes.len()));
        }

        let mut at = 0;
        for h in [
            &mut self.res_hist,
            &mut self.com_hist,
            &mut self.ind_hist,
            &mut self.crime_hist,
            &mut self.pollution_hist,
            &mut self.money_hist,
        ] {
            read_shorts(bytes, at, &mut h[..HISTORY_LEN]);
            at += HISTORY_LEN;
        }
        read_shorts(bytes, at, &mut self.misc_hist[..MISC_HISTORY_LEN]);
        at += MISC_HISTORY_LEN;
        for (i, t) in self.tiles.iter_mut().enumerate() {
            *t = be_short(bytes, at + i) as u16;
        }

        let m = &self.misc_hist;
        self.total_funds = long_at(m, M_FUNDS) as i64;
        self.city_time = (long_at(m, M_CITY_TIME) as i64).max(0);
        self.auto_bulldoze = m[M_AUTO_BULLDOZE] != 0;
        self.auto_budget = m[M_AUTO_BUDGET] != 0;
        self.city_tax = m[M_CITY_TAX];
        self.sim_speed = m[M_SPEED];
        self.police_percent = long_at(m, M_POLICE) as f32 / 65536.0;
        self.fire_percent = long_at(m, M_FIRE) as f32 / 65536.0;
        self.road_percent = long_at(m, M_ROAD) as f32 / 65536.0;
        self.census_changed = true;

        if !(0..=20).contains(&self.city_tax) {
            self.city_tax = 7;
        }
        if !(0..=3).contains(&self.sim_speed) {
            self.sim_speed = 3;
        }
        self.sim_speed_meta = self.sim_speed;
        self.sim_passes = 1;

        Ok(())
    }

    /// Port of `saveFile`: serialise the city. Takes `&self`; the misc history
    /// is patched in a copy.
    pub fn save_cty(&self) -> Vec<u8> {
        let mut misc = self.misc_hist.clone();
        set_long(&mut misc, M_FUNDS, self.total_funds as i32);
        set_long(&mut misc, M_CITY_TIME, self.city_time as i32);
        misc[M_AUTO_BULLDOZE] = self.auto_bulldoze as i16;
        misc[M_AUTO_BUDGET] = self.auto_budget as i16;
        misc[M_CITY_TAX] = self.city_tax;
        misc[M_SPEED] = self.sim_speed;
        set_long(&mut misc, M_POLICE, (self.police_percent * 65536.0) as i32);
        set_long(&mut misc, M_FIRE, (self.fire_percent * 65536.0) as i32);
        set_long(&mut misc, M_ROAD, (self.road_percent * 65536.0) as i32);

        let mut out = Vec::with_capacity(CTY_SIZE);
        for h in [
            &self.res_hist,
            &self.com_hist,
            &self.ind_hist,
            &self.crime_hist,
            &self.pollution_hist,
            &self.money_hist,
        ] {
            h[..HISTORY_LEN]
                .iter()
                .for_each(|v| out.extend(v.to_be_bytes()));
        }
        misc[..MISC_HISTORY_LEN]
            .iter()
            .for_each(|v| out.extend(v.to_be_bytes()));
        self.tiles.iter().for_each(|t| out.extend(t.to_be_bytes()));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

    #[test]
    fn size_is_checked() {
        let mut s = Simulation::with_default_size();
        assert_eq!(s.load_cty(&HAIGHT[..100]), Err(CtyError::BadSize(100)));
    }

    #[test]
    fn world_size_is_checked() {
        let mut s = Simulation::new(50, 50);
        assert!(matches!(
            s.load_cty(HAIGHT),
            Err(CtyError::WorldSizeMismatch { .. })
        ));
    }

    #[test]
    fn loads_haight() {
        let mut s = Simulation::with_default_size();
        s.load_cty(HAIGHT).unwrap();
        // Tile map is the 12 000 big-endian shorts at the end of the file.
        let off = CTY_SIZE - 24_000;
        assert_eq!(
            s.tiles[0],
            u16::from_be_bytes([HAIGHT[off], HAIGHT[off + 1]])
        );
        assert!(s.total_funds > 0, "funds: {}", s.total_funds);
        assert!(s.city_time >= 0);
        assert!((0..=20).contains(&s.city_tax));
        assert!((0..=3).contains(&s.sim_speed));
        assert!(s.tiles.iter().any(|&t| t & crate::tile::ZONEBIT != 0));
        assert!(s.drain_events().contains(&crate::events::Event::NewCity));
    }

    #[test]
    fn save_round_trips() {
        let mut s = Simulation::with_default_size();
        s.load_cty_data(HAIGHT).unwrap();
        let saved = s.save_cty();
        assert_eq!(saved.len(), CTY_SIZE);
        let mut t = Simulation::with_default_size();
        t.load_cty_data(&saved).unwrap();
        assert_eq!(s.tiles, t.tiles);
        assert_eq!(s.total_funds, t.total_funds);
        assert_eq!(s.city_time, t.city_time);
        assert_eq!(s.misc_hist, t.misc_hist);
        assert_eq!(t.save_cty(), saved);
    }

    #[test]
    fn longs_are_high_word_first() {
        let mut m = vec![0i16; 120];
        set_long(&mut m, 50, 0x0001_86a0); // 100 000
        assert_eq!((m[50], m[51]), (1, -31072));
        assert_eq!(long_at(&m, 50), 100_000);
    }
}
