// Error texts: engine codes (and the legacy English messages) to French; storage codes to French.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { engineErrorText, storageErrorText, splitError } from "../errors.js";
import { StorageError } from "../storage.js";

describe("engine error codes", () => {
  test("a <code>: <detail> message gives its code and detail", () => {
    assert.deepEqual(splitError(new Error("cty_bad_magic: no MCTY header")), { code: "cty_bad_magic", detail: "no MCTY header" });
    assert.deepEqual(splitError("size_out_of_range: 79x60"), { code: "size_out_of_range", detail: "79x60" });
  });

  test("the legacy English messages are recognised", () => {
    assert.deepEqual(splitError(new Error("invalid .cty size: 100 bytes (expected 27120)")), { code: "cty_bad_size", detail: "100" });
  });

  test("every file code has a French sentence starting with Erreur", () => {
    for (const code of ["cty_bad_size", "cty_bad_magic", "cty_bad_version", "cty_size_out_of_range", "cty_truncated"]) {
      const text = engineErrorText(new Error(`${code}: x`));
      assert.ok(text.startsWith("Erreur : fichier invalide"), `${code}: ${text}`);
      assert.doesNotMatch(text, /\binvalid\b|size:|bytes/, `${code} is French`);
    }
  });

  test("the size of a bad file is written in the sentence", () => {
    assert.equal(engineErrorText(new Error("invalid .cty size: 10 bytes (expected 27120)")),
      "Erreur : fichier invalide, taille incorrecte (10 octets).");
  });

  test("size codes use the limits of the engine", () => {
    const limits = { minWidth: 80, minHeight: 67, maxWidth: 512, maxHeight: 512 };
    assert.equal(engineErrorText(new Error("size_out_of_range: x"), limits),
      "Erreur : taille de carte hors limites (de 80 × 67 à 512 × 512).");
    assert.match(engineErrorText(new Error("size_not_saveable: 100x100")), /^Enregistrement indisponible/);
  });

  test("an unknown error keeps its detail in a generic sentence", () => {
    assert.equal(engineErrorText(new Error("bad header")), "Erreur : bad header");
    assert.equal(engineErrorText(undefined), "Erreur : undefined");
  });
});

describe("storage error codes", () => {
  test("each code has a French text", () => {
    assert.match(storageErrorText(new StorageError("unavailable")), /navigation privée/);
    assert.match(storageErrorText(new StorageError("quota")), /plein/);
    assert.match(storageErrorText(new StorageError("blocked")), /autre fenêtre/);
    assert.equal(storageErrorText(new StorageError("corrupt")), "Cette sauvegarde est illisible.");
  });

  test("an unknown storage error still gives a French sentence with the detail", () => {
    assert.equal(storageErrorText(new StorageError("failed", "boom")), "Échec de l'enregistrement dans le navigateur : boom");
  });
});
