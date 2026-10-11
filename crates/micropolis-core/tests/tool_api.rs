//! Tests of the tool API on `assets/cities/haight.cty`: `EditingTool::{ALL,
//! cost, size, key, footprint}` and `Simulation::tool_preview`.
//!
//! For every tool and about 200 positions (borders, corners, off-map points
//! and a fixed pseudo-random spread), with three funding levels, the preview
//! must change nothing, must predict the result and cost of `tool_down`, and
//! the footprint of a building must match the tiles it changes.

use micropolis_core::events::Event;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{
    Tile, DIRT, LASTPOWER, LASTRAIL, LASTROAD, LOMASK, POWERBASE, RAILBASE, ROADBASE,
};
use micropolis_core::tool::{EditingTool, ToolPreview, ToolResult};

const HAIGHT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../assets/cities/haight.cty"
));

/// `gCostOf` in `reference/micropolis-cpp/tool.cpp`, in `EditingTool` order.
const CPP_COST: [i32; 20] = [
    100, 100, 100, 500, // res, com, ind, fire
    500, 0, 5, 1, // police, query, wire, bulldozer
    20, 10, 5000, 10, // rail, road, stadium, park
    3000, 3000, 5000, 10000, // seaport, coal, nuclear, airport
    100, 0, 0, 0, // network, water, land, forest
];

/// `gToolSize` in `reference/micropolis-cpp/tool.cpp`, in `EditingTool` order.
const CPP_SIZE: [i32; 20] = [
    3, 3, 3, 3, // res, com, ind, fire
    3, 1, 1, 1, // police, query, wire, bulldozer
    1, 1, 4, 1, // rail, road, stadium, park
    4, 4, 4, 6, // seaport, coal, nuclear, airport
    1, 1, 1, 1, // network, water, land, forest
];

/// Funding levels: the city's own funds, a lot of money, and too little for
/// most tools (so `NoMoney` is reached).
const FUNDS: [Option<i64>; 3] = [None, Some(10_000_000), Some(40)];

/// The sample city, with the given funds, and with the auto-bulldozer on or
/// off (off is the default of a loaded city; on clears the site first).
///
/// Haight has no free 6x6 site anywhere, so an 8x8 block of dirt is cut into
/// it at (40, 60): the airport needs one to succeed. The rest of the city is
/// as the file has it.
fn haight(funds: Option<i64>, auto_bulldoze: bool) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_cty(HAIGHT).expect("haight.cty loads");
    for x in 40..48 {
        for y in 60..68 {
            s.set_tile(x, y, DIRT);
        }
    }
    if let Some(f) = funds {
        s.total_funds = f;
    }
    s.auto_bulldoze = auto_bulldoze;
    s
}

/// Everything a tool call may change, plus the events queued for the adapter.
#[derive(Debug, PartialEq)]
struct Snapshot {
    tiles: Vec<Tile>,
    funds: i64,
    /// The next random numbers of the generator (taken from a copy).
    rng_next: Vec<i32>,
    map_serial: i32,
    events: Vec<Event>,
}

fn snapshot(s: &Simulation) -> Snapshot {
    let mut rng = s.rng.clone();
    let mut copy = s.clone();
    Snapshot {
        tiles: s.tiles.clone(),
        funds: s.total_funds,
        rng_next: (0..16).map(|_| rng.sim_random()).collect(),
        map_serial: s.map_serial,
        events: copy.drain_events(),
    }
}

