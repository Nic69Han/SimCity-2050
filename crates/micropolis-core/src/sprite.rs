//! Port of `sprite.cpp`: moving objects (trains, helicopters, airplanes,
//! ships, monsters, tornadoes, explosions, buses).
//!
//! Divergences from the C++ (see ARCHITECTURE.md rule 7):
//! - `SimSprite *` becomes an index into `Simulation::sprites`. The C++ lists
//!   (`spriteList`, `freeSprites`, `SimSprite::next`) keep their order
//!   semantics: new sprites are pushed at the head, freed sprites are reused
//!   last-in first-out, and `move_objects` reads `next` at the same points.
//! - `SimSprite::name` is dropped. Every sprite is created with the empty name,
//!   so the C++ test `name[0] == '\0'` in `moveObjects` is always true for the
//!   sprites on the list.
//! - `makeSound` is front-end only and is not ported. The random numbers that
//!   are drawn only to choose a sound are still drawn, in the same order.
//! - World dimensions are the runtime values of `world_size()` instead of the
//!   compile-time `WORLD_W` / `WORLD_H`.
//! - `randomFire()` (an inline in `micropolis.h`) is ported as
//!   `random_fire_tile`, to avoid a name clash with its other users.

use crate::message::{
    MESSAGE_EXPLOSION_REPORTED, MESSAGE_HEAVY_TRAFFIC, MESSAGE_HELICOPTER_CRASHED,
    MESSAGE_MONSTER_SIGHTED, MESSAGE_PLANE_CRASHED, MESSAGE_SHIP_CRASHED, MESSAGE_TORNADO_SIGHTED,
    MESSAGE_TRAIN_CRASHED,
};
use crate::position::Position;
use crate::simulation::{Scenario, Simulation};
use crate::tile::{Tile, ANIMBIT, BULLBIT, BURNBIT, LOMASK, ZONEBIT};
use crate::tile_chars as tc;

/// `SpriteType` values from `micropolis.h`.
pub const SPRITE_NOTUSED: i32 = 0;
pub const SPRITE_TRAIN: i32 = 1;
pub const SPRITE_HELICOPTER: i32 = 2;
pub const SPRITE_AIRPLANE: i32 = 3;
pub const SPRITE_SHIP: i32 = 4;
pub const SPRITE_MONSTER: i32 = 5;
pub const SPRITE_TORNADO: i32 = 6;
pub const SPRITE_EXPLOSION: i32 = 7;
pub const SPRITE_BUS: i32 = 8;
/// Number of sprite types (`SPRITE_COUNT`).
pub const SPRITE_COUNT: usize = 9;

const TRA_GROOVE_X: i32 = -39;
const TRA_GROOVE_Y: i32 = 6;
const BUS_GROOVE_X: i32 = -39;
const BUS_GROOVE_Y: i32 = 6;

/// Port of `SimSprite`. All numeric fields are C `int`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Sprite {
    /// Next sprite in the active list, or in the free pool (C++ `next`).
    pub next: Option<usize>,
    /// Sprite type, `SPRITE_TRAIN` ..= `SPRITE_BUS` (C++ `type`).
    pub kind: i32,
    /// Animation frame; 0 means inactive.
    pub frame: i32,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    pub x_hot: i32,
    pub y_hot: i32,
    pub orig_x: i32,
    pub orig_y: i32,
    pub dest_x: i32,
    pub dest_y: i32,
    pub count: i32,
    pub sound_count: i32,
    pub dir: i32,
    pub new_dir: i32,
    pub step: i32,
    pub flag: i32,
    pub control: i32,
    pub turn: i32,
    pub accel: i32,
    pub speed: i32,
}

impl Simulation {
    /// `sendMessage` with the sprite code's `int` coordinates.
    fn sprite_message(&mut self, mesg: i16, x: i32, y: i32, picture: bool, important: bool) {
        self.send_message(mesg, x as i16, y as i16, picture, important);
    }

    /// Port of `newSprite`: take a sprite from the free pool, or allocate one,
    /// initialise it and push it at the head of the active list.
    /// The C++ `name` argument is always `""` and is not kept.
    pub fn new_sprite(&mut self, kind: i32, x: i32, y: i32) -> usize {
        let idx = match self.free_sprites {
            Some(free) => {
                self.free_sprites = self.sprites[free].next;
                free
            }
            None => {
                self.sprites.push(Sprite::default());
                self.sprites.len() - 1
            }
        };
        self.sprites[idx].kind = kind;
        self.init_sprite(idx, x, y);
        self.sprites[idx].next = self.sprite_list;
        self.sprite_list = Some(idx);
        idx
    }

