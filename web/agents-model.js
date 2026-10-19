// Pure model of the «Circulation simulée» panel (docs/game-design-v03.md). The engine gives the
// switch and five numbers (City.agent_rules, set_agent_rules, agent_stats); the French texts and the
// number formatting live here. No DOM, no engine access: node --test checks it alone
// (web/test/agents-model.test.mjs).

/** Engine method names the panel needs; a build without them keeps the panel hidden. */
export const REQUIRED = ["agent_rules", "set_agent_rules", "agent_stats"];

/** Records of agent_stats: the engine's Int32Array, in this order. */
export const STATS_LEN = 5;

export const TITLE = "Circulation simulée";
export const SWITCH_LABEL = "Activer la circulation simulée";
export const NOTE =
  "Des voitures roulent sur les routes entre les quartiers résidentiels et les zones d'emploi ; les bouchons apparaissent là où le réseau est saturé.";

/** Whether `city` has the agents API the panel uses. */
export function supports(city) {
  return REQUIRED.every((m) => typeof city?.[m] === "function");
}

const int = (v) => Number(v) | 0;

/**
 * agent_stats() as a named record. A missing or short array gives zeros for the missing values.
 * [active_cars, finished_trips, mean_trip_ticks, saturated_tiles, motorised_residents]
 */
export function decodeStats(arr) {
  const a = arr ?? [];
  return {
    activeCars: int(a[0]),
    finishedTrips: int(a[1]),
    meanTripTicks: int(a[2]),
    saturatedTiles: int(a[3]),
    motorisedResidents: int(a[4]),
  };
}

/** A French-grouped number: 1234 -> "1 234" (the locale's own grouping). */
export function formatCount(n) {
  return int(n).toLocaleString("fr-FR");
}

/** The stats list shown while the rule is on: [[label, value], ...] in the panel's order. */
export function statsLines(stats) {
  const s = stats ?? decodeStats();
  return [
    ["Voitures en route", formatCount(s.activeCars)],
    ["Trajets terminés", formatCount(s.finishedTrips)],
    ["Durée moyenne d'un trajet", `${formatCount(s.meanTripTicks)} pas`],
    ["Tuiles saturées", formatCount(s.saturatedTiles)],
    ["Habitants motorisés", formatCount(s.motorisedResidents)],
  ];
}

/** Records of transport_stats (the buses and taxis of docs/game-design-v05.md), in this order. */
export const TRANSPORT_LEN = 6;

/** Whether `city` has transport_stats(); a build without it simply has no transport rows. */
export function supportsTransport(city) {
  return typeof city?.transport_stats === "function";
}

/**
 * transport_stats() as a named record. A missing or short array gives zeros for the missing values.
 * [buses, taxis, waiting, bus_trips_month, taxi_rides_month, income_month]
 */
export function decodeTransport(arr) {
  const a = arr ?? [];
  return {
    buses: int(a[0]),
    taxis: int(a[1]),
    waiting: int(a[2]),
    busTrips: int(a[3]),
    taxiRides: int(a[4]),
    income: int(a[5]),
  };
}

/** The transport rows shown after the traffic rows: [[label, value], ...]. The income is in dollars. */
export function transportLines(t) {
  const s = t ?? decodeTransport();
  return [
    ["Bus en service", formatCount(s.buses)],
    ["Taxis en service", formatCount(s.taxis)],
    ["Voyageurs en attente", formatCount(s.waiting)],
    ["Voyages en bus ce mois", formatCount(s.busTrips)],
    ["Courses de taxi ce mois", formatCount(s.taxiRides)],
    ["Recettes des transports", `${formatCount(s.income)} $`],
  ];
}

/** Records of rail_stats (the trains and metro of docs/game-design-v06.md), in this order. */
export const RAIL_LEN = 7;

/** Whether `city` has rail_stats(); a build without it simply has no rail rows. */
export function supportsRail(city) {
  return typeof city?.rail_stats === "function";
}

/**
 * rail_stats() as a named record. A missing or short array gives zeros for the missing values.
 * [trains, rames, train_riders_month, metro_riders_month, rail_income_month, train_lines, metro_lines]
 */
export function decodeRail(arr) {
  const a = arr ?? [];
  return {
    trains: int(a[0]),
    rames: int(a[1]),
    trainRiders: int(a[2]),
    metroRiders: int(a[3]),
    railIncome: int(a[4]),
    trainLines: int(a[5]),
    metroLines: int(a[6]),
  };
}

/** The rail rows shown after the transport rows: [[label, value], ...]. The income is in dollars. */
export function railLines(r) {
  const s = r ?? decodeRail();
  return [
    ["Trains", formatCount(s.trains)],
    ["Rames de métro", formatCount(s.rames)],
    ["Voyageurs en train ce mois", formatCount(s.trainRiders)],
    ["Voyageurs en métro ce mois", formatCount(s.metroRiders)],
    ["Recettes du rail", `${formatCount(s.railIncome)} $`],
  ];
}

/** The state under the switch. */
export function stateText(on) {
  return on
    ? "Activée : les voitures roulent sur les routes."
    : "Désactivée : aucune voiture ne circule.";
}