/// About 200 positions: the borders and the first tiles off the map, plus a
/// fixed pseudo-random spread over the map and a margin around it.
fn positions(base: &Simulation) -> Vec<(i32, i32)> {
    let (w, h) = base.world_size();
    let mut v = vec![
        (0, 0),
        (1, 0),
        (0, 1),
        (1, 1),
        (2, 2),
        (w - 1, 0),
        (w - 2, 1),
        (w - 1, h - 1),
        (w - 2, h - 2),
        (0, h - 1),
        (1, h - 2),
        (w / 2, 0),
        (w / 2, h - 1),
        (0, h / 2),
        (w - 1, h / 2),
        (-1, -1),
        (-1, 0),
        (0, -1),
        (w, 0),
        (w, h),
        (w - 1, h),
        (-2, h / 2),
        (w + 1, h + 1),
        (w / 2, h),
    ];
    // Centres of clear areas, so that the big buildings can be placed too.
    for size in [3, 4, 6] {
        v.extend(dirt_block_centres(base, size, 2));
    }
    // SplitMix-style generator with a fixed seed: the test is reproducible.
    let mut state: u64 = 0x2050_7001_0000_0001;
    let mut next = move || {
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    while v.len() < 200 {
        let x = (next() % (w as u64 + 6)) as i32 - 3;
        let y = (next() % (h as u64 + 6)) as i32 - 3;
        v.push((x, y));
    }
    v
}

#[test]
fn tool_table_matches_cpp() {
    assert_eq!(EditingTool::ALL.len(), 20);
    for (i, tool) in EditingTool::ALL.iter().enumerate() {
        assert_eq!(*tool as usize, i, "ALL is in enum order");
        assert_eq!(EditingTool::from_index(i as i32), Some(*tool));
        assert_eq!(tool.cost(), CPP_COST[i], "cost of {tool:?}");
        assert_eq!(tool.size(), CPP_SIZE[i], "size of {tool:?}");
    }
    assert_eq!(EditingTool::from_index(20), None);
}

#[test]
fn keys_are_stable_and_unique() {
    let keys: Vec<&str> = EditingTool::ALL.iter().map(|t| t.key()).collect();
    assert_eq!(
        keys,
        [
            "residential",
            "commercial",
            "industrial",
            "fire_station",
            "police_station",
            "query",
            "wire",
            "bulldozer",
            "railroad",
            "road",
            "stadium",
            "park",
            "seaport",
            "coal_power",
            "nuclear_power",
            "airport",
            "network",
            "water",
            "land",
            "forest",
        ]
    );
    let mut sorted = keys.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), keys.len());
}

#[test]
fn footprint_covers_the_placed_building() {
    for tool in EditingTool::ALL {
        let (x, y) = (10, 20);
        let (x0, y0, w, h) = tool.footprint(x, y);
        if tool.size() == 1 {
            assert_eq!((x0, y0, w, h), (x, y, 1, 1), "{tool:?}");
        } else {
            // build_building lays the building out from (x - 1, y - 1).
            let s = tool.size();
            assert_eq!((x0, y0, w, h), (x - 1, y - 1, s, s), "{tool:?}");
            // The zone centre is the tile the tool was used at.
            assert!(x0 < x && x < x0 + w && y0 < y && y < y0 + h, "{tool:?}");
        }
    }
}

/// Up to `count` tiles `(x, y)` where a `size` x `size` building, laid out
/// from `(x - 1, y - 1)`, would find only dirt or tiles the auto-bulldozer
/// clears.
fn dirt_block_centres(base: &Simulation, size: i32, count: usize) -> Vec<(i32, i32)> {
    let (w, h) = base.world_size();
    let mut found = Vec::new();
    for x in 1..w - size + 1 {
        for y in 1..h - size + 1 {
            let clear = (0..size).all(|dx| {
                (0..size).all(|dy| {
                    base.tile(x - 1 + dx, y - 1 + dy)
                        .is_some_and(|t| t == DIRT || base.tally(i32::from(t)))
                })
            });
            if clear {
                found.push((x, y));
                if found.len() == count {
                    return found;
                }
            }
        }
    }
    found
}

/// Road, power line or rail tile, the tiles whose connection bits `fixZone` sets.
fn is_connectable(t: Tile) -> bool {
    (ROADBASE..=LASTROAD).contains(&t)
        || (POWERBASE..=LASTPOWER).contains(&t)
        || (RAILBASE..=LASTRAIL).contains(&t)
}

