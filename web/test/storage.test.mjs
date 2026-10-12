// The storage port over the in-memory adapter, and the IndexedDB adapter over a small fake
// IDBFactory (the real one is exercised by the end-to-end tests in Chromium).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createStorage, createMemoryAdapter, createIndexedDbAdapter, checkRecord, toStorageError,
  openStorage, StorageError,
} from "../storage.js";

const bytes = (...v) => Uint8Array.from(v);
const rec = (id, extra = {}) => ({
  id, name: `Partie ${id}`, savedAt: 1700000000000, meta: { year: 1900, month: 0, funds: 5, population: 0, width: 120, height: 100 },
  thumbnail: null, bytes: bytes(1, 2, 3), ...extra,
});

describe("checkRecord", () => {
  test("a well-formed record is kept as it is", () => {
    assert.deepEqual(checkRecord(rec("slot-1")).id, "slot-1");
  });
  test("bad shapes are corrupt", () => {
    for (const bad of [null, "x", rec(""), { ...rec("a"), bytes: "text" }, { ...rec("a"), savedAt: NaN }, { ...rec("a"), meta: null }, { ...rec("a"), thumbnail: 3 }]) {
      assert.throws(() => checkRecord(bad), (e) => e.code === "corrupt");
    }
  });
});

describe("memory adapter through the port", () => {
  test("put, get, list (without bytes), remove", async () => {
    const s = createStorage(createMemoryAdapter());
    assert.equal(await s.get("slot-1"), null);
    await s.put(rec("slot-1"));
    await s.put(rec("auto", { name: "Auto" }));
    const got = await s.get("slot-1");
    assert.deepEqual(Array.from(got.bytes), [1, 2, 3]);
    const list = await s.list();
    assert.deepEqual(list.map((e) => e.id), ["slot-1", "auto"]);
    assert.equal(list[0].bytes, undefined, "a list has no bytes");
    assert.equal(list[0].size, 3);
    await s.remove("slot-1");
    assert.equal(await s.get("slot-1"), null);
  });

  test("the stored record is a copy: changing the caller's bytes does not change the save", async () => {
    const a = createMemoryAdapter();
    const s = createStorage(a);
    const r = rec("slot-2");
    await s.put(r);
    r.bytes[0] = 99;
    assert.equal((await s.get("slot-2")).bytes[0], 1);
  });

  test("a corrupt record is listed as corrupt, and get throws corrupt; the other records still list", async () => {
    const a = createMemoryAdapter();
    const s = createStorage(a);
    await s.put(rec("slot-1"));
    a._rawPut("slot-2", { id: "slot-2", bytes: "garbage" });
    const list = await s.list();
    assert.deepEqual(list.map((e) => [e.id, Boolean(e.corrupt)]), [["slot-1", false], ["slot-2", true]]);
    await assert.rejects(s.get("slot-2"), (e) => e.code === "corrupt");
  });

  test("a put of a bad record is refused before the adapter", async () => {
    const s = createStorage(createMemoryAdapter());
    await assert.rejects(s.put({ id: "x" }), (e) => e.code === "corrupt");
  });

  test("a quota error from the browser is a StorageError with code quota", async () => {
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const s = createStorage(createMemoryAdapter({ fail: (op) => (op === "put" ? quota : null) }));
    await assert.rejects(s.put(rec("slot-1")), (e) => e instanceof StorageError && e.code === "quota");
    assert.equal(await s.get("slot-1"), null, "nothing was stored");
  });
});

describe("error mapping", () => {
  test("browser error names map to the codes", () => {
    assert.equal(toStorageError({ name: "QuotaExceededError", message: "q" }).code, "quota");
    assert.equal(toStorageError({ name: "SecurityError", message: "s" }).code, "unavailable");
    assert.equal(toStorageError({ name: "AbortError", message: "a" }).code, "failed");
    const same = new StorageError("blocked");
    assert.equal(toStorageError(same), same);
  });
});

// A small IDBFactory: enough for the adapter (open with upgrade, transactions with put/get/getAll/
// getAllKeys/delete). Requests and transactions complete on the next tick, as in a browser.
function fakeIndexedDb({ failOpen = null, failPut = null } = {}) {
  const dbs = new Map();
  const tick = (fn) => setTimeout(fn, 0);
  return {
    open(name) {
      const req = {};
      tick(() => {
        if (failOpen) {
          req.error = failOpen;
          req.onerror?.();
          return;
        }
        let db = dbs.get(name);
        const fresh = !db;
        if (fresh) dbs.set(name, (db = { stores: new Map() }));
        req.result = {
          objectStoreNames: { contains: (n) => db.stores.has(n) },
          createObjectStore(n) {
            db.stores.set(n, new Map());
          },
          transaction(storeName) {
            const data = db.stores.get(storeName);
            const tx = {};
            tick(() => {});
            tx.objectStore = () => ({
              put(value) {
                const r = {};
                tick(() => {
                  if (failPut) {
                    tx.error = failPut;
                    tx.onerror?.();
                    return;
                  }
                  data.set(value.id, structuredClone(value));
                  r.result = value.id;
                  r.onsuccess?.();
                  tick(() => tx.oncomplete?.());
                });
                return r;
              },
              get(id) {
                const r = {};
                tick(() => {
                  r.result = data.has(id) ? structuredClone(data.get(id)) : undefined;
                  r.onsuccess?.();
                  tick(() => tx.oncomplete?.());
                });
                return r;
              },
              getAll() {
                const r = {};
                tick(() => {
                  r.result = [...data.values()].map((v) => structuredClone(v));
                  r.onsuccess?.();
                  tick(() => tx.oncomplete?.());
                });
                return r;
              },
              getAllKeys() {
                const r = {};
                tick(() => {
                  r.result = [...data.keys()];
                  r.onsuccess?.();
                  tick(() => tx.oncomplete?.());
                });
                return r;
              },
              delete(id) {
                const r = {};
                tick(() => {
                  data.delete(id);
                  r.onsuccess?.();
                  tick(() => tx.oncomplete?.());
                });
                return r;
              },
            });
            return tx;
          },
        };
        if (fresh) {
          req.result.createObjectStore("games");
        }
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

describe("IndexedDB adapter (fake factory)", () => {
  test("round trip through the port: put, list, get, remove", async () => {
    const s = createStorage(createIndexedDbAdapter(fakeIndexedDb()));
    await s.put(rec("auto"));
    await s.put(rec("slot-1", { name: "Une" }));
    assert.deepEqual((await s.list()).map((e) => e.id).sort(), ["auto", "slot-1"]);
    assert.equal((await s.get("slot-1")).name, "Une");
    await s.remove("slot-1");
    assert.equal(await s.get("slot-1"), null);
  });

  test("a missing IndexedDB is the unavailable error", async () => {
    const result = await openStorage(undefined);
    assert.equal(result.available, false);
    assert.equal(result.error.code, "unavailable");
  });

  test("an open that fails leaves the storage unavailable, with the error", async () => {
    const result = await openStorage(fakeIndexedDb({ failOpen: Object.assign(new Error("denied"), { name: "SecurityError" }) }));
    assert.equal(result.available, false);
    assert.equal(result.error.code, "unavailable");
  });

  test("a usable IndexedDB opens and reports available", async () => {
    const result = await openStorage(fakeIndexedDb());
    assert.equal(result.available, true);
    assert.equal(result.error, null);
  });

  test("a quota error of the transaction reaches the caller as quota", async () => {
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const s = createStorage(createIndexedDbAdapter(fakeIndexedDb({ failPut: quota })));
    await assert.rejects(s.put(rec("slot-1")), (e) => e.code === "quota");
  });
});