    /// Port of `initSprite`: (re)initialise a sprite for its type.
    pub fn init_sprite(&mut self, idx: usize, x: i32, y: i32) {
        let (world_w, world_h) = self.world_size();
        {
            let s = &mut self.sprites[idx];
            s.x = x;
            s.y = y;
            s.frame = 0;
            s.orig_x = 0;
            s.orig_y = 0;
            s.dest_x = 0;
            s.dest_y = 0;
            s.count = 0;
            s.sound_count = 0;
            s.dir = 0;
            s.new_dir = 0;
            s.step = 0;
            s.flag = 0;
            s.control = -1;
            s.turn = 0;
            s.accel = 0;
            s.speed = 100;
        }

        let kind = self.sprites[idx].kind;
        if self.global_sprites[kind as usize].is_none() {
            self.global_sprites[kind as usize] = Some(idx);
        }

        match kind {
            SPRITE_TRAIN => {
                let s = &mut self.sprites[idx];
                s.width = 32;
                s.height = 32;
                s.x_offset = 32;
                s.y_offset = -16;
                s.x_hot = 40;
                s.y_hot = -8;
                s.frame = 1;
                s.dir = 4;
            }

            SPRITE_SHIP => {
                let frame = if x < (4 << 4) {
                    3
                } else if x >= ((world_w - 4) << 4) {
                    7
                } else if y < (4 << 4) {
                    5
                } else if y >= ((world_h - 4) << 4) {
                    1
                } else {
                    3
                };
                let s = &mut self.sprites[idx];
                s.width = 48;
                s.height = 48;
                s.x_offset = 32;
                s.y_offset = -16;
                s.x_hot = 48;
                s.y_hot = 0;
                s.frame = frame;
                s.new_dir = frame;
                s.dir = 10;
                s.count = 1;
            }

            SPRITE_MONSTER => {
                let half_w = (world_w << 4) / 2;
                let half_h = (world_h << 4) / 2;
                let frame = if x > half_w {
                    if y > half_h {
                        10
                    } else {
                        7
                    }
                } else if y > half_h {
                    1
                } else {
                    4
                };
                let dest_x = i32::from(self.pollution_max_x) << 4;
                let dest_y = i32::from(self.pollution_max_y) << 4;
                let s = &mut self.sprites[idx];
                s.width = 48;
                s.height = 48;
                s.x_offset = 24;
                s.y_offset = 0;
                s.x_hot = 40;
                s.y_hot = 16;
                s.frame = frame;
                s.count = 1000;
                s.dest_x = dest_x;
                s.dest_y = dest_y;
                s.orig_x = s.x;
                s.orig_y = s.y;
            }

            SPRITE_HELICOPTER => {
                let dest_x = self.sprite_rand((world_w << 4) - 1);
                let dest_y = self.sprite_rand((world_h << 4) - 1);
                let s = &mut self.sprites[idx];
                s.width = 32;
                s.height = 32;
                s.x_offset = 32;
                s.y_offset = -16;
                s.x_hot = 40;
                s.y_hot = -8;
                s.frame = 5;
                s.count = 1500;
                s.dest_x = dest_x;
                s.dest_y = dest_y;
                s.orig_x = x - 30;
                s.orig_y = y;
            }

            SPRITE_AIRPLANE => {
                let s = &mut self.sprites[idx];
                s.width = 48;
                s.height = 48;
                s.x_offset = 24;
                s.y_offset = 0;
                s.x_hot = 48;
                s.y_hot = 16;
                if x > ((world_w - 20) << 4) {
                    s.x -= 100 + 48;
                    s.dest_x = s.x - 200;
                    s.frame = 7;
                } else {
                    s.dest_x = s.x + 200;
                    s.frame = 11;
                }
                s.dest_y = s.y;
            }

            SPRITE_TORNADO => {
                let s = &mut self.sprites[idx];
                s.width = 48;
                s.height = 48;
                s.x_offset = 24;
                s.y_offset = 0;
                s.x_hot = 40;
                s.y_hot = 36;
                s.frame = 1;
                s.count = 200;
            }

            SPRITE_EXPLOSION => {
                let s = &mut self.sprites[idx];
                s.width = 48;
                s.height = 48;
                s.x_offset = 24;
                s.y_offset = 0;
                s.x_hot = 40;
                s.y_hot = 16;
                s.frame = 1;
            }

            SPRITE_BUS => {
                let s = &mut self.sprites[idx];
                s.width = 32;
                s.height = 32;
                s.x_offset = 30;
                s.y_offset = -18;
                s.x_hot = 40;
                s.y_hot = -8;
                s.frame = 1;
                s.dir = 1;
            }

            _ => {}
        }
    }

    /// Port of `destroyAllSprites`: deactivate every sprite on the active list.
    pub fn destroy_all_sprites(&mut self) {
        let mut cur = self.sprite_list;
        while let Some(i) = cur {
            self.sprites[i].frame = 0;
            cur = self.sprites[i].next;
        }
    }

    /// Port of `destroySprite`: unlink from the active list and push on the pool.
    pub fn destroy_sprite(&mut self, idx: usize) {
        let kind = self.sprites[idx].kind as usize;
        if self.global_sprites[kind] == Some(idx) {
            self.global_sprites[kind] = None;
        }

        if self.sprite_list == Some(idx) {
            self.sprite_list = self.sprites[idx].next;
        } else {
            let mut cur = self.sprite_list;
            while let Some(c) = cur {
                if self.sprites[c].next == Some(idx) {
                    self.sprites[c].next = self.sprites[idx].next;
                    break;
                }
                cur = self.sprites[c].next;
            }
        }

        self.sprites[idx].next = self.free_sprites;
        self.free_sprites = Some(idx);
    }

    /// Port of `getSprite`: the global sprite of this type, if it is active.
    pub fn get_sprite(&self, kind: i32) -> Option<usize> {
        match self.global_sprites[kind as usize] {
            Some(i) if self.sprites[i].frame != 0 => Some(i),
            _ => None,
        }
    }

    /// Port of `makeSprite`: re-initialise the global sprite of this type, or
    /// create one when there is none.
    pub fn make_sprite(&mut self, kind: i32, x: i32, y: i32) -> usize {
        match self.global_sprites[kind as usize] {
            None => self.new_sprite(kind, x, y),
            Some(i) => {
                self.init_sprite(i, x, y);
                i
            }
        }
    }

    /// Port of `getChar`: map character at a pixel position, or -1 off-map.
    pub fn get_char(&self, x: i32, y: i32) -> i32 {
        let x = x >> 4;
        let y = y >> 4;
        if !self.on_map(x, y) {
            -1
        } else {
            i32::from(self.sprite_map_at(x, y) & LOMASK)
        }
    }

    /// Port of `turnTo`: turn one step from `p` towards `d` (both 1..8).
    pub fn turn_to(&self, p: i32, d: i32) -> i32 {
        if p == d {
            return p;
        }
        let mut p = p;
        if p < d {
            if d - p < 4 {
                p += 1;
            } else {
                p -= 1;
            }
        } else if p - d < 4 {
            p -= 1;
        } else {
            p += 1;
        }
        if p > 8 {
            p = 1;
        }
        if p < 1 {
            p = 8;
        }
        p
    }

    /// Port of `tryOther`.
    pub fn try_other(&self, tpoo: i32, told: i32, tnew: i32) -> bool {
        let mut z = told + 4;
        if z > 8 {
            z -= 8;
        }
        if tnew != z {
            return false;
        }
        let t = tpoo;
        t == i32::from(tc::POWERBASE)
            || t == i32::from(tc::POWERBASE) + 1
            || t == i32::from(tc::RAILBASE)
            || t == i32::from(tc::RAILBASE) + 1
    }

    /// Port of `spriteNotInBounds`: the sprite's hot spot is off the world.
    pub fn sprite_not_in_bounds(&self, idx: usize) -> bool {
        let s = &self.sprites[idx];
        let x = s.x + s.x_hot;
        let y = s.y + s.y_hot;
        let (world_w, world_h) = self.world_size();
        x < 0 || y < 0 || x >= (world_w << 4) || y >= (world_h << 4)
    }

