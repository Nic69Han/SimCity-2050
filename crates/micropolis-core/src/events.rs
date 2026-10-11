//! Outgoing port. The C++ engine notifies its front-end through
//! `callback("name", "params", ...)`; here the core appends [`Event`]s to a
//! queue and the adapter drains it (`Simulation::drain_events`). The core never
//! calls the outside world.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// A city was loaded or created: redraw everything.
    NewCity,
    /// Funds changed (`updateFunds`).
    FundsChanged(i64),
    /// Speed, tax or option flags changed (`mustUpdateOptions`).
    OptionsChanged,
    /// A front-end display (`callback("update", "s", ...)`) is out of date.
    Updated(Update),
    /// The player starts a new game (`doNewGame`).
    NewGame,
    /// A message for the player (`sendMessage`): `number` is a
    /// `MESSAGE_*` value from `message.rs`, `(x, y)` a tile or -1.
    Message {
        number: i16,
        x: i16,
        y: i16,
        picture: bool,
        important: bool,
    },
    /// A sound to play (`makeSound`, only when sound is enabled). `x`/`y` are
    /// tile coordinates or -1 for everywhere.
    Sound {
        channel: &'static str,
        sound: &'static str,
        x: i32,
        y: i32,
    },
    /// The front-end should scroll to a position (`doAutoGoto`).
    AutoGoto { x: i16, y: i16 },
    /// Shake the map (`doEarthquake`), with the given strength.
    StartEarthquake(i32),
    /// The scenario was won (`doWinGame`).
    WinGame,
    /// The scenario was lost (`doLoseGame`).
    LoseGame,
}

/// Which front-end display an [`Event::Updated`] refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Update {
    /// The map changed (`invalidateMaps`).
    Map,
    /// The graphs changed (`graphDoer`).
    History,
    /// The date changed (`updateDate`).
    Date,
    /// The R/C/I demand changed (`setDemand`).
    Demand,
    /// Pause state changed (`pause` / `resume`).
    Paused,
    /// Simulation speed changed (`setSpeed`).
    Speed,
    /// Number of passes per tick changed (`setPasses`).
    Passes,
    /// Game level changed (`setGameLevel`).
    GameLevel,
    /// City name changed (`setCleanCityName`).
    CityName,
}
