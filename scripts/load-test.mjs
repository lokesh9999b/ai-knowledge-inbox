// Minimal closed-loop load generator: N workers each fire requests back-to-back until `total` is reached.
// Usage: node scripts/load-test.mjs <label> <method> <path> <total> <concurrency> [jsonBody] [baseUrl=http://localhost:3001]
const [label, method, path, totalStr, concStr, body] = process.argv.slice(2);
const total = Number(totalStr);
const conc = Number(concStr);
const url = `${process.argv[8] ?? "http://localhost:3001"}${path}`;

const latencies = [];
const statuses = {};
let sent = 0;
const started = performance.now();

async function worker() {
  while (sent < total) {
    sent++;
    const t = performance.now();
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? body.replace('__N__', String(sent)) : undefined,
      });
      await res.arrayBuffer();
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    } catch (e) {
      statuses[e.cause?.code ?? 'ERR'] = (statuses[e.cause?.code ?? 'ERR'] ?? 0) + 1;
    }
    latencies.push(performance.now() - t);
  }
}

await Promise.all(Array.from({ length: conc }, worker));
const secs = (performance.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const q = (p) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]);
console.log(JSON.stringify({ label, total, conc, secs: +secs.toFixed(2), rps: Math.round(total / secs), p50ms: q(0.5), p95ms: q(0.95), p99ms: q(0.99), maxMs: q(1), statuses }));
