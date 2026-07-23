// ═══════════════ NEXUS · IndexedDB (camada de persistência) ═══════════════
// Todos os dados vivem no dispositivo. Nada sai daqui.

const DB_NAME = "nexus-workspace";
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pages")) {
        const s = db.createObjectStore("pages", { keyPath: "id" });
        s.createIndex("updatedAt", "updatedAt");
        s.createIndex("journalDate", "journalDate");
      }
      if (!db.objectStoreNames.contains("databases"))
        db.createObjectStore("databases", { keyPath: "id" });
      if (!db.objectStoreNames.contains("versions")) {
        const s = db.createObjectStore("versions", { keyPath: "id" });
        s.createIndex("pageId", "pageId");
      }
      if (!db.objectStoreNames.contains("trash"))
        db.createObjectStore("trash", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings"))
        db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("assets"))
        db.createObjectStore("assets", { keyPath: "id" });
      if (!db.objectStoreNames.contains("embeddings"))
        db.createObjectStore("embeddings", { keyPath: "id" });
      if (!db.objectStoreNames.contains("automations"))
        db.createObjectStore("automations", { keyPath: "id" });
      if (!db.objectStoreNames.contains("aiMemory"))
        db.createObjectStore("aiMemory", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => resolve(out?.__result !== undefined ? out.__result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function reqToResult(req) {
  const holder = { __result: undefined };
  req.onsuccess = () => { holder.__result = req.result; };
  return holder;
}

export const idb = {
  get: (store, key) => tx(store, "readonly", (s) => reqToResult(s.get(key))),
  getAll: (store) => tx(store, "readonly", (s) => reqToResult(s.getAll())),
  getAllByIndex: (store, index, value) =>
    tx(store, "readonly", (s) => reqToResult(s.index(index).getAll(value))),
  put: (store, value) => tx(store, "readwrite", (s) => { s.put(value); }),
  putMany: (store, values) => tx(store, "readwrite", (s) => { values.forEach((v) => s.put(v)); }),
  del: (store, key) => tx(store, "readwrite", (s) => { s.delete(key); }),
  clear: (store) => tx(store, "readwrite", (s) => { s.clear(); }),
  count: (store) => tx(store, "readonly", (s) => reqToResult(s.count())),
};

export async function estimateStorage() {
  try {
    const est = await navigator.storage?.estimate?.();
    return est ? { usage: est.usage || 0, quota: est.quota || 0 } : null;
  } catch { return null; }
}
