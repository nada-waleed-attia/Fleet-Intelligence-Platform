// lib/cache.js — tiny in-memory TTL cache + in-flight dedupe
const store = new Map();      // key -> { value, expiresAt }
const inflight = new Map();   // key -> Promise (in-flight computation)

function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
    }
    return entry.value;
}

function set(key, value, ttlMs) {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function del(key) {
    store.delete(key);
}

// 👇 ADDED (Enhancement 7): delete every key with the given prefix
function delByPrefix(prefix) {
    for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
    }
}

// 👇 ADDED (Enhancement 7): thundering-herd guard.
// If multiple requests miss the same key at once, only ONE
// computeFn runs; the others await the same promise.
async function getOrCompute(key, ttlMs, computeFn) {
    const hit = get(key);
    if (hit !== undefined) return hit;

    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
        try {
            const value = await computeFn();
            set(key, value, ttlMs);
            return value;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, p);
    return p;
}

module.exports = { get, set, del, delByPrefix, getOrCompute };