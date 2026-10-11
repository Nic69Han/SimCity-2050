# Tests for the page (web/)

These tests need no browser. They exercise the pure modules `web/tools.js` and
`web/input.js` against a mock engine (`web/test/mock-engine.mjs`), not against the
wasm `City`.

Run them from the repository root, with Node 22 or newer:

```sh
node --test web/test/*.test.mjs
```

Note: `node --test web/test/` (a directory argument) does not work since Node 21,
which only accepts file paths or globs; the shell glob above is the equivalent.

Files:

- `input.test.mjs`: pixel -> tile conversion with CSS scaling, drag sequences (tool_drag
  only on consecutive distinct tiles), big tools, inspect (query) tools.
- `tools.test.mjs`: result -> French message for every ToolResult code, feature
  detection fallback (no tool API -> no palette), catalog and groups, shortcut table,
  hover outline geometry and colour verdict.
- `mock-engine.mjs`: deterministic fake `City` implementing the tool contract of
  `docs/tools-contract.md`. Its rules are documented at the top of the file.