/// The checks of one tool at one position, on the city `base`.
fn check_position(base: &Simulation, tool: EditingTool, x: i32, y: i32) -> ToolResult {
    let context = format!("{tool:?} at ({x}, {y}) funds {}", base.total_funds);
    let before = snapshot(base);

    // (a) The preview changes nothing.
    let preview: ToolPreview = base.tool_preview(tool, x, y);
    assert_eq!(
        snapshot(base),
        before,
        "preview changed the city: {context}"
    );

    // Result and cost: 0 unless the tool succeeds.
    if preview.result != ToolResult::Ok {
        assert_eq!(preview.cost, 0, "cost without success: {context}");
    }

    // (b) On a clone, tool_down gives the same result and charges exactly the
    // previewed cost. The preview is also run on the live object before
    // tool_down, which must not notice it.
    let mut live = base.clone();
    let _ = live.tool_preview(tool, x, y);
    let result = live.tool_down(tool, x, y);
    assert_eq!(result, preview.result, "result: {context}");
    if result == ToolResult::Ok {
        assert_eq!(
            live.total_funds,
            base.total_funds - i64::from(preview.cost),
            "funds: {context}"
        );
    } else {
        assert_eq!(live.total_funds, base.total_funds, "funds: {context}");
    }

    // A fresh run without any preview gives the same city and events.
    let mut fresh = base.clone();
    assert_eq!(
        fresh.tool_down(tool, x, y),
        result,
        "without preview: {context}"
    );
    assert_eq!(
        snapshot(&live),
        snapshot(&fresh),
        "after preview: {context}"
    );

    // (c) For a successful building, the footprint is the set of changed tiles.
    if result == ToolResult::Ok && tool.size() > 1 {
        assert!(
            preview.cost >= tool.cost(),
            "a building costs at least its tool: {context}"
        );
        let (fx0, fy0, fw, fh) = tool.footprint(x, y);
        let (world_w, world_h) = base.world_size();
        assert!(
            fx0 >= 0 && fy0 >= 0 && fx0 + fw <= world_w && fy0 + fh <= world_h,
            "footprint on the map: {context}"
        );

        let mut changed = Vec::new();
        for cx in 0..world_w {
            for cy in 0..world_h {
                if base.tile(cx, cy) != live.tile(cx, cy) {
                    changed.push((cx, cy));
                }
            }
        }
        let inside =
            |p: &(i32, i32)| (fx0..fx0 + fw).contains(&p.0) && (fy0..fy0 + fh).contains(&p.1);
        // Every footprint tile is laid out, so every one of them changes.
        for cx in fx0..fx0 + fw {
            for cy in fy0..fy0 + fh {
                assert!(
                    changed.contains(&(cx, cy)),
                    "footprint tile ({cx}, {cy}) unchanged: {context}"
                );
            }
        }
        // The zone centre is covered.
        assert!(changed.contains(&(x, y)), "centre unchanged: {context}");
        // Changed tiles outside the footprint are connection fixes of the
        // roads, wires and rails around the building (`checkBorder` and the
        // `fixZone` it calls). They lie within two tiles of the footprint and
        // change only the connection bits of a road, wire or rail tile.
        for &(cx, cy) in changed.iter().filter(|p| !inside(p)) {
            let dx = (fx0 - cx).max(cx - (fx0 + fw - 1)).max(0);
            let dy = (fy0 - cy).max(cy - (fy0 + fh - 1)).max(0);
            assert!(
                dx.max(dy) <= 2,
                "tile ({cx}, {cy}) changed too far from the footprint: {context}"
            );
            for t in [base.tile(cx, cy), live.tile(cx, cy)] {
                let t = t.expect("changed tile is on the map") & LOMASK;
                assert!(
                    is_connectable(t),
                    "tile ({cx}, {cy}) = {t} changed outside the footprint: {context}"
                );
            }
        }
    }

    result
}

#[test]
fn preview_matches_tool_down_on_haight() {
    let mut seen = std::collections::BTreeMap::<&str, [u32; 4]>::new();
    for auto_bulldoze in [false, true] {
        for funds in FUNDS {
            let base = haight(funds, auto_bulldoze);
            let points = positions(&base);
            assert!(points.len() >= 200);
            for tool in EditingTool::ALL {
                for &(x, y) in &points {
                    let result = check_position(&base, tool, x, y);
                    let counts = seen.entry(tool.key()).or_insert([0; 4]);
                    counts[(result as i32 + 2) as usize] += 1;
                }
            }
        }
    }
    // The positions exercise the outcomes, so the matrix is not vacuous.
    for (key, counts) in &seen {
        assert!(
            counts[(ToolResult::Ok as i32 + 2) as usize] > 0,
            "{key} never succeeded"
        );
    }
    eprintln!("outcomes (NoMoney, NeedBulldoze, Failed, Ok) per tool: {seen:?}");
}

#[test]
fn preview_leaves_the_generator_for_later_tools() {
    // The park tool draws a random number even when it fails. A preview of a
    // failing or succeeding park must not change which tree the next real
    // park gets.
    let base = haight(None, false);
    let (world_w, world_h) = base.world_size();
    let mut dirt = None;
    'search: for x in 0..world_w {
        for y in 0..world_h {
            if base.tile(x, y) == Some(DIRT) {
                dirt = Some((x, y));
                break 'search;
            }
        }
    }
    let (x, y) = dirt.expect("haight has dirt");

    let mut plain = base.clone();
    let expected = plain.tool_down(EditingTool::Park, x, y);

    let mut previewed = base.clone();
    for _ in 0..5 {
        let p = previewed.tool_preview(EditingTool::Park, x, y);
        assert_eq!(p.result, ToolResult::Ok);
        assert_eq!(p.cost, 10);
    }
    assert_eq!(previewed.tool_down(EditingTool::Park, x, y), expected);
    assert_eq!(previewed.tile(x, y), plain.tile(x, y));
    assert_eq!(snapshot(&previewed), snapshot(&plain));
}
