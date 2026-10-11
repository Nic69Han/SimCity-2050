//! Enforces the dependency rules of ARCHITECTURE.md on the core crate.

use std::fs;
use std::path::{Path, PathBuf};

fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            rs_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

#[test]
fn core_has_no_dependencies() {
    let manifest = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).unwrap();
    let deps = manifest.split("[dependencies]").nth(1).unwrap_or("");
    let deps = deps.split("\n[").next().unwrap();
    assert!(
        deps.lines()
            .all(|l| l.trim().is_empty() || l.trim().starts_with('#')),
        "micropolis-core must stay dependency free:\n{deps}"
    );
}

#[test]
fn core_source_does_no_io_and_knows_no_adapter() {
    let mut files = Vec::new();
    rs_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let banned = [
        "std::fs",
        "std::net",
        "std::time",
        "std::thread",
        "std::env",
        "std::process",
        "wasm_bindgen",
        "web_sys",
        "js_sys",
        "micropolis_wasm",
        "println!",
        "eprintln!",
    ];
    for f in files {
        let text = fs::read_to_string(&f).unwrap();
        // Ignore the test modules: the rule is about shipped code.
        let shipped = text.split("#[cfg(test)]").next().unwrap();
        for b in banned {
            assert!(
                !shipped.contains(b),
                "{} uses `{b}`, forbidden in the core",
                f.display()
            );
        }
    }
}
