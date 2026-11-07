// lib/parallel.js
// Runs `worker` over `items` with at most `concurrency` in flight.
async function mapLimit(items, concurrency, worker) {
    const results = new Array(items.length);
    let i = 0;

    async function runner() {
        while (true) {
            const idx = i++;
            if (idx >= items.length) return;
            try {
                results[idx] = await worker(items[idx], idx);
            } catch (err) {
                results[idx] = { error: err.message, __failed: true };
            }
        }
    }

    const runners = Array.from({ length: Math.min(concurrency, items.length) }, runner);
    await Promise.all(runners);
    return results;
}

module.exports = mapLimit;
module.exports.mapLimit = mapLimit; // optional: keeps both styles working