    /// Port of `getDir`. Also stores the distance in `abs_dist` (C++ `absDist`).
    pub fn get_dir(&mut self, org_x: i32, org_y: i32, des_x: i32, des_y: i32) -> i32 {
        const GDTAB: [i32; 13] = [0, 3, 2, 1, 3, 4, 5, 7, 6, 5, 7, 8, 1];
        let mut disp_x = des_x - org_x;
        let mut disp_y = des_y - org_y;

        let mut z = if disp_x < 0 {
            if disp_y < 0 {
                11
            } else {
                8
            }
        } else if disp_y < 0 {
            2
        } else {
            5
        };

        disp_x = disp_x.abs();
        disp_y = disp_y.abs();
        self.abs_dist = disp_x + disp_y;

        if disp_x * 2 < disp_y {
            z += 1;
        } else if disp_y * 2 < disp_y {
            // Kept from the original, where this condition never holds.
            z -= 1;
        }

        if !(0..=12).contains(&z) {
            z = 0;
        }

        GDTAB[z as usize]
    }

    /// Port of `getDistance`: Manhattan distance.
    pub fn get_distance(&self, x1: i32, y1: i32, x2: i32, y2: i32) -> i32 {
        (x1 - x2).abs() + (y1 - y2).abs()
    }

    /// Port of `checkSpriteCollision`.
    pub fn check_sprite_collision(&self, s1: usize, s2: usize) -> bool {
        let a = &self.sprites[s1];
        let b = &self.sprites[s2];
        a.frame != 0
            && b.frame != 0
            && self.get_distance(a.x + a.x_hot, a.y + a.y_hot, b.x + b.x_hot, b.y + b.y_hot) < 30
    }

    /// Port of `moveObjects`: advance every active sprite once, and free the
    /// inactive ones that are still on the list.
    pub fn move_objects(&mut self) {
        if self.sim_speed == 0 {
            return;
        }

        self.sprite_cycle = self.sprite_cycle.wrapping_add(1);

        let mut cur = self.sprite_list;
        while let Some(i) = cur {
            if self.sprites[i].frame > 0 {
                match self.sprites[i].kind {
                    SPRITE_TRAIN => self.do_train_sprite(i),
                    SPRITE_HELICOPTER => self.do_copter_sprite(i),
                    SPRITE_AIRPLANE => self.do_airplane_sprite(i),
                    SPRITE_SHIP => self.do_ship_sprite(i),
                    SPRITE_MONSTER => self.do_monster_sprite(i),
                    SPRITE_TORNADO => self.do_tornado_sprite(i),
                    SPRITE_EXPLOSION => self.do_explosion_sprite(i),
                    SPRITE_BUS => self.do_bus_sprite(i),
                    _ => {}
                }
                cur = self.sprites[i].next;
            } else {
                let next = self.sprites[i].next;
                self.destroy_sprite(i);
                cur = next;
            }
        }
    }

    /// Port of `doTrainSprite`.
    pub fn do_train_sprite(&mut self, idx: usize) {
        // Offset in pixels of the sprite x and y to the map tile.
        const CX: [i32; 4] = [0, 16, 0, -16];
        const CY: [i32; 4] = [-16, 0, 16, 0];
        // X and Y movement of the sprite in pixels.
        const DX: [i32; 5] = [0, 4, 0, -4, 0];
        const DY: [i32; 5] = [-4, 0, 4, 0, 0];
        const TRAIN_PIC2: [i32; 5] = [1, 2, 1, 2, 5];

        if self.sprites[idx].frame == 3 || self.sprites[idx].frame == 4 {
            self.sprites[idx].frame = TRAIN_PIC2[self.sprites[idx].dir as usize];
        }

        {
            let s = &mut self.sprites[idx];
            s.x += DX[s.dir as usize];
            s.y += DY[s.dir as usize];
        }

        if (self.sprite_cycle & 3) == 0 {
            let dir = self.rng.random16() & 3;
            for z in dir..dir + 4 {
                let dir2 = z & 3;
                let (sx, sy, sdir) = {
                    let s = &self.sprites[idx];
                    (s.x, s.y, s.dir)
                };

                if sdir != 4 && dir2 == ((sdir + 2) & 3) {
                    continue;
                }

                let c = self.get_char(sx + CX[dir2 as usize] + 48, sy + CY[dir2 as usize]);

                if (c >= i32::from(tc::RAILBASE) && c <= i32::from(tc::LASTRAIL))
                    || c == i32::from(tc::RAILVPOWERH)
                    || c == i32::from(tc::RAILHPOWERV)
                {
                    let s = &mut self.sprites[idx];
                    if sdir != dir2 && sdir != 4 {
                        s.frame = if sdir + dir2 == 3 { 3 } else { 4 };
                    } else {
                        s.frame = TRAIN_PIC2[dir2 as usize];
                    }

                    if c == i32::from(tc::HRAIL) || c == i32::from(tc::VRAIL) {
                        s.frame = 5;
                    }

                    s.dir = dir2;
                    return;
                }
            }

            if self.sprites[idx].dir == 4 {
                self.sprites[idx].frame = 0;
                return;
            }

            self.sprites[idx].dir = 4;
        }
    }

    /// Port of `doCopterSprite`.
    pub fn do_copter_sprite(&mut self, idx: usize) {
        const CDX: [i32; 9] = [0, 0, 3, 5, 3, 0, -3, -5, -3];
        const CDY: [i32; 9] = [0, -5, -3, 0, 3, 5, 3, 0, -3];

        if self.sprites[idx].sound_count > 0 {
            self.sprites[idx].sound_count -= 1;
        }

        if self.sprites[idx].control < 0 {
            if self.sprites[idx].count > 0 {
                self.sprites[idx].count -= 1;
            }

            if self.sprites[idx].count == 0 {
                // Attract the copter to a monster, so it blows up more often.
                if let Some(m) = self.get_sprite(SPRITE_MONSTER) {
                    let (mx, my) = (self.sprites[m].x, self.sprites[m].y);
                    self.sprites[idx].dest_x = mx;
                    self.sprites[idx].dest_y = my;
                } else if let Some(t) = self.get_sprite(SPRITE_TORNADO) {
                    // Attract the copter to a tornado instead.
                    let (tx, ty) = (self.sprites[t].x, self.sprites[t].y);
                    self.sprites[idx].dest_x = tx;
                    self.sprites[idx].dest_y = ty;
                } else {
                    self.sprites[idx].dest_x = self.sprites[idx].orig_x;
                    self.sprites[idx].dest_y = self.sprites[idx].orig_y;
                }
            }

            if self.sprites[idx].count == 0 {
                // Land.
                let s = &self.sprites[idx];
                let (x, y, ox, oy) = (s.x, s.y, s.orig_x, s.orig_y);
                self.get_dir(x, y, ox, oy);
                if self.abs_dist < 30 {
                    self.sprites[idx].frame = 0;
                    return;
                }
            }
        } else {
            let s = &self.sprites[idx];
            let (x, y, dx, dy) = (s.x, s.y, s.dest_x, s.dest_y);
            self.get_dir(x, y, dx, dy);

            if self.abs_dist < 16 {
                let s = &mut self.sprites[idx];
                s.dest_x = s.orig_x;
                s.dest_y = s.orig_y;
                s.control = -1;
            }
        }

        if self.sprites[idx].sound_count == 0 {
            // Send a traffic report.
            let s = &self.sprites[idx];
            let x = (s.x + 48) / 16;
            let y = s.y / 16;
            let (world_w, world_h) = self.world_size();

            if x >= 0 && x < world_w && y >= 0 && y < world_h {
                // Heavy traffic is reported at a threshold of 170.
                let chopper_x = x + 1;
                let chopper_y = y + 1;
                if i32::from(self.traffic_density_map.world_get(x, y)) > 170
                    && (self.rng.random16() & 7) == 0
                {
                    self.sprite_message(MESSAGE_HEAVY_TRAFFIC, chopper_x, chopper_y, true, false);
                    self.sprites[idx].sound_count = 200;
                }
            }
        }

        let mut z = self.sprites[idx].frame;

        if (self.sprite_cycle & 3) == 0 {
            let (x, y, dx, dy) = {
                let s = &self.sprites[idx];
                (s.x, s.y, s.dest_x, s.dest_y)
            };
            let d = self.get_dir(x, y, dx, dy);
            z = self.turn_to(z, d);
            self.sprites[idx].frame = z;
        }

        let s = &mut self.sprites[idx];
        s.x += CDX[z as usize];
        s.y += CDY[z as usize];
    }

