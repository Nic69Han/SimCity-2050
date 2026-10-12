//! Port of `fileio.cpp`: the `.cty` city file format, as pure functions on
//! byte slices. Reading and writing files is the adapter's job.
//!
//! Layout (all values big-endian 16 bit): six histories of 240 values
//! (res, com, ind, crime, pollution, money), the misc history (120 values),
//! then the 120x100 tile map in column-major order. 27 120 bytes in total.
//! Longs inside the misc history are two shorts, high word first.
//!
//! Other map sizes (wave 6, the "extended" file): the same sections for a
//! `width` x `height` map, behind a 10-byte header: the magic `MCTY`, the
//! format version (u16) and the width and height (u16 each), all big-endian.
//! A 120x100 city is always written as a plain `.cty`, byte for byte as the
//! original game writes it.

use crate::simulation::{Scenario, Simulation, HISTORY_LEN, MISC_HISTORY_LEN};
use crate::{DEFAULT_WORLD_H, DEFAULT_WORLD_W};

/// Size of a plain `.cty` file (the original 120x100 city).
pub const CTY_SIZE: usize = 27_120;

/// First four bytes of an extended city file.
pub const CITY_FILE_MAGIC: [u8; 4] = *b"MCTY";
/// Version of the extended city file; the only one this reader knows.
pub const CITY_FILE_VERSION: u16 = 1;
/// Bytes of the extended file header: magic, version, width, height.
pub const CITY_FILE_HEADER_SIZE: usize = 10;

/// Smallest and largest map a city file can describe (the sizes the engine is verified at).
pub const CITY_MIN_WIDTH: i32 = 80;
pub const CITY_MIN_HEIGHT: i32 = 67;
pub const CITY_MAX_WIDTH: i32 = 512;
pub const CITY_MAX_HEIGHT: i32 = 512;

/// Bytes of the data after the header (and of a whole `.cty` file): the histories, the misc
/// history and the tile map, all 16-bit big-endian.
pub fn payload_size(width: i32, height: i32) -> usize {
    2 * (6 * HISTORY_LEN + MISC_HISTORY_LEN + (width as usize) * (height as usize))
}

/// Why a city file was refused. Every variant has a stable [`code`](Self::code); the
/// `Display` text is `<code>: <detail>`, which is what the adapters show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CityFileError {
    /// The file is longer than what its header (or, for a `.cty`, its size) allows.
    BadSize { len: usize, expected: usize },
    /// Not a `.cty` (not [`CTY_SIZE`] bytes) and not an extended file (no `MCTY` header).
    BadMagic(usize),
    /// An extended file of a version this reader does not know.
    BadVersion(u16),
    /// An extended file whose map is outside [`CITY_MIN_WIDTH`]x[`CITY_MIN_HEIGHT`] ..
    /// [`CITY_MAX_WIDTH`]x[`CITY_MAX_HEIGHT`].
    SizeOutOfRange { width: i32, height: i32 },
    /// The file ends before what its header (or its size) says it holds.
    Truncated { len: usize, expected: usize },
    /// A `.cty` file loaded into an engine that is not the original 120x100 world (only the
    /// raw data loader [`Simulation::load_cty_data`] checks this).
    WorldSizeMismatch {
        expected: (i32, i32),
        actual: (i32, i32),
    },
}

/// Former name of [`CityFileError`], kept for the `.cty` functions.
pub type CtyError = CityFileError;

impl CityFileError {
    /// Stable machine-readable code of the error.
    pub fn code(&self) -> &'static str {
        match self {
            CityFileError::BadSize { .. } => "cty_bad_size",
            CityFileError::BadMagic(_) => "cty_bad_magic",
            CityFileError::BadVersion(_) => "cty_bad_version",
            CityFileError::SizeOutOfRange { .. } => "cty_size_out_of_range",
            CityFileError::Truncated { .. } => "cty_truncated",
            CityFileError::WorldSizeMismatch { .. } => "cty_world_size_mismatch",
        }
    }
}

