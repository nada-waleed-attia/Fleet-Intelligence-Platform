// EDIT BY NADA — all persistence belongs to the dedicated preview origin.
(() => {
  const P = globalThis.ObserverPreview, KEY = 'observer-fleet-preview:v1', DB = 'observer-fleet-preview-blobs-v1';
  let cached;
  P.read = () => {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch { throw new Error('Preview storage is unavailable. Allow site storage for this local preview.'); }
    if (!raw) { cached = P.seed(); P.save(cached); }
    else {
      try {
        cached = JSON.parse(raw);
        if (cached.version !== 1 || !Array.isArray(cached.users)) throw Error();
        // One-time migration: older previews seeded a fictional SMS history.
        // Clear it so the report reflects only messages submitted by the user.
        if (!cached.smsLogsResetV2) {
          cached.logs = [];
          cached.smsLogsResetV2 = true;
          P.save(cached);
        }
      } catch { throw new Error('Demo storage is incompatible or damaged. Use Reset demo data.'); }
    }
    return P.clone(cached);
  };
  P.save = state => { try { localStorage.setItem(KEY, JSON.stringify(state)); cached = P.clone(state); } catch { throw new Error('Demo data could not be saved. Storage may be full or blocked. Reset demo data or free local space.'); } };
  P.mutate = fn => { const state = P.read(), result = fn(state); P.save(state); return P.clone(result === undefined ? state : result); };
  P.nextId = (state, type) => `demo-${type}-${++state.sequence}`;
  P.user = (state = P.read()) => state.users.find(u => u._id === state.activeUser) || state.users[0];
  P.scopedUnits = (state, user = P.user(state)) => state.mode === 'explore' || user.role === 'admin' ? state.units : state.units.filter(u => user.assignedUnitNames.includes(u.name));
  const openDB = () => new Promise((resolve, reject) => { const request = indexedDB.open(DB, 1); request.onupgradeneeded = () => request.result.createObjectStore('files'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Local attachment storage unavailable.')); });
  const transaction = async (mode, action) => { const db = await openDB(); try { return await new Promise((resolve, reject) => { const tx = db.transaction('files', mode), request = action(tx.objectStore('files')); tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(new Error('Local attachment operation failed. Check available browser storage.')); }); } finally { db.close(); } };
  P.putFile = (id, blob) => transaction('readwrite', store => store.put(blob, id));
  P.getFile = id => transaction('readonly', store => store.get(id));
  P.deleteFile = id => transaction('readwrite', store => store.delete(id));
  P.reset = async () => { await transaction('readwrite', store => store.clear()); const state = P.seed(); P.save(state); return state; };
  P.storageKey = KEY;
})();