    /// Port of `doAirplaneSprite`.
    pub fn do_airplane_sprite(&mut self, idx: usize) {
        const CDX: [i32; 12] = [0, 0, 6, 8, 6, 0, -6, -8, -6, 8, 8, 8];
        const CDY: [i32; 12] = [0, -8, -6, 0, 6, 8, 6, 0, -6, 0, 0, 0];

        let mut z = self.sprites[idx].frame;

        if (self.sprite_cycle % 5) == 0 {
            if z > 8 {
                // Take off.
                z -= 1;
                if z < 9 {
                    z = 3;
                }
                self.sprites[idx].frame = z;
            } else {
                // Go to the destination.
                let s = &self.sprites[idx];
                let (x, y, dx, dy) = (s.x, s.y, s.dest_x, s.dest_y);
                let d = self.get_dir(x, y, dx, dy);
                z = self.turn_to(z, d);
                self.sprites[idx].frame = z;
            }
        }

        if self.abs_dist < 50 {
            // At the destination: pick a new one.
            let world_w = self.world_size().0;
            let world_h = self.world_size().1;
            let dest_x = self.sprite_rand(world_w * 16 + 100) - 50;
            let dest_y = self.sprite_rand(world_h * 16 + 100) - 50;
            let s = &mut self.sprites[idx];
            s.dest_x = dest_x;
            s.dest_y = dest_y;
        }

        if self.enable_disasters {
            // Check whether another sprite is near enough to collide with.
            let mut explode = false;
            let mut cur = self.sprite_list;
            while let Some(s) = cur {
                if self.sprites[s].frame != 0
                    && s != idx
                    && (self.sprites[s].kind == SPRITE_HELICOPTER
                        || self.sprites[s].kind == SPRITE_AIRPLANE)
                    && self.check_sprite_collision(idx, s)
                {
                    self.explode_sprite(s);
                    explode = true;
                }
                cur = self.sprites[s].next;
            }

            if explode {
                self.explode_sprite(idx);
            }
        }

        {
            let s = &mut self.sprites[idx];
            s.x += CDX[z as usize];
            s.y += CDY[z as usize];
        }

        if self.sprite_not_in_bounds(idx) {
            self.sprites[idx].frame = 0;
        }
    }

    /// Port of `doShipSprite`.
    pub fn do_ship_sprite(&mut self, idx: usize) {
        const BDX: [i32; 9] = [0, 0, 1, 1, 1, 0, -1, -1, -1];
        const BDY: [i32; 9] = [0, -1, -1, 0, 1, 1, 1, 0, -1];
        const BPX: [i32; 9] = [0, 0, 2, 2, 2, 0, -2, -2, -2];
        const BPY: [i32; 9] = [0, -2, -2, 0, 2, 2, 2, 0, -2];
        let bt_clr_tab: [Tile; 8] = [
            tc::RIVER,
            tc::CHANNEL,
            tc::POWERBASE,
            tc::POWERBASE + 1,
            tc::RAILBASE,
            tc::RAILBASE + 1,
            tc::BRWH,
            tc::BRWV,
        ];

        let mut t: Tile = tc::RIVER;

        if self.sprites[idx].sound_count > 0 {
            self.sprites[idx].sound_count -= 1;
        }

        if self.sprites[idx].sound_count == 0 {
            // Horn sound; the choice of sound draws a random number in San Francisco.
            if (self.rng.random16() & 3) == 1 && self.scenario == Scenario::SanFrancisco {
                self.sprite_rand(10);
            }
            self.sprites[idx].sound_count = 200;
        }

        if self.sprites[idx].count > 0 {
            self.sprites[idx].count -= 1;
        }

        if self.sprites[idx].count == 0 {
            self.sprites[idx].count = 9;

            if self.sprites[idx].frame != self.sprites[idx].new_dir {
                let s = &self.sprites[idx];
                let (frame, new_dir) = (s.frame, s.new_dir);
                self.sprites[idx].frame = self.turn_to(frame, new_dir);
                return;
            }

            let tem = self.rng.random16() & 7;
            let mut pem = tem;
            while pem < tem + 8 {
                let z = (pem & 7) + 1;

                if z != self.sprites[idx].dir {
                    let s = &self.sprites[idx];
                    let x = ((s.x + (48 - 1)) >> 4) + BDX[z as usize];
                    let y = (s.y >> 4) + BDY[z as usize];
                    let old_dir = s.dir;

                    if self.on_map(x, y) {
                        t = self.sprite_map_at(x, y) & LOMASK;

                        if t == tc::CHANNEL
                            || t == tc::BRWH
                            || t == tc::BRWV
                            || self.try_other(i32::from(t), old_dir, z)
                        {
                            let frame = self.sprites[idx].frame;
                            let new_frame = self.turn_to(frame, z);
                            let s = &mut self.sprites[idx];
                            s.new_dir = z;
                            s.frame = new_frame;
                            s.dir = z + 4;
                            if s.dir > 8 {
                                s.dir -= 8;
                            }
                            break;
                        }
                    }
                }
                pem += 1;
            }

            if pem == tem + 8 {
                let new_dir = (self.rng.random16() & 7) + 1;
                let s = &mut self.sprites[idx];
                s.dir = 10;
                s.new_dir = new_dir;
            }
        } else {
            let z = self.sprites[idx].frame;
            let s = &mut self.sprites[idx];
            if z == s.new_dir {
                s.x += BPX[z as usize];
                s.y += BPY[z as usize];
            }
        }

        if self.sprite_not_in_bounds(idx) {
            self.sprites[idx].frame = 0;
            return;
        }

        for (z, &clear) in bt_clr_tab.iter().enumerate() {
            if t == clear {
                break;
            }

            if z == 7 {
                self.explode_sprite(idx);
                let s = &self.sprites[idx];
                let (x, y) = (s.x + 48, s.y);
                self.destroy_map_tile(x, y);
            }
        }
    }