impl std::fmt::Display for CityFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let code = self.code();
        match self {
            CityFileError::BadSize { len, expected } => {
                write!(f, "{code}: {len} bytes, expected {expected}")
            }
            CityFileError::BadMagic(len) => write!(
                f,
                "{code}: {len} bytes, neither a {CTY_SIZE}-byte .cty nor a file with the MCTY header"
            ),
            CityFileError::BadVersion(v) => write!(
                f,
                "{code}: city file version {v}, this reader reads version {CITY_FILE_VERSION}"
            ),
            CityFileError::SizeOutOfRange { width, height } => write!(
                f,
                "{code}: map {width}x{height}, the sizes are {CITY_MIN_WIDTH}x{CITY_MIN_HEIGHT} to {CITY_MAX_WIDTH}x{CITY_MAX_HEIGHT}"
            ),
            CityFileError::Truncated { len, expected } => {
                write!(f, "{code}: {len} bytes, expected {expected}")
            }
            CityFileError::WorldSizeMismatch { expected, actual } => write!(
                f,
                "{code}: world {actual:?} does not match the .cty size {expected:?}"
            ),
        }
    }
}

impl std::error::Error for CityFileError {}

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

/// A city file split into its map size and its data: the header is already checked.
struct CityFile<'a> {
    width: i32,
    height: i32,
    /// The data after the header (the whole file for a plain `.cty`).
    payload: &'a [u8],
    /// A plain `.cty` file (no header, 120x100).
    plain_cty: bool,
}

/// Checks a city file completely (magic, version, size, exact length) without touching any
/// engine: a refused file never changes anything.
fn parse_city_file(bytes: &[u8]) -> Result<CityFile<'_>, CityFileError> {
    let len = bytes.len();
    if len == CTY_SIZE {
        return Ok(CityFile {
            width: DEFAULT_WORLD_W,
            height: DEFAULT_WORLD_H,
            payload: bytes,
            plain_cty: true,
        });
    }
    if len < 4 || bytes[..4] != CITY_FILE_MAGIC {
        // Not an extended file. Shorter than a .cty: a truncated .cty (or no city at all).
        return Err(if len < CTY_SIZE {
            CityFileError::Truncated {
                len,
                expected: CTY_SIZE,
            }
        } else {
            CityFileError::BadMagic(len)
        });
    }
    if len < CITY_FILE_HEADER_SIZE {
        return Err(CityFileError::Truncated {
            len,
            expected: CITY_FILE_HEADER_SIZE,
        });
    }
    let version = u16::from_be_bytes([bytes[4], bytes[5]]);
    if version != CITY_FILE_VERSION {
        return Err(CityFileError::BadVersion(version));
    }
    let width = i32::from(u16::from_be_bytes([bytes[6], bytes[7]]));
    let height = i32::from(u16::from_be_bytes([bytes[8], bytes[9]]));
    if !(CITY_MIN_WIDTH..=CITY_MAX_WIDTH).contains(&width)
        || !(CITY_MIN_HEIGHT..=CITY_MAX_HEIGHT).contains(&height)
    {
        return Err(CityFileError::SizeOutOfRange { width, height });
    }
    let expected = CITY_FILE_HEADER_SIZE + payload_size(width, height);
    match len.cmp(&expected) {
        std::cmp::Ordering::Less => Err(CityFileError::Truncated { len, expected }),
        std::cmp::Ordering::Greater => Err(CityFileError::BadSize { len, expected }),
        std::cmp::Ordering::Equal => Ok(CityFile {
            width,
            height,
            payload: &bytes[CITY_FILE_HEADER_SIZE..],
            plain_cty: false,
        }),
    }
}

impl Simulation {
    /// The `.cty` size check of the 120x100 loaders.
    fn check_cty_size(bytes: &[u8]) -> Result<(), CityFileError> {
        if bytes.len() != CTY_SIZE {
            return Err(CityFileError::BadSize {
                len: bytes.len(),
                expected: CTY_SIZE,
            });
        }
        Ok(())
    }

    /// Whether `bytes` can be loaded into this engine as raw data (size of the file and of
    /// the world).
    fn check_cty(&self, bytes: &[u8]) -> Result<(), CityFileError> {
        if self.world_size() != (DEFAULT_WORLD_W, DEFAULT_WORLD_H) {
            return Err(CityFileError::WorldSizeMismatch {
                expected: (DEFAULT_WORLD_W, DEFAULT_WORLD_H),
                actual: self.world_size(),
            });
        }
        Self::check_cty_size(bytes)
    }

