// Node tests of web/sizes.js: the map-size choices of "Nouvelle ville" and the save rule.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIMITS,
  ORIGINAL_SIZE,
  SAVE_UNAVAILABLE_NOTE,
  SIZE_PRESETS,
  chooseSize,
  isOriginalSize,
  isSaveable,
  limitsFrom,
  parseDimension,
  presetOptionLabel,
  readLimits,
  saveNote,
  sizeErrorText,
  sizeLabel,
  supportsNewSized,
  validateSize,
} from "../sizes.js";

describe("presets", () => {
  it("offers the original size, Grande, Très grande and Personnalisée", () => {
    assert.deepEqual(
      SIZE_PRESETS.map((p) => p.id),
      ["normal", "grande", "tres-grande", "custom"],
    );
    assert.deepEqual(chooseSize({ preset: "normal" }), { width: 120, height: 100 });
    assert.deepEqual(chooseSize({ preset: "grande" }), { width: 200, height: 150 });
    assert.deepEqual(chooseSize({ preset: "tres-grande" }), { width: 300, height: 250 });
    assert.deepEqual(ORIGINAL_SIZE, { width: 120, height: 100 });
  });

  it("labels the presets with their size, the custom one without", () => {
    assert.equal(presetOptionLabel(SIZE_PRESETS[0]), "Normal (120 × 100)");
    assert.equal(presetOptionLabel(SIZE_PRESETS[2]), "Très grande (300 × 250)");
    assert.equal(presetOptionLabel(SIZE_PRESETS[3]), "Personnalisée");
  });

  it("refuses an unknown preset", () => {
    assert.ok(chooseSize({ preset: "gigantesque" }).error);
  });
});

describe("parseDimension", () => {
  it("accepts whole numbers with blanks around them", () => {
    assert.equal(parseDimension(" 97 "), 97);
    assert.equal(parseDimension("512"), 512);
  });

  it("rejects everything else", () => {
    for (const bad of ["", "  ", "12.5", "-3", "1e3", "abc", "0x10", "+5", null, undefined]) {
      assert.equal(parseDimension(bad), null, JSON.stringify(bad));
    }
  });
});

describe("validateSize (custom)", () => {
  it("accepts the engine limits, inclusive", () => {
    assert.deepEqual(validateSize("80", "67"), { width: 80, height: 67 });
    assert.deepEqual(validateSize("512", "512"), { width: 512, height: 512 });
    assert.deepEqual(validateSize("90", "300"), { width: 90, height: 300 });
  });

  it("names the field and the limits when a number is out of range", () => {
    assert.deepEqual(validateSize("79", "100"), {
      error: "Largeur hors limites : de 80 à 512",
      field: "width",
    });
    assert.deepEqual(validateSize("120", "513"), {
      error: "Hauteur hors limites : de 67 à 512",
      field: "height",
    });
    assert.equal(validateSize("120", "66").field, "height");
  });

  it("names the field when a box is not a whole number", () => {
    assert.deepEqual(validateSize("", "100"), {
      error: "Largeur invalide : entrer un nombre entier",
      field: "width",
    });
    assert.equal(validateSize("120", "1.5").field, "height");
  });

  it("uses the limits the engine reports", () => {
    const limits = limitsFrom([100, 80, 200, 150]);
    assert.deepEqual(validateSize("100", "80", limits), { width: 100, height: 80 });
    assert.equal(validateSize("99", "80", limits).field, "width");
    assert.equal(validateSize("200", "151", limits).field, "height");
  });

  it("chooseSize validates the custom boxes", () => {
    assert.deepEqual(chooseSize({ preset: "custom", width: "160", height: "120" }), { width: 160, height: 120 });
    assert.equal(chooseSize({ preset: "custom", width: "10", height: "120" }).field, "width");
  });
});

describe("limits", () => {
  it("defaults to the engine limits", () => {
    assert.deepEqual(DEFAULT_LIMITS, { minWidth: 80, minHeight: 67, maxWidth: 512, maxHeight: 512 });
  });

  it("reads [minW, minH, maxW, maxH] and falls back on malformed values", () => {
    assert.deepEqual(limitsFrom([80, 67, 512, 512]), DEFAULT_LIMITS);
    assert.deepEqual(limitsFrom([80, 67, 512]), DEFAULT_LIMITS);
    assert.deepEqual(limitsFrom(["80", 67, 512, 512]), DEFAULT_LIMITS);
    assert.deepEqual(limitsFrom(null), DEFAULT_LIMITS);
  });

  it("readLimits uses City.size_limits when present, the defaults otherwise", () => {
    class Engine {
      static size_limits() {
        return new Int32Array([80, 67, 400, 300]);
      }
    }
    assert.deepEqual(readLimits(Engine), { minWidth: 80, minHeight: 67, maxWidth: 400, maxHeight: 300 });
    assert.deepEqual(readLimits({}), DEFAULT_LIMITS);
    assert.deepEqual(
      readLimits({
        size_limits() {
          throw new Error("boom");
        },
      }),
      DEFAULT_LIMITS,
    );
  });

  it("the error text for an out-of-range size names the limits", () => {
    assert.equal(sizeErrorText("size_out_of_range"), "Taille hors limites : de 80 × 67 à 512 × 512.");
    assert.equal(sizeErrorText("size_not_saveable"), SAVE_UNAVAILABLE_NOTE);
    assert.equal(sizeErrorText("something_else"), "Erreur : something_else");
  });
});

describe("feature detection and saving", () => {
  it("the engine has the size feature only when new_sized is a function", () => {
    assert.equal(supportsNewSized({ new_sized() {} }), true);
    assert.equal(supportsNewSized({ new_random_city() {} }), false);
    assert.equal(supportsNewSized(undefined), false);
  });

  it("only the original size is saveable, and the page says why otherwise", () => {
    assert.equal(isOriginalSize(120, 100), true);
    assert.equal(isOriginalSize(300, 250), false);
    assert.equal(saveNote(true), "");
    assert.match(saveNote(false), /120 × 100/);
    assert.equal(isSaveable({ is_saveable: () => false }), false);
    assert.equal(isSaveable({ is_saveable: () => true }), true);
    assert.equal(isSaveable({}), true, "an engine without the method keeps the old behaviour");
  });

  it("sizeLabel formats a size", () => {
    assert.equal(sizeLabel(97, 83), "97 × 83");
  });
});