    /// Port of `doMonsterSprite`.
    ///
    /// There are 16 monster frames. Frames 1..=12 are walking frames, grouped
    /// by direction in threes; the rest are the turning frames.
    pub fn do_monster_sprite(&mut self, idx: usize) {
        const GX: [i32; 5] = [2, 2, -2, -2, 0];
        const GY: [i32; 5] = [-2, 2, 2, -2, 0];
        const ND1: [i32; 4] = [0, 1, 2, 3];
        const ND2: [i32; 4] = [1, 2, 3, 0];
        const NN1: [i32; 4] = [2, 5, 8, 11];
        const NN2: [i32; 4] = [11, 2, 5, 8];

        if self.sprites[idx].sound_count > 0 {
            self.sprites[idx].sound_count -= 1;
        }

        let mut d: i32;
        let mut z: i32;
        let mut c: i32;

        if self.sprites[idx].control < 0 {
            // Business as usual.

            if self.sprites[idx].control == -2 {
                let frame = self.sprites[idx].frame;
                d = (frame - 1) / 3;
                z = (frame - 1) % 3;

                if z == 2 {
                    self.sprites[idx].step = 0;
                }
                if z == 0 {
                    self.sprites[idx].step = 1;
                }
                if self.sprites[idx].step != 0 {
                    z += 1;
                } else {
                    z -= 1;
                }

                let (x, y, dx, dy) = {
                    let s = &self.sprites[idx];
                    (s.x, s.y, s.dest_x, s.dest_y)
                };
                c = self.get_dir(x, y, dx, dy);

                if self.abs_dist < 18 {
                    let s = &mut self.sprites[idx];
                    s.control = -1;
                    s.count = 1000;
                    s.flag = 1;
                    s.dest_x = s.orig_x;
                    s.dest_y = s.orig_y;
                } else {
                    c = (c - 1) / 2;

                    if (c != d && self.sprite_rand(5) == 0) || self.sprite_rand(20) == 0 {
                        let diff = (c - d) & 3;

                        if diff == 1 || diff == 3 {
                            d = c;
                        } else {
                            if (self.rng.random16() & 1) != 0 {
                                d += 1;
                            } else {
                                d -= 1;
                            }
                            d &= 3;
                        }
                    } else if self.sprite_rand(20) == 0 {
                        if (self.rng.random16() & 1) != 0 {
                            d += 1;
                        } else {
                            d -= 1;
                        }
                        d &= 3;
                    }
                }
            } else {
                let frame = self.sprites[idx].frame;
                d = (frame - 1) / 3;

                if d < 4 {
                    // Turn north, south, east or west.
                    z = (frame - 1) % 3;

                    if z == 2 {
                        self.sprites[idx].step = 0;
                    }
                    if z == 0 {
                        self.sprites[idx].step = 1;
                    }
                    if self.sprites[idx].step != 0 {
                        z += 1;
                    } else {
                        z -= 1;
                    }

                    let (x, y, dx, dy) = {
                        let s = &self.sprites[idx];
                        (s.x, s.y, s.dest_x, s.dest_y)
                    };
                    self.get_dir(x, y, dx, dy);

                    if self.abs_dist < 60 {
                        let s = &mut self.sprites[idx];
                        if s.flag == 0 {
                            s.flag = 1;
                            s.dest_x = s.orig_x;
                            s.dest_y = s.orig_y;
                        } else {
                            s.frame = 0;
                            return;
                        }
                    }

                    let (x, y, dx, dy) = {
                        let s = &self.sprites[idx];
                        (s.x, s.y, s.dest_x, s.dest_y)
                    };
                    c = self.get_dir(x, y, dx, dy);
                    c = (c - 1) / 2;

                    if c != d && self.sprite_rand(10) == 0 {
                        z = if (self.rng.random16() & 1) != 0 {
                            ND1[d as usize]
                        } else {
                            ND2[d as usize]
                        };

                        d = 4;

                        if self.sprites[idx].sound_count == 0 {
                            // Monster sound (front-end only).
                            self.sprites[idx].sound_count = 50 + self.sprite_rand(100);
                        }
                    }
                } else {
                    d = 4;
                    c = frame;
                    z = (c - 13) & 3;

                    if (self.rng.random16() & 3) == 0 {
                        z = if (self.rng.random16() & 1) != 0 {
                            NN1[z as usize]
                        } else {
                            NN2[z as usize]
                        };
                        d = (z - 1) / 3;
                        z = (z - 1) % 3;
                    }
                }
            }
        } else {
            // Somebody has taken control of the monster.
            d = self.sprites[idx].control;
            z = (self.sprites[idx].frame - 1) % 3;

            if z == 2 {
                self.sprites[idx].step = 0;
            }
            if z == 0 {
                self.sprites[idx].step = 1;
            }
            if self.sprites[idx].step != 0 {
                z += 1;
            } else {
                z -= 1;
            }
        }

        z = d * 3 + z + 1;
        if z > 16 {
            z = 16;
        }

        {
            let s = &mut self.sprites[idx];
            s.frame = z;
            s.x += GX[d as usize];
            s.y += GY[d as usize];
            if s.count > 0 {
                s.count -= 1;
            }
        }

        let (hx, hy) = {
            let s = &self.sprites[idx];
            (s.x + s.x_hot, s.y + s.y_hot)
        };
        c = self.get_char(hx, hy);

        {
            let s = &self.sprites[idx];
            if c == -1 || (c == i32::from(tc::RIVER) && s.count != 0 && s.control == -1) {
                self.sprites[idx].frame = 0; // Kill the scary monster.
            }
        }

        let mut cur = self.sprite_list;
        while let Some(s) = cur {
            if self.sprites[s].frame != 0
                && matches!(
                    self.sprites[s].kind,
                    SPRITE_AIRPLANE | SPRITE_HELICOPTER | SPRITE_SHIP | SPRITE_TRAIN
                )
                && self.check_sprite_collision(idx, s)
            {
                self.explode_sprite(s);
            }
            cur = self.sprites[s].next;
        }

        let (x, y) = {
            let s = &self.sprites[idx];
            (s.x, s.y)
        };
        self.destroy_map_tile(x + 48, y + 16);
    }

