//! The treatment capacities of a month, as pure arithmetic: what burns, what is buried, what is
//! sent away.

/// What the buildings can still take this month.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pool {
    /// Units the incinerators can still burn.
    burn: i64,
    /// Units the waste-to-energy plants can still burn.
    energy: i64,
    /// Room left in each landfill, in list order.
    rooms: Vec<i64>,
    /// Units burned by the incinerators so far.
    pub burned: i64,
    /// Units burned by the waste-to-energy plants so far.
    pub energised: i64,
    /// Units buried so far in each landfill.
    pub buried: Vec<i64>,
}

impl Pool {
    pub fn new(burn: i64, energy: i64, rooms: Vec<i64>) -> Pool {
        let buried = vec![0; rooms.len()];
        Pool {
            burn,
            energy,
            rooms,
            burned: 0,
            energised: 0,
            buried,
        }
    }

    /// Whether nothing more can be taken.
    pub fn is_exhausted(&self) -> bool {
        self.burn == 0 && self.energy == 0 && self.rooms.iter().all(|&r| r == 0)
    }

    /// Treats up to `want` units in the order incinerators, waste-to-energy plants, landfills;
    /// returns the units taken.
    pub fn absorb(&mut self, want: i64) -> i64 {
        let mut left = want.max(0);
        let from_burn = left.min(self.burn);
        self.burn -= from_burn;
        self.burned += from_burn;
        left -= from_burn;
        let from_energy = left.min(self.energy);
        self.energy -= from_energy;
        self.energised += from_energy;
        left -= from_energy;
        for (room, buried) in self.rooms.iter_mut().zip(self.buried.iter_mut()) {
            let put = left.min(*room);
            *room -= put;
            *buried += put;
            left -= put;
        }
        want.max(0) - left
    }

    /// Units treated so far.
    pub fn treated(&self) -> i64 {
        self.burned + self.energised + self.buried.iter().sum::<i64>()
    }
}

/// Sends away up to `want` units under the deals `(amount, price)` in order: each takes at most
/// its amount. Returns `(units exported, dollars to pay)`.
pub fn export(want: i64, deals: &[(i64, i64)]) -> (i64, i64) {
    let mut left = want.max(0);
    let mut cost = 0;
    for &(amount, price) in deals {
        let sent = left.min(amount);
        left -= sent;
        cost += sent * price;
    }
    (want.max(0) - left, cost)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units_go_to_incinerators_then_plants_then_landfills_in_order() {
        let mut p = Pool::new(10, 20, vec![5, 100]);
        assert_eq!(p.absorb(8), 8);
        assert_eq!((p.burned, p.energised, p.buried.clone()), (8, 0, vec![0, 0]));
        assert_eq!(p.absorb(30), 30);
        assert_eq!((p.burned, p.energised), (10, 20));
        assert_eq!(p.buried, vec![5, 3]);
        assert_eq!(p.absorb(8), 8);
        assert_eq!(p.buried, vec![5, 11]);
        assert_eq!(p.treated(), 10 + 20 + 16);
    }

    #[test]
    fn a_full_pool_takes_nothing_more() {
        let mut p = Pool::new(1, 1, vec![1]);
        assert!(!p.is_exhausted());
        assert_eq!(p.absorb(10), 3);
        assert!(p.is_exhausted());
        assert_eq!(p.absorb(10), 0);
        assert_eq!(p.absorb(-4), 0);
        assert!(Pool::new(0, 0, vec![]).is_exhausted());
    }

    #[test]
    fn exports_take_at_most_their_amount_and_are_paid_per_unit() {
        assert_eq!(export(100, &[]), (0, 0));
        assert_eq!(export(100, &[(40, 3), (30, 2)]), (70, 180));
        assert_eq!(export(50, &[(40, 3), (30, 2)]), (50, 140));
        assert_eq!(export(0, &[(40, 3)]), (0, 0));
        assert_eq!(export(-5, &[(40, 3)]), (0, 0));
    }
}
