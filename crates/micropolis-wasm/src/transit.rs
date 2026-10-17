//! wasm adapter: The metro (docs/game-design-v02.md): stations and tunnels; the rules live in
//! micropolis_core::transit (translation only, ARCHITECTURE.md rule 4).

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Whether the metro rules are on (off by default: the engine then equals the original).
    pub fn transit_rules(&self) -> bool {
        self.sim.transit_rules()
    }

    /// Turns the metro rules on or off.
    pub fn set_transit_rules(&mut self, on: bool) {
        self.sim.set_transit_rules(on);
    }

    /// Digs a tunnel tile at `(x, y)`. Returns the tool result code (as `tool_down`): refused
    /// (`0`) with the rules off, under water, off the map or on an existing tunnel or station.
    pub fn place_tunnel(&mut self, x: i32, y: i32) -> i32 {
        self.sim.place_tunnel(x, y) as i32
    }

    /// `[result, cost]` of what `place_tunnel` would do, without changing the city.
    pub fn tunnel_preview(&self, x: i32, y: i32) -> Vec<i32> {
        let p = self.sim.tunnel_preview(x, y);
        vec![p.result as i32, p.cost]
    }

    /// Fills in the tunnel tile at `(x, y)` (free). `0` unless a tunnel is there.
    pub fn remove_tunnel(&mut self, x: i32, y: i32) -> i32 {
        self.sim.remove_tunnel(x, y) as i32
    }

    /// Builds a station at `(x, y)` (the surface tile is unchanged). Tool result code.
    pub fn place_station(&mut self, x: i32, y: i32) -> i32 {
        self.sim.place_station(x, y) as i32
    }

    /// `[result, cost]` of what `place_station` would do, without changing the city.
    pub fn station_preview(&self, x: i32, y: i32) -> Vec<i32> {
        let p = self.sim.station_preview(x, y);
        vec![p.result as i32, p.cost]
    }

    /// Removes the station at `(x, y)` (free). `0` unless a station is there.
    pub fn remove_station(&mut self, x: i32, y: i32) -> i32 {
        self.sim.remove_station(x, y) as i32
    }

    /// The network of every tile, `width * height` values in the order of `tiles()` (column-major,
    /// index `x * height + y`): 0 nothing, 1 tunnel, 2 tunnel on a working line, 3 station,
    /// 4 station on a working line.
    pub fn transit_layer(&self) -> Vec<u8> {
        self.sim.transit_layer()
    }

    /// The constants of the metro rules, so that the page shows the engine's numbers:
    /// `[tunnel cost, station cost, station radius in tiles, traffic cut in percent, land value
    /// bonus, most stations]`.
    pub fn transit_params(&self) -> Vec<i32> {
        use micropolis_core::transit as t;
        vec![
            t::TUNNEL_COST,
            t::STATION_COST,
            t::STATION_RADIUS,
            t::TRAFFIC_CUT_PCT,
            t::LAND_BONUS,
            t::MAX_STATIONS as i32,
        ]
    }

    /// `[stations, tunnels, lines, covered tiles]`: lines are connected sets with at least two
    /// stations; covered tiles lie within reach of a station of such a line.
    pub fn transit_stats(&self) -> Vec<i32> {
        let s = self.sim.transit_stats();
        vec![s.stations, s.tunnels, s.lines, s.covered_tiles]
    }
}

#[cfg(test)]
mod tests {
    use crate::sizes::new_sized_city;

    #[test]
    fn the_adapter_translates_the_core() {
        let mut city = new_sized_city(80, 67, 4).expect("valid size");
        assert!(!city.transit_rules());
        assert_eq!(city.place_tunnel(5, 5), 0, "refused with the rules off");
        assert_eq!(city.tunnel_preview(5, 5), vec![0, 0]);
        city.set_transit_rules(true);
        assert!(city.transit_rules());
        let layer = city.transit_layer();
        assert_eq!(layer.len(), city.tiles().len());
        assert_eq!(city.transit_stats(), vec![0, 0, 0, 0]);
    }
}