    /// Replace the city by the one of `payload` (the data of a `.cty` or of an extended file,
    /// `payload_size(width, height)` bytes) on a `width` x `height` engine, then run what
    /// `loadFile` runs after its data. The generator and the start year survive; the rest is
    /// a freshly constructed engine. The caller has checked `payload`.
    fn install_payload(&mut self, width: i32, height: i32, payload: &[u8]) {
        let rng = self.rng.clone();
        let starting_year = self.starting_year;
        *self = Simulation::new(width, height);
        self.rng = rng;
        self.starting_year = starting_year;
        self.read_payload(payload);
        // `loadFile` resets the funding levels to full (initFundingLevel) after reading them.
        self.init_funding_level();
        self.init_will_stuff();
        self.scenario = Scenario::None;
        self.init_sim_load = 1;
        self.do_initial_eval = false;
        self.do_sim_init();
        self.map_serial += 1;
        self.push_event(crate::events::Event::NewCity);
    }

    /// Port of `loadFile`: replace the city with the one in `bytes`, run
    /// `doSimInit` (scans, census, power) like the original does.
    ///
    /// A `.cty` file describes the original 120x100 world, so the engine is 120x100 after a
    /// successful load, whatever size it had before. The result depends only on `bytes` and the
    /// current random generator state, never on what the engine held before: the engine is
    /// rebuilt first (the C++ loads into a freshly constructed engine). Only the generator state
    /// and the start year survive. A refused file leaves the engine untouched.
    pub fn load_cty(&mut self, bytes: &[u8]) -> Result<(), CityFileError> {
        Self::check_cty_size(bytes)?;
        self.install_payload(DEFAULT_WORLD_W, DEFAULT_WORLD_H, bytes);
        Ok(())
    }

    /// [`load_cty`](Self::load_cty) after seeding the random generator: the result depends on
    /// `bytes` and `seed` only. (The original seeds from the clock, which is not reproducible.)
    pub fn load_cty_seeded(&mut self, bytes: &[u8], seed: i32) -> Result<(), CityFileError> {
        Self::check_cty_size(bytes)?;
        self.rng.seed(seed);
        self.load_cty(bytes)
    }

    /// Load a city of any size: a plain `.cty` (120x100, through [`load_cty_seeded`]) or an
    /// extended file (magic `MCTY`, see the module documentation). The engine is rebuilt at the
    /// file's size; the result depends on `bytes` and `seed` only. The whole file is checked
    /// before anything changes: a refused file leaves the engine untouched.
    ///
    /// [`load_cty_seeded`]: Self::load_cty_seeded
    pub fn load_city(&mut self, bytes: &[u8], seed: i32) -> Result<(), CityFileError> {
        let file = parse_city_file(bytes)?;
        if file.plain_cty {
            return self.load_cty_seeded(bytes, seed);
        }
        self.rng.seed(seed);
        self.install_payload(file.width, file.height, file.payload);
        Ok(())
    }

    /// Only the data part of `loadFile`: histories, tiles, and the settings
    /// stored in the misc history. No scans: the tile map is the raw file's.
    pub fn load_cty_data(&mut self, bytes: &[u8]) -> Result<(), CityFileError> {
        self.check_cty(bytes)?;
        self.read_payload(bytes);
        Ok(())
    }

    /// Reads the histories, the misc history (funds, time, tax, speed, flags, percents) and
    /// the tile map of `bytes` (a payload of this engine's size; checked by the callers).
    fn read_payload(&mut self, bytes: &[u8]) {
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
    }

    /// Port of `saveFile`: serialise the city. Takes `&self`; the misc history
    /// is patched in a copy. This is the data of a `.cty` (the payload of any size).
    pub fn save_cty(&self) -> Vec<u8> {
        self.save_payload()
    }

    /// Serialise the city in the format of its size: a 120x100 city is a plain `.cty` (the
    /// bytes of [`save_cty`](Self::save_cty)); any other size is an extended file with the
    /// `MCTY` header. [`load_city`](Self::load_city) reads both back.
    pub fn save_city(&self) -> Vec<u8> {
        let payload = self.save_payload();
        let (width, height) = self.world_size();
        if (width, height) == (DEFAULT_WORLD_W, DEFAULT_WORLD_H) {
            return payload;
        }
        let mut out = Vec::with_capacity(CITY_FILE_HEADER_SIZE + payload.len());
        out.extend_from_slice(&CITY_FILE_MAGIC);
        out.extend_from_slice(&CITY_FILE_VERSION.to_be_bytes());
        out.extend_from_slice(&(width as u16).to_be_bytes());
        out.extend_from_slice(&(height as u16).to_be_bytes());
        out.extend_from_slice(&payload);
        out
    }

