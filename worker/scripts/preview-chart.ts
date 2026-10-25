// Renders the weekly chart for several mock scenarios with local headless Chrome/Edge
// (same engine as Browser Run in production).
// Usage: node scripts/preview-chart.ts [scenario]   → chart-preview-<scenario>.png
// Set CHROME_PATH if Chrome/Edge isn't in a standard location.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildWeeklyChartSVG, buildChartHTML, CHART_WIDTH, CHART_HEIGHT, type ChartData, type ChartDay,
} from '../src/services/chart-image.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

// Half-hour slots, true = power on per schedule.
function sched(offRanges: [number, number][]): boolean[] {
  const slots = Array(48).fill(true);
  for (const [a, b] of offRanges) for (let s = a * 2; s < b * 2; s++) slots[s] = false;
  return slots;
}

const A = sched([[8, 12], [18, 21.5]]);
const B = sched([[4, 8], [15, 18.5]]);
const C = sched([[0, 3.5], [11, 15], [21.5, 24]]);
const LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

function week(todayIdx: number, nowHour: number, perDay: { schedule?: boolean[]; outages?: ChartDay['outages'] }[]): ChartDay[] {
  return LABELS.map((dayLabel, i) => ({
    dayLabel,
    dayDate: `${String(20 + i).padStart(2, '0')}.10`,
    isToday: i === todayIdx,
    isFuture: i > todayIdx,
    nowHour: i === todayIdx ? nowHour : null,
    schedule: perDay[i]?.schedule ?? [],
    outages: i <= todayIdx ? perDay[i]?.outages ?? [] : [],
  }));
}

const scenarios: Record<string, ChartData> = {
  // Saturday evening, power is back, a busy week.
  typical: {
    weekLabel: '20–26 жовтня',
    group: 'GPV6.2',
    status: { on: true, since: '19:42', durationHours: 0.8 },
    longestOutage: { hours: 4.53, label: 'Чт 11:58–16:30' },
    scheduleHint: 'Наступне відключення за графіком: завтра 04:00–08:00',
    updatedLabel: '25.10 о 20:30',
    days: week(5, 20.5, [
      { schedule: A, outages: [{ startHour: 8.05, endHour: 11.9 }, { startHour: 18.0, endHour: 21.6 }] },
      { schedule: B, outages: [{ startHour: 4.0, endHour: 7.5 }, { startHour: 15.1, endHour: 15.6 }, { startHour: 16.2, endHour: 18.4 }] },
      { schedule: A, outages: [] },
      { schedule: B, outages: [{ startHour: 11.97, endHour: 16.5 }, { startHour: 22.5, endHour: 24 }] },
      { schedule: A, outages: [{ startHour: 0, endHour: 1.2 }, { startHour: 8.0, endHour: 12.0 }, { startHour: 18.3, endHour: 21.0 }] },
      { schedule: B, outages: [{ startHour: 4.1, endHour: 8.0 }, { startHour: 15.0, endHour: 19.7 }] },
      { schedule: A },
    ]),
  },

  // Wednesday midday, power is out right now (ongoing outage), worse than schedule.
  'off-now': {
    weekLabel: '20–26 жовтня',
    group: 'GPV6.2',
    status: { on: false, since: '10:47', durationHours: 2.47 },
    longestOutage: { hours: 6.1, label: 'Вт 13:10–19:16' },
    scheduleHint: 'За графіком світло мають дати о 15:00',
    updatedLabel: '22.10 о 13:15',
    days: week(2, 13.25, [
      { schedule: C, outages: [{ startHour: 0, endHour: 3.6 }, { startHour: 10.9, endHour: 15.3 }, { startHour: 21.4, endHour: 24 }] },
      { schedule: C, outages: [{ startHour: 0, endHour: 4.1 }, { startHour: 13.17, endHour: 19.27 }, { startHour: 21.5, endHour: 24 }] },
      { schedule: C, outages: [{ startHour: 0, endHour: 3.5 }, { startHour: 10.78, endHour: 13.25, ongoing: true }] },
      { schedule: C },
      { schedule: A },
    ]),
  },

  // Monday morning, no schedule published, no outages yet.
  'quiet-monday': {
    weekLabel: '27 жовтня – 2 листопада',
    group: 'GPV6.2',
    status: { on: true, since: '24.10 21:00', durationHours: 60.5 },
    longestOutage: null,
    scheduleHint: null,
    updatedLabel: '27.10 о 09:30',
    days: week(0, 9.5, []).map((d, i) => ({ ...d, dayDate: i < 5 ? `${27 + i}.10` : `0${i - 4}.11` })),
  },
};

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => p && existsSync(p));
if (!chrome) throw new Error('Chrome/Edge not found, set CHROME_PATH');

const tmp = mkdtempSync(join(tmpdir(), 'chart-preview-'));
const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(scenarios);
for (const name of wanted) {
  const data = scenarios[name];
  if (!data) throw new Error(`unknown scenario "${name}", have: ${Object.keys(scenarios).join(', ')}`);
  const html = join(tmp, `${name}.html`);
  writeFileSync(html, buildChartHTML(buildWeeklyChartSVG(data)));
  const out = join(root, `chart-preview-${name}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${join(tmp, 'profile')}`,
    `--window-size=${CHART_WIDTH},${CHART_HEIGHT}`, '--force-device-scale-factor=1.6',
    '--virtual-time-budget=5000', `--screenshot=${out}`, pathToFileURL(html).href,
  ], { stdio: 'ignore' });
  console.log(`chart-preview-${name}.png`);
}