    /// Port of `doTornadoSprite`.
    pub fn do_tornado_sprite(&mut self, idx: usize) {
        const CDX: [i32; 6] = [2, 3, 2, 0, -2, -3];
        const CDY: [i32; 6] = [-2, 0, 2, 3, 2, 0];

        let mut z = self.sprites[idx].frame;

        if z == 2 {
            // Cycle the animation.
            z = if self.sprites[idx].flag != 0 { 3 } else { 1 };
        } else {
            self.sprites[idx].flag = if z == 1 { 1 } else { 0 };
            z = 2;
        }

        if self.sprites[idx].count > 0 {
            self.sprites[idx].count -= 1;
        }

        self.sprites[idx].frame = z;

        let mut cur = self.sprite_list;
        while let Some(s) = cur {
            if self.sprites[s].frame != 0
                && matches!(
                    self.sprites[s].kind,
                    SPRITE_AIRPLANE | SPRITE_HELICOPTER | SPRITE_SHIP | SPRITE_TRAIN
                )
                && self.check_sprite_collision(idx, s)
            {
                self.explode_sprite(s);
            }
            cur = self.sprites[s].next;
        }

        let z = self.sprite_rand(5);
        {
            let s = &mut self.sprites[idx];
            s.x += CDX[z as usize];
            s.y += CDY[z as usize];
        }

        if self.sprite_not_in_bounds(idx) {
            self.sprites[idx].frame = 0;
        }

        if self.sprites[idx].count != 0 && self.sprite_rand(500) == 0 {
            self.sprites[idx].frame = 0;
        }

        let (x, y) = {
            let s = &self.sprites[idx];
            (s.x + 48, s.y + 40)
        };
        self.destroy_map_tile(x, y);
    }

    /// Port of `doExplosionSprite`: the 'move' of a fire sprite.
    pub fn do_explosion_sprite(&mut self, idx: usize) {
        if (self.sprite_cycle & 1) == 0 {
            if self.sprites[idx].frame == 1 {
                // Explosion sound (front-end only).
                let s = &self.sprites[idx];
                let x = (s.x >> 4) + 3;
                let y = s.y >> 4;
                self.sprite_message(MESSAGE_EXPLOSION_REPORTED, x, y, false, false);
            }

            self.sprites[idx].frame += 1;
        }

        if self.sprites[idx].frame > 6 {
            let s = &mut self.sprites[idx];
            s.frame = 0;
            let (x, y) = (s.x, s.y);

            self.start_fire(x + 48 - 8, y + 16);
            self.start_fire(x + 48 - 24, y);
            self.start_fire(x + 48 + 8, y);
            self.start_fire(x + 48 - 24, y + 32);
            self.start_fire(x + 48 + 8, y + 32);
        }
    }

    /// Port of `doBusSprite`.
    pub fn do_bus_sprite(&mut self, idx: usize) {
        const DX: [i32; 5] = [0, 1, 0, -1, 0];
        const DY: [i32; 5] = [-1, 0, 1, 0, 0];
        const DIR2FRAME: [i32; 4] = [1, 2, 1, 2];
        const AHEAD: i32 = 8;

        let mut turned = false;
        let mut speed = 0;

        if self.sprites[idx].turn != 0 {
            let s = &mut self.sprites[idx];
            if s.turn < 0 {
                // Counter-clockwise.
                s.frame = if (s.dir & 1) != 0 { 4 } else { 3 };
                s.turn += 1;
                s.dir = (s.dir - 1) & 3;
            } else {
                // Clockwise.
                s.frame = if (s.dir & 1) != 0 { 3 } else { 4 };
                s.turn -= 1;
                s.dir = (s.dir + 1) & 3;
            }
            turned = true;
        } else if self.sprites[idx].frame == 3 || self.sprites[idx].frame == 4 {
            // Finish the turn.
            turned = true;
            let s = &mut self.sprites[idx];
            s.frame = DIR2FRAME[s.dir as usize];
        }

        let (world_w, world_h) = self.world_size();
        let mut dx: i32;
        let mut dy: i32;

        if self.sprites[idx].speed == 0 {
            // Brake.
            dx = 0;
            dy = 0;
        } else {
            // Cruise at traffic speed.
            let (sx, sy, xh, yh) = {
                let s = &self.sprites[idx];
                (s.x, s.y, s.x_hot, s.y_hot)
            };
            let mut tx = (sx + xh) >> 5;
            let mut ty = (sy + yh) >> 5;

            let mut z: i32 = if tx >= 0 && tx < world_w / 2 && ty >= 0 && ty < world_h / 2 {
                let mut z = i32::from(self.traffic_density_map.world_get(tx << 1, ty << 1)) >> 6;
                if z > 1 {
                    z -= 1;
                }
                z
            } else {
                0
            };

            speed = match z {
                0 => 8,
                1 => 4,
                2 => 1,
                _ => 0,
            };
            // Govern the speed.
            let cruise = self.sprites[idx].speed;
            if speed > cruise {
                speed = cruise;
            }

            let dir = self.sprites[idx].dir;
            if turned {
                if speed > 1 {
                    speed = 1;
                }
                dx = DX[dir as usize] * speed;
                dy = DY[dir as usize] * speed;
            } else {
                dx = DX[dir as usize] * speed;
                dy = DY[dir as usize] * speed;

                tx = (sx + xh) >> 4;
                ty = (sy + yh) >> 4;

                // Drift into the right lane.
                match dir {
                    0 => {
                        // Up.
                        z = ((tx << 4) + 4) - (sx + xh);
                        if z < 0 {
                            dx = -1;
                        } else if z > 0 {
                            dx = 1;
                        }
                    }
                    1 => {
                        // Right.
                        z = ((ty << 4) + 4) - (sy + yh);
                        if z < 0 {
                            dy = -1;
                        } else if z > 0 {
                            dy = 1;
                        }
                    }
                    2 => {
                        // Down.
                        z = (tx << 4) - (sx + xh);
                        if z < 0 {
                            dx = -1;
                        } else if z > 0 {
                            dx = 1;
                        }
                    }
                    _ => {
                        // Left.
                        z = (ty << 4) - (sy + yh);
                        if z < 0 {
                            dy = -1;
                        } else if z > 0 {
                            dy = 1;
                        }
                    }
                }
            }
        }

        let (sx, sy, xh, yh, dir) = {
            let s = &self.sprites[idx];
            (s.x, s.y, s.x_hot, s.y_hot, s.dir)
        };

        let otx = ((sx + xh + DX[dir as usize] * AHEAD) >> 4).clamp(0, world_w - 1);
        let oty = ((sy + yh + DY[dir as usize] * AHEAD) >> 4).clamp(0, world_h - 1);

        let tx = ((sx + xh + dx + DX[dir as usize] * AHEAD) >> 4).clamp(0, world_w - 1);
        let ty = ((sy + yh + dy + DY[dir as usize] * AHEAD) >> 4).clamp(0, world_h - 1);

        if tx != otx || ty != oty {
            let z = self.can_drive_on(tx, ty);

            if z == 0 {
                // Can't drive forward into a new tile.
                if speed == 8 {
                    self.bulldozer_tool(tx, ty);
                }
            } else if z < 0 {
                // Bumpy.
                dx /= 2;
                dy /= 2;
            }
        }

        {
            let s = &mut self.sprites[idx];
            s.x += dx;
            s.y += dy;
        }

        if self.enable_disasters {
            let mut explode = false;
            let mut cur = self.sprite_list;
            while let Some(s) = cur {
                if idx != s
                    && self.sprites[s].frame != 0
                    && (self.sprites[s].kind == SPRITE_BUS
                        || (self.sprites[s].kind == SPRITE_TRAIN && self.sprites[s].frame != 5))
                    && self.check_sprite_collision(idx, s)
                {
                    self.explode_sprite(s);
                    explode = true;
                }
                cur = self.sprites[s].next;
            }

            if explode {
                self.explode_sprite(idx);
            }
        }
    }

