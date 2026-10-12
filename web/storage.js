// Saved games in the browser (presentation only: the bytes are the engine's, the page only keeps
// them). A small promise-based port with two adapters:
//   - IndexedDB (database "micropolis", store "games"), the real one;
//   - an in-memory fake, for the unit tests and for a page with no storage.
// Records: { id, name, savedAt (ms), meta, thumbnail (data URL or null), bytes (Uint8Array) }.
// Every failure leaves as a StorageError with a code: unavailable, quota, blocked, corrupt,
// failed. The page turns the code into a French sentence (errors.js); it never throws in an
// event handler.

export const DB_NAME = "micropolis";
export const DB_VERSION = 1;
export const STORE = "games";

export class StorageError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

/** Turns anything a browser storage call throws into a StorageError with a code. */
export function toStorageError(e) {
  if (e instanceof StorageError) return e;
  const name = e?.name ?? "";
  const message = String(e?.message ?? e);
  if (name === "QuotaExceededError" || /quota/i.test(name)) return new StorageError("quota", message);
  if (name === "SecurityError" || name === "InvalidStateError" || name === "NotSupportedError") {
    return new StorageError("unavailable", message);
  }
  if (name === "blocked") return new StorageError("blocked", message);
  return new StorageError("failed", message);
}

/**
 * A record as the page stores it, or throws StorageError("corrupt"). Used on every read and
 * on every write: a record that is not shaped as above is never shown as a save.
 */
export function checkRecord(raw) {
  const ok = raw && typeof raw === "object" &&
    typeof raw.id === "string" && raw.id !== "" &&
    typeof raw.name === "string" &&
    Number.isFinite(raw.savedAt) &&
    raw.meta !== null && typeof raw.meta === "object" &&
    (raw.thumbnail === null || typeof raw.thumbnail === "string") &&
    raw.bytes instanceof Uint8Array;
  if (!ok) throw new StorageError("corrupt", "saved record is not a city");
  return {
    id: raw.id,
    name: raw.name,
    savedAt: raw.savedAt,
    meta: raw.meta,
    thumbnail: raw.thumbnail,
    bytes: raw.bytes,
  };
}

// Everything but the bytes: what a list shows.
function summary(record) {
  const { bytes, ...rest } = record; // eslint-disable-line no-unused-vars
  return { ...rest, size: bytes.length };
}

/**
 * The port over an adapter. Adapters implement get(id), put(record), remove(id), keys() and
 * all(): the raw records (unchecked). list() returns the summaries of the valid records and
 * { id, corrupt: true } for the others, so one bad record never hides the rest.
 */
export function createStorage(adapter, { kind = "memory" } = {}) {
  const guard = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      throw toStorageError(e);
    }
  };
  return {
    kind,
    async list() {
      return guard(async () => {
        const keys = await adapter.keys();
        const raws = await adapter.all();
        const out = [];
        raws.forEach((raw, i) => {
          try {
            out.push(summary(checkRecord(raw)));
          } catch {
            out.push({ id: String(keys[i] ?? raw?.id ?? "?"), corrupt: true });
          }
        });
        return out;
      });
    },
    async get(id) {
      return guard(async () => {
        const raw = await adapter.get(id);
        if (raw === undefined || raw === null) return null;
        return checkRecord(raw);
      });
    },
    async put(record) {
      const checked = checkRecord(record);
      return guard(() => adapter.put(checked));
    },
    async remove(id) {
      return guard(() => adapter.remove(id));
    },
  };
}

/** The in-memory adapter. `fail(op, id)` may return an error to throw for that call (tests). */
export function createMemoryAdapter({ fail = null } = {}) {
  const rows = new Map();
  const check = (op, id) => {
    const err = fail?.(op, id);
    if (err) throw err;
  };
  return {
    async keys() {
      check("keys");
      return [...rows.keys()];
    },
    async all() {
      check("all");
      return [...rows.values()].map((r) => structuredClone(r));
    },
    async get(id) {
      check("get", id);
      return rows.has(id) ? structuredClone(rows.get(id)) : undefined;
    },
    async put(record) {
      check("put", record.id);
      rows.set(record.id, structuredClone(record));
    },
    async remove(id) {
      check("remove", id);
      rows.delete(id);
    },
    /** Test helper: stores a raw value as it is, valid or not. */
    _rawPut(id, value) {
      rows.set(id, value);
    },
  };
}

// IndexedDB request -> promise.
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

// One transaction -> promise of `fn(store)`'s result, rejected on error or abort (a quota error
// shows there, on the transaction).
function transaction(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    try {
      const r = fn(store);
      if (r && typeof r.then === "function") r.then((v) => (result = v), reject);
      else if (r) r.onsuccess = () => (result = r.result);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * The IndexedDB adapter, opened lazily. `factory` is an IDBFactory (globalThis.indexedDB by
 * default); a missing factory is the "unavailable" error at the first call.
 */
export function createIndexedDbAdapter(factory = globalThis.indexedDB) {
  let dbPromise = null;
  const db = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!factory) {
          reject(new StorageError("unavailable", "IndexedDB is not available"));
          return;
        }
        let open;
        try {
          open = factory.open(DB_NAME, DB_VERSION);
        } catch (e) {
          reject(toStorageError(e));
          return;
        }
        open.onupgradeneeded = () => {
          const d = open.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(toStorageError(open.error ?? new Error("open failed")));
        open.onblocked = () => reject(new StorageError("blocked", "IndexedDB open blocked"));
      });
      // A failed open is not cached: the next call may succeed (for example after another tab closes).
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  };
  return {
    async keys() {
      const d = await db();
      return transaction(d, "readonly", (s) => s.getAllKeys());
    },
    async all() {
      const d = await db();
      return transaction(d, "readonly", (s) => s.getAll());
    },
    async get(id) {
      const d = await db();
      return transaction(d, "readonly", (s) => s.get(id));
    },
    async put(record) {
      const d = await db();
      return transaction(d, "readwrite", (s) => s.put(record));
    },
    async remove(id) {
      const d = await db();
      return transaction(d, "readwrite", (s) => s.delete(id));
    },
  };
}

/**
 * Opens the page's storage. Resolves to { storage, available: true } or to
 * { storage: null, available: false, error } when the browser has no usable IndexedDB
 * (private browsing, blocked storage, no IndexedDB at all). It never rejects.
 * The probe is one read: a store that cannot be read is not usable.
 */
export async function openStorage(factory = globalThis.indexedDB) {
  const storage = createStorage(createIndexedDbAdapter(factory), { kind: "indexeddb" });
  try {
    await storage.list();
    return { storage, available: true, error: null };
  } catch (e) {
    const error = toStorageError(e);
    return { storage: null, available: false, error };
  }
}
