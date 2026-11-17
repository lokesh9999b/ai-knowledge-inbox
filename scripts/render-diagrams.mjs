// Renders every docs/diagrams/*.mmd (Mermaid) to docs/images/diagrams/*.png with headless Chrome.
//
// Why images: Mermaid blocks are only drawn by some viewers (GitHub yes, many editors and previews no, and wide
// diagrams shrink to unreadable). Committed PNGs show everywhere; the .mmd files stay the editable source.
//
// Usage:  node scripts/render-diagrams.mjs        (needs Chrome or Edge; set CHROME=<path> if it is not found)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const srcDir = join(repo, 'docs/diagrams');
const outDir = join(repo, 'docs/images/diagrams');
const only = process.argv.slice(2); // optional: names to render, e.g. architecture llm-chain

const candidates = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chromePath = candidates.find((p) => existsSync(p));
if (!chromePath) throw new Error('Chrome or Edge not found. Set CHROME=<path to the executable>.');

const diagrams = readdirSync(srcDir)
  .filter((f) => f.endsWith('.mmd'))
  .map((f) => ({ name: basename(f, '.mmd'), code: readFileSync(join(srcDir, f), 'utf8') }))
  .filter((d) => only.length === 0 || only.includes(d.name));
mkdirSync(outDir, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'diagrams-'));
const page = join(work, 'render.html');
writeFileSync(
  page,
  `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#fff;font-family:'Segoe UI',Arial,sans-serif">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<div id="stage" style="display:inline-block;padding:24px;background:#fff"></div>
<script>
window.__diagrams = ${JSON.stringify(diagrams)};
mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose',
  themeVariables: { fontSize: '17px', fontFamily: "'Segoe UI', Arial, sans-serif" },
  flowchart: { htmlLabels: true, curve: 'basis', nodeSpacing: 40, rankSpacing: 46, padding: 14, wrappingWidth: 420 },
  sequence: { actorMargin: 40, messageMargin: 34, noteMargin: 12, wrap: true, width: 170 } });
window.__render = async (i) => {
  const d = window.__diagrams[i];
  const stage = document.getElementById('stage');
  stage.innerHTML = '';
  try {
    const { svg } = await mermaid.render('g' + i, d.code);
    stage.innerHTML = svg;
    // Mermaid emits width="100%" with a max-width, which collapses inside a shrink-to-fit box.
    // Give the SVG its natural size from the viewBox so the capture is the full diagram.
    const el = stage.querySelector('svg');
    const vb = el.viewBox.baseVal;
    el.removeAttribute('style');
    el.setAttribute('width', Math.ceil(vb.width));
    el.setAttribute('height', Math.ceil(vb.height));
    const r = stage.getBoundingClientRect();
    return { ok: true, x: r.left, y: r.top, width: Math.ceil(r.width), height: Math.ceil(r.height) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
};
</script>`,
);

const PORT = 9355;
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, 'profile')}`, '--hide-scrollbars', '--disable-gpu', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* still starting */ }
  if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

let failed = 0;
try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(page).href });
  for (let i = 0; i < 80 && !(await evaluate("typeof mermaid !== 'undefined' && typeof window.__render === 'function'")); i++) await sleep(250);
  if (!(await evaluate("typeof mermaid !== 'undefined'"))) throw new Error('mermaid failed to load (no network access to cdn.jsdelivr.net?)');

  for (const [i, d] of diagrams.entries()) {
    const r = await evaluate(`window.__render(${i})`);
    if (!r.ok) { console.error(`FAILED ${d.name}: ${r.error}`); failed++; continue; }
    await send('Emulation.setDeviceMetricsOverride', { width: Math.max(1400, r.width + 60), height: Math.max(1000, r.height + 60), deviceScaleFactor: 2, mobile: false });
    await sleep(150);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
    const file = join(outDir, `${d.name}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`rendered ${d.name}.png  ${r.width}x${r.height}  ${Math.round((shot.data.length * 0.75) / 1024)} KB`);
  }
} finally {
  ws.close();
  chrome.kill();
}
process.exit(failed ? 1 : 0);
