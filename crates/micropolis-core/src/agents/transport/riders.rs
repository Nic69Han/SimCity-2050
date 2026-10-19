//! The riders (non-motorised residents on a trip) and what the transport counts about them.
//! Every rider created ends in exactly one place: waiting (at a stop or for a taxi), on board,
//! arrived or abandoned; [`Audit::balanced`] states it.

/// A resident going from a home zone to a job zone by bus, taxi, train or metro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rider {
    pub id: u32,
    /// Tile index of the centre of the home zone.
    pub home: u32,
    /// Tile index of the centre of the job zone.
    pub job: u32,
    /// Identity ([`Site::id`](super::net::Site)) of the stop where a bus rider gets off; 0 and
    /// unused for a taxi rider.
    pub stop: u32,
    /// Transport tick at which the rider was created (waiting is timed from then).
    pub born: u64,
    /// Taxi dispatches that found no path.
    pub failed: u32,
}

/// What the transport did so far. The `month_*` fields are paid and reset by the monthly balance.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TransportCounters {
    /// Riders created.
    pub created: u64,
    /// Riders who reached their job zone, by bus, taxi, train or metro.
    pub arrived: u64,
    /// Riders who gave up: waited too long, their stop, depot, road or zone vanished, too many
    /// failed taxi dispatches.
    pub abandoned: u64,
    /// Trips not created because a cap was reached ([`MAX_RIDERS`](super::MAX_RIDERS), the
    /// zone's share, a full stop, the taxi queue).
    pub refused: u64,
    /// Bus riders arrived / taxi rides finished, all time.
    pub bus_trips: u64,
    pub taxi_rides: u64,
    /// This month: bus riders arrived, taxi rides finished, dollars of fares.
    pub month_bus_trips: i32,
    pub month_taxi_rides: i32,
    pub month_income: i32,
    /// Train and metro riders arrived, all time.
    pub train_trips: u64,
    pub metro_trips: u64,
    /// This month: train riders, metro riders, dollars of rail fares (kept apart from
    /// `month_income`, which `transport_stats` reports for the buses and taxis).
    pub month_train_trips: i32,
    pub month_metro_trips: i32,
    pub month_rail_income: i32,
    /// Times the routes were rebuilt.
    pub rebuilds: u64,
    /// Path searches of the last tick (bounded by `MAX_TRANSPORT_SEARCHES_PER_TICK`).
    pub searches_in_last_tick: usize,
    pub max_searches_in_tick: usize,
}

/// Where the riders are right now, counted from the containers themselves.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Audit {
    pub waiting: usize,
    pub on_board: usize,
    pub arrived: u64,
    pub abandoned: u64,
    pub created: u64,
}

impl Audit {
    /// The conservation law: created = waiting + on board + arrived + abandoned.
    pub fn balanced(&self) -> bool {
        self.created == self.waiting as u64 + self.on_board as u64 + self.arrived + self.abandoned
    }
}

impl TransportCounters {
    /// A bus rider arrived and paid `fare`.
    pub fn bus_arrival(&mut self, fare: i32) {
        self.arrived += 1;
        self.bus_trips += 1;
        self.month_bus_trips = self.month_bus_trips.saturating_add(1);
        self.month_income = self.month_income.saturating_add(fare);
    }

    /// A taxi ride ended and paid `fare`.
    pub fn taxi_arrival(&mut self, fare: i32) {
        self.arrived += 1;
        self.taxi_rides += 1;
        self.month_taxi_rides = self.month_taxi_rides.saturating_add(1);
        self.month_income = self.month_income.saturating_add(fare);
    }

    /// A train rider arrived and paid `fare`.
    pub fn train_arrival(&mut self, fare: i32) {
        self.arrived += 1;
        self.train_trips += 1;
        self.month_train_trips = self.month_train_trips.saturating_add(1);
        self.month_rail_income = self.month_rail_income.saturating_add(fare);
    }

    /// A metro rider arrived and paid `fare`.
    pub fn metro_arrival(&mut self, fare: i32) {
        self.arrived += 1;
        self.metro_trips += 1;
        self.month_metro_trips = self.month_metro_trips.saturating_add(1);
        self.month_rail_income = self.month_rail_income.saturating_add(fare);
    }

    /// Pays the month: the fares of the month (road and rail), which restart from zero with
    /// the other monthly counts.
    pub fn take_month(&mut self) -> i32 {
        let income = self.month_income.saturating_add(self.month_rail_income);
        self.month_income = 0;
        self.month_rail_income = 0;
        self.month_train_trips = 0;
        self.month_metro_trips = 0;
        self.month_bus_trips = 0;
        self.month_taxi_rides = 0;
        income
    }
}
