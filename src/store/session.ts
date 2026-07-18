/**
 * session — A6 session persistence: recent ingests in IndexedDB, one-click
 * re-map without re-fetching or re-parsing.
 *
 * Two stores: "meta" (small — listed on the hero screen) and "data" (the full
 * IR + file texts, read only on restore). The stored IR is NEVER trusted on
 * the way back in: restore routes through the same boundary validation as the
 * IR-JSON load path (RISK-02 discipline). Restored sessions carry no
 * expandDir capability — the existing disclosure for capability-free loads
 * applies. Fails soft everywhere: persistence is a convenience, never a
 * correctness dependency.
 */

export interface RecentMeta {
  key: string; // stable identity: sourceLabel
  label: string;
  sourceLabel: string;
  kind: "uipath" | "repo";
  savedAt: number; // epoch ms
  includeDirs: string[];
  filesTotal: number;
  locTotal: number;
}

export interface RecentData {
  key: string;
  ir: unknown; // validated on restore
  files: { path: string; text?: string; bytes?: number; skipReason?: string }[];
}

const DB_NAME = "pc-session";
const DB_VERSION = 1;
const CAP = 5;

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("data")) db.createObjectStore("data", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("request failed"));
  });
}

export async function saveRecent(meta: RecentMeta, data: RecentData): Promise<void> {
  if (!hasIdb()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(["meta", "data"], "readwrite");
    tx.objectStore("meta").put(meta);
    tx.objectStore("data").put(data);
    await txDone(tx);
    // Prune beyond CAP, oldest first.
    const all = (await listRecent()).sort((a, b) => b.savedAt - a.savedAt);
    if (all.length > CAP) {
      const prune = db.transaction(["meta", "data"], "readwrite");
      for (const stale of all.slice(CAP)) {
        prune.objectStore("meta").delete(stale.key);
        prune.objectStore("data").delete(stale.key);
      }
      await txDone(prune);
    }
  } finally {
    db.close();
  }
}

export async function listRecent(): Promise<RecentMeta[]> {
  if (!hasIdb()) return [];
  const db = await openDb();
  try {
    const tx = db.transaction("meta", "readonly");
    const all = await reqResult(tx.objectStore("meta").getAll() as IDBRequest<RecentMeta[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}

export async function loadRecent(key: string): Promise<RecentData | null> {
  if (!hasIdb()) return null;
  const db = await openDb();
  try {
    const tx = db.transaction("data", "readonly");
    return ((await reqResult(tx.objectStore("data").get(key) as IDBRequest<RecentData | undefined>)) ?? null);
  } finally {
    db.close();
  }
}

export async function removeRecent(key: string): Promise<void> {
  if (!hasIdb()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(["meta", "data"], "readwrite");
    tx.objectStore("meta").delete(key);
    tx.objectStore("data").delete(key);
    await txDone(tx);
  } finally {
    db.close();
  }
}
