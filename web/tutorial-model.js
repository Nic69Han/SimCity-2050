// Guided first steps, pure part (docs/game-design.md, workstream "Tutoriel"): the seven steps, their
// checks on the real state of the city, the progress rule and the record kept per browser. No DOM,
// no engine call: web/tutorial.js reads the engine and hands it a snapshot.
//
// A snapshot: { tiles, width, height, population, monthsElapsed }
//   tiles          raw tile words of tiles(), column-major (index x * height + y), status bits included
//   width, height  the map size (neighbours are found from them)
//   population     population()
//   monthsElapsed  months of game time since the guide started this game (year * 12 + month, from the engine)
import { roadMask, zonePiece } from "./tiles.js";
import { tileEntry } from "./palette.js";

export const POWER_BIT = 0x8000; // tile.rs PWRBIT: the tile has power (bit of the raw tile word)
export const POPULATION_GOAL = 500;

// Zone family of tiles.js (zonePiece) -> zone. Empty zones and the buildings of each zone.
const ZONE_OF_FAMILY = Object.freeze({
  "res-empty": "residential", house: "residential", res: "residential",
  "com-empty": "commercial", com: "commercial",
  "ind-empty": "industrial", ind: "industrial",
});

/** "residential" | "commercial" | "industrial" for a zone tile (empty or built), else null. */
export function zoneOf(tile) {
  const piece = zonePiece(tile);
  return piece ? (ZONE_OF_FAMILY[piece.family] ?? null) : null;
}

const isResidential = (tile) => zoneOf(tile) === "residential";
const isPowerLine = (tile) => tileEntry(tile)?.label === "Ligne électrique";
const isPowerPlant = (tile) => tileEntry(tile)?.label.startsWith("Centrale") === true;

/** True when some tile satisfies `test`. One pass over the array, stops at the first hit. */
function anyTile(tiles, test) {
  for (let i = 0; i < tiles.length; i++) {
    if (test(tiles[i])) return true;
  }
  return false;
}

// Step 1: a residential zone is placed (empty or built).
function residentialZone(s) {
  return anyTile(s.tiles, isResidential);
}

// Step 2: a road touches a residential zone (one of the four sides of a tile).
function roadNextToResidence(s) {
  const { tiles, width, height } = s;
  for (let i = 0; i < tiles.length; i++) {
    if (roadMask(tiles[i]) === 0) continue;
    const x = Math.floor(i / height);
    const y = i % height;
    if (x > 0 && isResidential(tiles[i - height])) return true;
    if (x < width - 1 && isResidential(tiles[i + height])) return true;
    if (y > 0 && isResidential(tiles[i - 1])) return true;
    if (y < height - 1 && isResidential(tiles[i + 1])) return true;
  }
  return false;
}

// Step 3: a power plant (coal or nuclear) is built.
function powerPlant(s) {
  return anyTile(s.tiles, isPowerPlant);
}

// Step 4: a power line exists and a residential zone has power (the power bit of its tile).
function poweredResidence(s) {
  let wire = false;
  let powered = false;
  for (let i = 0; i < s.tiles.length; i++) {
    const t = s.tiles[i];
    if (!wire && isPowerLine(t)) wire = true;
    if (!powered && isResidential(t) && (t & POWER_BIT) !== 0) powered = true;
    if (wire && powered) return true;
  }
  return false;
}

// Step 5: a commercial zone and an industrial zone are placed.
function commercialAndIndustrialZones(s) {
  let commercial = false;
  let industrial = false;
  for (let i = 0; i < s.tiles.length; i++) {
    const zone = zoneOf(s.tiles[i]);
    if (zone === "commercial") commercial = true;
    else if (zone === "industrial") industrial = true;
    if (commercial && industrial) return true;
  }
  return false;
}

// Step 6: the game time has moved on (the simulation runs; the engine's clock is read by the page).
function simulationRuns(s) {
  return s.monthsElapsed >= 1;
}

// Step 7: the population reaches the goal.
function populationGoal(s) {
  return s.population >= POPULATION_GOAL;
}

export const STEPS = Object.freeze([
  {
    id: "zone",
    title: "Posez une zone résidentielle",
    hint: "Choisissez « Zone résidentielle » dans la barre d'outils, puis cliquez sur la carte.",
    done: residentialZone,
  },
  {
    id: "road",
    title: "Reliez-la par une route",
    hint: "Posez des routes jusqu'à toucher un côté de la zone.",
    done: roadNextToResidence,
  },
  {
    id: "plant",
    title: "Construisez une centrale électrique",
    hint: "Une centrale fournit l'électricité. Elle se trouve dans la catégorie « Énergie et transport ».",
    done: powerPlant,
  },
  {
    id: "wire",
    title: "Raccordez la zone avec une ligne électrique",
    hint: "Posez des lignes électriques de la centrale jusqu'à la zone : elle reçoit alors le courant.",
    done: poweredResidence,
  },
  {
    id: "zones",
    title: "Ajoutez une zone commerciale et une zone industrielle",
    hint: "Posez une zone commerciale et une zone industrielle, branchées sur le réseau.",
    done: commercialAndIndustrialZones,
  },
  {
    id: "run",
    title: "Lancez la simulation",
    hint: "Cliquez sur « ▶ Lecture » : le temps avance et la ville vit.",
    done: simulationRuns,
  },
  {
    id: "population",
    title: `Atteignez ${POPULATION_GOAL} habitants`,
    hint: "Les habitants viennent avec les zones résidentielles bien desservies et alimentées.",
    done: populationGoal,
  },
]);

/**
 * Current step index (0-based; STEPS.length when every step is done). Steps complete in order: the
 * index starts at `previousIndex` and moves on only while the step it points at is done, so it never
 * goes backwards and a later step done before an earlier one does not count.
 */
export function progress(snapshot, previousIndex = 0) {
  let i = Number.isInteger(previousIndex) && previousIndex > 0 ? Math.min(previousIndex, STEPS.length) : 0;
  while (i < STEPS.length && STEPS[i].done(snapshot)) i++;
  return i;
}

/** Cheap change key of a tile array: a 32-bit FNV-1a hash (one pass). Equal arrays, equal keys. */
export function tilesDigest(tiles) {
  let h = 0x811c9dc5;
  for (let i = 0; i < tiles.length; i++) h = Math.imul(h ^ tiles[i], 0x01000193);
  return h >>> 0;
}

/** True when the engine has every method the guide reads. */
export function supportsTutorial(city) {
  return ["tiles", "width", "height", "population", "year", "month"].every((m) => typeof city?.[m] === "function");
}

/** The record kept per browser, checked: anything malformed gives the defaults. */
export function sanitizeRecord(raw) {
  const reached = Number.isInteger(raw?.reached) ? Math.min(Math.max(raw.reached, 0), STEPS.length) : 0;
  return { dismissed: raw?.dismissed === true, reached };
}
