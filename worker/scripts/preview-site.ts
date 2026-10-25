// Renders public/ with mock history (no backend needed) and screenshots it with local Chrome/Edge.
// Usage: node scripts/preview-site.ts [--open]   → site-preview-desktop.png, site-preview-mobile.png
// Also writes site-preview/index.html, which you can open in a browser to click around.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIN = 60e3, HOUR = 36e5, DAY = 864e5;

// Deterministic RNG so previews are stable.
let seed = 42;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const randn = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

const tzFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
const tzOff = (ms: number) => { const p: Record<string, string> = {}; for (const x of tzFmt.formatToParts(new Date(ms))) p[x.type] = x.value; return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / MIN) * MIN; };
const toEpoch = (l: number) => l - tzOff(l - tzOff(l));

// Kyiv-style rotating queues: off blocks in hours.
const PATTERNS: [number, number][][] = [
  [[8, 12], [18, 21.5]],
  [[4, 8], [15, 18.5]],
  [[0, 3.5], [11, 15], [21.5, 24]],
];
const slots = (blocks: [number, number][]) => { const s = Array(48).fill('1'); for (const [a, b] of blocks) for (let i = a * 2; i < b * 2; i++) s[i] = '0'; return s.join(''); };

const now = Date.now();
const nowL = now + tzOff(now);
const today = Math.floor(nowL / DAY) * DAY;
const TRACK_DAYS = 120, SCHEDULE_DAYS = 70;
const trackStartL = today - TRACK_DAYS * DAY + 13.4 * HOUR;

const schedule: Record<string, string> = {};
const outagesL: [number, number][] = [];
for (let d = -TRACK_DAYS; d <= 1; d++) {
  const ds = today + d * DAY;
  const light = rnd() < 0.18; // some days without scheduled outages
  const blocks = light ? [] : PATTERNS[(d + 300) % 3];
  if (d >= -SCHEDULE_DAYS) schedule[new Date(ds).toISOString().slice(0, 10)] = slots(blocks);
  for (const [a, b] of blocks) {
    if (rnd() < 0.12) continue; // cancelled
    const s = ds + a * HOUR + (randn() * 9 + 5) * MIN;
    const e = ds + b * HOUR + (randn() * 16 + 14) * MIN;
    if (rnd() < 0.06) { const mid = s + (e - s) * 0.4; outagesL.push([s, mid], [mid + 4 * MIN, e]); } else outagesL.push([s, e]);
  }
  if (rnd() < 0.13) { const s = ds + rnd() * 22 * HOUR; outagesL.push([s, s + (30 + rnd() * 150) * MIN]); }
}
outagesL.sort((x, y) => x[0] - y[0]);
const merged: [number, number | null][] = [];
for (const [s, e] of outagesL) {
  if (s < trackStartL || s >= nowL) continue;
  const last = merged[merged.length - 1];
  if (last && last[1] !== null && s <= last[1]) { last[1] = Math.max(last[1], e); continue; }
  merged.push([s, e >= nowL ? null : e]);
}

const presetWeek = Array.from({ length: 7 }, (_, i) => {
  const p = PATTERNS[i % 3];
  const s = Array(48).fill('1');
  for (const [a, b] of p) for (let k = a * 2; k < b * 2; k++) s[k] = '2';
  return s.join('');
});

const last = merged[merged.length - 1];
const offline = !!last && last[1] === null;
const data = {
  live: {
    now,
    status: offline ? 'offline' : 'online',
    since: offline ? toEpoch(last![0]) : last ? toEpoch(last[1] as number) : toEpoch(trackStartL),
    lastPing: offline ? toEpoch(last![0]) : now - 9000,
  },
  history: {
    v: 1,
    group: 'GPV6.2',
    generatedAt: now - 3 * MIN,
    trackingSince: toEpoch(trackStartL),
    outages: merged.map(([s, e]) => [Math.round(toEpoch(s) / 1000), e === null ? null : Math.round(toEpoch(e) / 1000)]),
    schedule,
    preset: presetWeek,
  },
};

const outDir = join(root, 'site-preview');
mkdirSync(outDir, { recursive: true });
for (const f of ['styles.css', 'app.js']) copyFileSync(join(root, 'public', f), join(outDir, f));
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8')
  .replace('<script src="app.js" defer></script>', `<script>window.__DATA__=${JSON.stringify(data)}</script>\n  <script src="app.js" defer></script>`);
writeFileSync(join(outDir, 'index.html'), html);
console.log(`site-preview/index.html (${merged.length} outages, ${Object.keys(schedule).length} schedule days)`);

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => p && existsSync(p));
if (!chrome) throw new Error('Chrome/Edge not found, set CHROME_PATH');

const url = pathToFileURL(join(outDir, 'index.html')).href;
// Headless Chrome on Windows won't make a window narrower than ~500px, so emulate a phone with an iframe.
writeFileSync(join(outDir, 'mobile.html'), '<!doctype html><body style="margin:0;background:#888"><iframe src="index.html" style="border:0;width:390px;height:6400px;display:block"></iframe></body>');
const mobileUrl = pathToFileURL(join(outDir, 'mobile.html')).href;
const LIGHT = ['--blink-settings=preferredColorScheme=1'], DARK = ['--force-dark-mode', '--blink-settings=preferredColorScheme=0'];
for (const [name, w, h, extra] of [['desktop', 1280, 4300, LIGHT], ['mobile', 390, 6400, LIGHT], ['dark', 1280, 1500, DARK]] as const) {
  const out = join(root, `site-preview-${name}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${join(outDir, `.profile-${name}`)}`,
    `--window-size=${name === 'mobile' ? 600 : w},${h}`, '--virtual-time-budget=6000', ...extra, `--screenshot=${out}`, name === 'mobile' ? mobileUrl : url,
  ], { stdio: 'ignore' });
  console.log(`site-preview-${name}.png`);
}