    /// The data of a city file (histories, misc history, tile map), of any world size.
    fn save_payload(&self) -> Vec<u8> {
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

        let (w, h) = self.world_size();
        let mut out = Vec::with_capacity(payload_size(w, h));
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
        assert_eq!(
            s.load_cty(&HAIGHT[..100]),
            Err(CityFileError::BadSize {
                len: 100,
                expected: CTY_SIZE
            })
        );
    }

    #[test]
    fn load_gives_the_original_size() {
        // A .cty file is a 120x100 city: loading one into another size gives 120x100.
        let mut s = Simulation::new(50, 50);
        s.load_cty(HAIGHT).unwrap();
        assert_eq!(s.world_size(), (120, 100));
        assert_eq!(s.tiles.len(), 120 * 100);
        // The raw data loader still needs a 120x100 engine: it fills the current arrays.
        let mut t = Simulation::new(50, 50);
        assert!(matches!(
            t.load_cty_data(HAIGHT),
            Err(CityFileError::WorldSizeMismatch { .. })
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

    #[test]
    fn payload_sizes() {
        assert_eq!(payload_size(120, 100), CTY_SIZE);
        assert_eq!(payload_size(80, 67), 2 * (1440 + 120 + 80 * 67));
    }

    #[test]
    fn codes_and_messages() {
        let e = CityFileError::BadMagic(5);
        assert_eq!(e.code(), "cty_bad_magic");
        assert!(e.to_string().starts_with("cty_bad_magic: "));
        assert_eq!(
            CityFileError::SizeOutOfRange {
                width: 79,
                height: 100
            }
            .code(),
            "cty_size_out_of_range"
        );
        assert_eq!(CityFileError::BadVersion(2).code(), "cty_bad_version");
        assert_eq!(
            CityFileError::Truncated {
                len: 1,
                expected: 2
            }
            .code(),
            "cty_truncated"
        );
        assert_eq!(
            CityFileError::BadSize {
                len: 1,
                expected: 2
            }
            .code(),
            "cty_bad_size"
        );
    }

    #[test]
    fn extended_header_is_checked() {
        let mut s = Simulation::with_default_size();
        let mut b = vec![0u8; CITY_FILE_HEADER_SIZE];
        b[..4].copy_from_slice(b"MCTY");
        b[4..6].copy_from_slice(&1u16.to_be_bytes());
        b[6..8].copy_from_slice(&79u16.to_be_bytes());
        b[8..10].copy_from_slice(&100u16.to_be_bytes());
        assert_eq!(
            s.load_city(&b, 1).unwrap_err().code(),
            "cty_size_out_of_range"
        );
        b[6..8].copy_from_slice(&80u16.to_be_bytes());
        b[8..10].copy_from_slice(&67u16.to_be_bytes());
        assert_eq!(s.load_city(&b, 1).unwrap_err().code(), "cty_truncated");
        b[4..6].copy_from_slice(&7u16.to_be_bytes());
        assert_eq!(s.load_city(&b, 1).unwrap_err().code(), "cty_bad_version");
    }

    #[test]
    fn saved_extended_file_has_the_header() {
        let mut s = Simulation::new(97, 83);
        s.new_random_city(3);
        let bytes = s.save_city();
        assert_eq!(&bytes[..4], b"MCTY");
        assert_eq!(u16::from_be_bytes([bytes[4], bytes[5]]), 1);
        assert_eq!(u16::from_be_bytes([bytes[6], bytes[7]]), 97);
        assert_eq!(u16::from_be_bytes([bytes[8], bytes[9]]), 83);
        assert_eq!(bytes.len(), CITY_FILE_HEADER_SIZE + payload_size(97, 83));
    }

    #[test]
    fn a_120x100_city_is_a_plain_cty() {
        let mut s = Simulation::with_default_size();
        s.load_cty(HAIGHT).unwrap();
        assert_eq!(s.save_city(), s.save_cty());
    }
}