    /// Port of `canDriveOn`: 0 if not, 1 if smooth road, -1 if bumpy (dirt or
    /// a tally-able tile).
    pub fn can_drive_on(&self, x: i32, y: i32) -> i32 {
        if !self.on_map(x, y) {
            return 0;
        }

        let tile = self.sprite_map_at(x, y) & LOMASK;

        if ((tc::ROADBASE..=tc::LASTROAD).contains(&tile) && tile != tc::BRWH && tile != tc::BRWV)
            || tile == tc::HRAILROAD
            || tile == tc::VRAILROAD
        {
            return 1;
        }

        if tile == tc::DIRT || self.tally(i32::from(tile)) {
            return -1;
        }

        0
    }

    /// Port of `explodeSprite`: the sprite is destroyed and an explosion is made.
    pub fn explode_sprite(&mut self, idx: usize) {
        self.sprites[idx].frame = 0;

        let kind = self.sprites[idx].kind;
        let x = self.sprites[idx].x + self.sprites[idx].x_hot;
        let y = self.sprites[idx].y + self.sprites[idx].y_hot;
        self.make_explosion_at(x, y);

        let x = x >> 4;
        let y = y >> 4;

        match kind {
            SPRITE_AIRPLANE => self.sprite_message(MESSAGE_PLANE_CRASHED, x, y, true, false),
            SPRITE_SHIP => self.sprite_message(MESSAGE_SHIP_CRASHED, x, y, true, false),
            SPRITE_TRAIN => self.sprite_message(MESSAGE_TRAIN_CRASHED, x, y, true, false),
            SPRITE_HELICOPTER => self.sprite_message(MESSAGE_HELICOPTER_CRASHED, x, y, true, false),
            // XXX for now: a bus reports a train crash.
            SPRITE_BUS => self.sprite_message(MESSAGE_TRAIN_CRASHED, x, y, true, false),
            _ => {}
        }
        // The explosion sound is front-end only.
    }

    /// Port of `checkWet`: tiles that a burning explosion turns to river.
    pub fn check_wet(&self, x: Tile) -> bool {
        x == tc::HPOWER
            || x == tc::VPOWER
            || x == tc::HRAIL
            || x == tc::VRAIL
            || x == tc::BRWH
            || x == tc::BRWV
    }

    /// Port of `destroyMapTile`: a pixel position is blown up.
    pub fn destroy_map_tile(&mut self, ox: i32, oy: i32) {
        let x = ox >> 4;
        let y = oy >> 4;

        if !self.on_map(x, y) {
            return;
        }

        let z = self.sprite_map_at(x, y);
        let t = z & LOMASK;

        if t >= tc::TREEBASE {
            if (z & BURNBIT) == 0 {
                if (tc::ROADBASE..=tc::LASTROAD).contains(&t) {
                    self.set_tile(x, y, tc::RIVER);
                }
                return;
            }

            if (z & ZONEBIT) != 0 {
                self.start_fire_in_zone(x, y, z);

                if t > tc::RZB {
                    self.make_explosion_at(ox, oy);
                }
            }

            if self.check_wet(t) {
                self.set_tile(x, y, tc::RIVER);
            } else {
                let tiny = if self.do_animation {
                    tc::TINYEXP
                } else {
                    tc::LASTTINYEXP - 3
                };
                self.set_tile(x, y, tiny | BULLBIT | ANIMBIT);
            }
        }
    }

    /// Port of `startFireInZone`: a zone is burning, so its neighbourhood catches fire.
    pub fn start_fire_in_zone(&mut self, xloc: i32, yloc: i32, ch: Tile) {
        let value = i32::from(self.rate_of_growth_map.world_get(xloc, yloc));
        let value = (value - 20).clamp(-200, 200);
        self.rate_of_growth_map.world_set(xloc, yloc, value as i16);

        let ch = ch & LOMASK;

        let xy_max = if ch < tc::PORTBASE {
            2
        } else if ch == tc::AIRPORT {
            5
        } else {
            4
        };

        for x in -1..xy_max {
            for y in -1..xy_max {
                let xtem = xloc + x;
                let ytem = yloc + y;

                if self.on_map(xtem, ytem)
                    && (self.sprite_map_at(xtem, ytem) & LOMASK) >= tc::ROADBASE
                {
                    let v = self.sprite_map_at(xtem, ytem) | BULLBIT;
                    self.set_tile(xtem, ytem, v);
                }
            }
        }
    }

