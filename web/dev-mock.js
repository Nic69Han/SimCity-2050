// Dev-only: a fake engine for the page at ?mock=1, so the tool palette and input can be
// tried without building the wasm package. Not loaded by default (see main.js).
// The fake is web/test/mock-engine.mjs, whose rules are documented there; it is not the engine.
import { MockCity } from "./test/mock-engine.mjs";

export default async function init() {}
export const City = MockCity;