    /// Port of `startFire`: start a fire at a pixel position.
    pub fn start_fire(&mut self, x: i32, y: i32) {
        let x = x >> 4;
        let y = y >> 4;

        if !self.on_map(x, y) {
            return;
        }

        let z = self.sprite_map_at(x, y);
        let t = z & LOMASK;

        if (z & BURNBIT) == 0 && t != tc::DIRT {
            return;
        }

        if (z & ZONEBIT) != 0 {
            return;
        }

        let fire = self.random_fire_tile();
        self.set_tile(x, y, fire);
    }

    /// Port of the header inline `randomFire`: an animated fire tile.
    fn random_fire_tile(&mut self) -> Tile {
        (tc::FIRE + (self.rng.random16() & 7) as u16) | ANIMBIT
    }

    /// Port of `generateTrain`.
    pub fn generate_train(&mut self, x: i32, y: i32) {
        if i32::from(self.total_pop) > 20
            && self.get_sprite(SPRITE_TRAIN).is_none()
            && self.sprite_rand(25) == 0
        {
            self.make_sprite(
                SPRITE_TRAIN,
                (x << 4) + TRA_GROOVE_X,
                (y << 4) + TRA_GROOVE_Y,
            );
        }
    }

    /// Port of `generateBus`.
    pub fn generate_bus(&mut self, x: i32, y: i32) {
        if self.get_sprite(SPRITE_BUS).is_none() && self.sprite_rand(25) == 0 {
            self.make_sprite(SPRITE_BUS, (x << 4) + BUS_GROOVE_X, (y << 4) + BUS_GROOVE_Y);
        }
    }

    /// Port of `generateShip`: try to construct a new ship on a channel edge.
    pub fn generate_ship(&mut self) {
        let (world_w, world_h) = self.world_size();

        if (self.rng.random16() & 3) == 0 {
            for x in 4..world_w - 2 {
                if self.sprite_map_at(x, 0) == tc::CHANNEL {
                    self.make_ship_here(x, 0);
                    return;
                }
            }
        }

        if (self.rng.random16() & 3) == 0 {
            for y in 1..world_h - 2 {
                if self.sprite_map_at(0, y) == tc::CHANNEL {
                    self.make_ship_here(0, y);
                    return;
                }
            }
        }

        if (self.rng.random16() & 3) == 0 {
            for x in 4..world_w - 2 {
                if self.sprite_map_at(x, world_h - 1) == tc::CHANNEL {
                    self.make_ship_here(x, world_h - 1);
                    return;
                }
            }
        }

        if (self.rng.random16() & 3) == 0 {
            for y in 1..world_h - 2 {
                if self.sprite_map_at(world_w - 1, y) == tc::CHANNEL {
                    self.make_ship_here(world_w - 1, y);
                    return;
                }
            }
        }
    }

    /// Port of `makeShipHere`.
    pub fn make_ship_here(&mut self, x: i32, y: i32) {
        self.make_sprite(SPRITE_SHIP, (x << 4) - (48 - 1), y << 4);
    }

    /// Port of `makeMonster`: re-arm the monster, or start one on a river tile.
    pub fn make_monster(&mut self) {
        if let Some(s) = self.get_sprite(SPRITE_MONSTER) {
            let dest_x = i32::from(self.pollution_max_x) << 4;
            let dest_y = i32::from(self.pollution_max_y) << 4;
            let s = &mut self.sprites[s];
            s.sound_count = 1;
            s.count = 1000;
            s.dest_x = dest_x;
            s.dest_y = dest_y;
            return;
        }

        let (world_w, world_h) = self.world_size();
        let mut done = false;

        for _ in 0..300 {
            let x = self.sprite_rand(world_w - 20) + 10;
            let y = self.sprite_rand(world_h - 10) + 5;

            let t = self.sprite_map_at(x, y);
            if t == tc::RIVER || t == tc::RIVER + BULLBIT {
                self.make_monster_at(x, y);
                done = true;
                break;
            }
        }

        if !done {
            self.make_monster_at(60, 50);
        }
    }

    /// Port of `makeMonsterAt`.
    pub fn make_monster_at(&mut self, x: i32, y: i32) {
        self.make_sprite(SPRITE_MONSTER, (x << 4) + 48, y << 4);
        self.sprite_message(MESSAGE_MONSTER_SIGHTED, x + 5, y, true, true);
    }

    /// Port of `generateCopter`: ensure a helicopter exists.
    pub fn generate_copter(&mut self, pos: Position) {
        if self.get_sprite(SPRITE_HELICOPTER).is_some() {
            return;
        }
        self.make_sprite(SPRITE_HELICOPTER, pos.x << 4, (pos.y << 4) + 30);
    }

    /// Port of `generatePlane`: ensure an airplane exists.
    pub fn generate_plane(&mut self, pos: Position) {
        if self.get_sprite(SPRITE_AIRPLANE).is_some() {
            return;
        }
        self.make_sprite(SPRITE_AIRPLANE, (pos.x << 4) + 48, (pos.y << 4) + 12);
    }

    /// Port of `makeTornado`: ensure a tornado exists.
    pub fn make_tornado(&mut self) {
        if let Some(s) = self.get_sprite(SPRITE_TORNADO) {
            self.sprites[s].count = 200;
            return;
        }

        let (world_w, world_h) = self.world_size();
        let x = self.sprite_rand((world_w << 4) - 800) + 400;
        let y = self.sprite_rand((world_h << 4) - 200) + 100;

        self.make_sprite(SPRITE_TORNADO, x, y);
        self.sprite_message(
            MESSAGE_TORNADO_SIGHTED,
            (x >> 4) + 3,
            (y >> 4) + 2,
            true,
            true,
        );
    }

    /// Port of `makeExplosion`: an explosion at a map tile.
    pub fn make_explosion(&mut self, x: i32, y: i32) {
        if self.on_map(x, y) {
            self.make_explosion_at((x << 4) + 8, (y << 4) + 8);
        }
    }

    /// Port of `makeExplosionAt`: an explosion at a pixel position.
    pub fn make_explosion_at(&mut self, x: i32, y: i32) {
        self.new_sprite(SPRITE_EXPLOSION, x - 40, y - 16);
    }

    /// Port of `getRandom`: the argument is converted to `short` as in C++.
    fn sprite_rand(&mut self, range: i32) -> i32 {
        i32::from(self.rng.random(range as i16))
    }

    /// Map tile at a position that the caller has already checked is on the map.
    fn sprite_map_at(&self, x: i32, y: i32) -> Tile {
        self.tile(x, y).expect("sprite code read an off-map tile")
    }
}
