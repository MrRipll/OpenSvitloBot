import { Env } from '../types';
import { sendPhotoBufferGetId, editMessageMediaBuffer, pinChatMessage, unpinChatMessage } from '../services/telegram';
import { getScheduleForWeek } from '../services/schedule-cache';
import { getScheduledRestoration, getNextScheduledOutage } from '../services/schedule';
import { getWeekBounds, getKyivParts } from '../handlers/weekly';
import { buildWeeklyChartSVG, ChartData, fmtDur, fmtClock } from '../services/chart-image';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
// @ts-expect-error — wasm asset import
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

// @ts-expect-error — binary asset import
import fontLatin400 from '../../assets/inter-latin-400.ttf';
// @ts-expect-error — binary asset import
import fontCyrillic400 from '../../assets/inter-cyrillic-400.ttf';
// @ts-expect-error — binary asset import
import fontLatin600 from '../../assets/inter-latin-600.ttf';
// @ts-expect-error — binary asset import
import fontCyrillic600 from '../../assets/inter-cyrillic-600.ttf';

/**
 * The chart's notion of "now" advances in steps of this many minutes, so the SVG
 * (and its hash) stays identical between steps and the expensive PNG render is skipped.
 * Status changes (outage start/end) bypass the step and re-render on the next cron tick.
 */
const CHART_STEP_MIN = 15;

/** Output PNG width. Telegram downsizes photos anyway, so more pixels only cost CPU. */
const PNG_WIDTH = 1280;

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const MONTHS_GEN = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

let wasmInit: Promise<void> | null = null;
let fontBuffers: Uint8Array[] | null = null;

async function svgToPng(svg: string): Promise<Uint8Array> {
  if (!wasmInit) wasmInit = initWasm(resvgWasm);
  await wasmInit;
  if (!fontBuffers) {
    fontBuffers = [fontLatin400, fontCyrillic400, fontLatin600, fontCyrillic600].map(f => new Uint8Array(f));
  }
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: PNG_WIDTH },
    font: {
      fontBuffers,
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  rendered.free();
  resvg.free();
  return png;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

interface OutageRow {
  start_time: number;
  end_time: number | null;
}

interface DeviceRow {
  status: string;
  last_status_change: number | null;
}

interface ChartRow {
  message_id: number;
  week_start: number;
  hash: string | null;
  pinned: number;
}

const kyivDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' });

function kyivDateStr(date: Date): string {
  return kyivDateFmt.format(date);
}

function kyivClock(ms: number): string {
  const p = getKyivParts(new Date(ms));
  return fmtClock(p.hours + p.minutes / 60);
}

function weekLabel(startDate: string, endDate: string): string {
  const [, sm, sd] = startDate.split('-').map(Number);
  const [, em, ed] = endDate.split('-').map(Number);
  if (sm === em) return `${sd}–${ed} ${MONTHS_GEN[em - 1]}`;
  return `${sd} ${MONTHS_GEN[sm - 1]} – ${ed} ${MONTHS_GEN[em - 1]}`;
}

interface ChartResult {
  svg: string;
  caption: string;
  weekStartMs: number;
}

interface ChartInputs {
  weekStartMs: number;
  outageRows: OutageRow[];
  device: DeviceRow | null;
  schedule: Map<string, boolean[]>;
  /** The chart's "now": quantized to CHART_STEP_MIN, or the last status change if more recent. */
  refMs: number;
}

/** Bump when the chart layout/caption changes, so existing charts are re-rendered after deploy. */
const CHART_VERSION = 2;

async function loadChartInputs(env: Env, now: Date): Promise<ChartInputs> {
  const { weekStartMs, weekEndMs } = getWeekBounds(now);

  const [outageResult, device, schedule] = await Promise.all([
    env.DB.prepare(
      'SELECT start_time, end_time FROM outages WHERE (end_time > ? OR end_time IS NULL) AND start_time < ? ORDER BY start_time'
    )
      .bind(weekStartMs, weekEndMs)
      .all<OutageRow>(),
    env.DB.prepare('SELECT status, last_status_change FROM devices ORDER BY created_at LIMIT 1').first<DeviceRow>(),
    // One extra day so "tomorrow" is known on Sundays too.
    getScheduleForWeek(env.DB, env.OUTAGE_GROUP, weekStartMs, weekEndMs + 86400000),
  ]);
  const outageRows = outageResult.results || [];

  // Quantize "now" so the picture only changes every CHART_STEP_MIN minutes,
  // unless the power status changed since the last step.
  const stepMs = CHART_STEP_MIN * 60000;
  let refMs = Math.floor(now.getTime() / stepMs) * stepMs;
  if (device?.last_status_change && device.last_status_change > refMs && device.last_status_change <= now.getTime()) {
    refMs = device.last_status_change;
  }
  return { weekStartMs, outageRows, device, schedule, refMs };
}

/** Everything the picture depends on. Hashing this is far cheaper than building the SVG every minute. */
function inputKey(env: Env, inp: ChartInputs): string {
  return JSON.stringify([
    CHART_VERSION, env.OUTAGE_GROUP, inp.weekStartMs, inp.refMs,
    inp.outageRows, inp.device, [...inp.schedule.entries()],
  ]);
}

function buildChart(env: Env, inp: ChartInputs): ChartResult {
  const { weekStartMs, outageRows, device, schedule, refMs } = inp;
  const ref = new Date(refMs);
  const refParts = getKyivParts(ref);
  const refDateStr = kyivDateStr(ref);

  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dayDates.push(kyivDateStr(new Date(weekStartMs + i * 86400000 + 12 * 3600000)));
  }

  const days: ChartData['days'] = dayDates.map((dateStr, i) => {
    const dayStartMs = weekStartMs + i * 86400000;
    const dayEndMs = dayStartMs + 86400000;
    const isToday = dateStr === refDateStr;
    const isFuture = dateStr > refDateStr;

    const outages: ChartData['days'][number]['outages'] = [];
    if (!isFuture) {
      const cutoff = isToday ? refMs : dayEndMs;
      for (const o of outageRows) {
        const oEnd = o.end_time ?? refMs;
        if (oEnd <= dayStartMs || o.start_time >= cutoff) continue;
        const s = Math.max(o.start_time, dayStartMs);
        const e = Math.min(oEnd, cutoff);
        outages.push({
          startHour: Math.max(0, (s - dayStartMs) / 3600000),
          endHour: Math.min(24, (e - dayStartMs) / 3600000),
          ongoing: o.end_time === null && isToday,
        });
      }
    }

    const [, mm, dd] = dateStr.split('-');
    return {
      dayLabel: DAY_NAMES[i],
      dayDate: `${dd}.${mm}`,
      isToday,
      isFuture,
      nowHour: isToday ? refParts.hours + refParts.minutes / 60 : null,
      outages,
      schedule: schedule.get(dateStr) || [],
    };
  });

  // Longest outage of the week (not split at midnight).
  let longestOutage: ChartData['longestOutage'] = null;
  for (const o of outageRows) {
    const s = Math.max(o.start_time, weekStartMs);
    const e = Math.min(o.end_time ?? refMs, refMs);
    if (e <= s) continue;
    const hours = (e - s) / 3600000;
    if (!longestOutage || hours > longestOutage.hours) {
      const dayName = DAY_NAMES[Math.min(6, Math.floor((s - weekStartMs) / 86400000))];
      const label = o.end_time === null
        ? `${dayName} з ${kyivClock(s)}, триває`
        : `${dayName} ${kyivClock(s)}–${kyivClock(e)}`;
      longestOutage = { hours, label };
    }
  }

  // Live status.
  let status: ChartData['status'] = null;
  if (device && (device.status === 'online' || device.status === 'offline')) {
    const since = device.last_status_change;
    let sinceLabel: string | null = null;
    if (since) {
      const sinceDate = kyivDateStr(new Date(since));
      const [, m, d] = sinceDate.split('-');
      sinceLabel = sinceDate === refDateStr ? kyivClock(since) : `${d}.${m} ${kyivClock(since)}`;
    }
    status = {
      on: device.status === 'online',
      since: sinceLabel,
      durationHours: since ? Math.max(0, (refMs - since) / 3600000) : null,
    };
  }

  // Schedule hint for the footer and caption.
  const todaySched = schedule.get(refDateStr);
  const tomorrowSched = schedule.get(kyivDateStr(new Date(refMs + 86400000)));
  let scheduleHint: string | null = null;
  if (todaySched) {
    const slots = tomorrowSched ? [todaySched, tomorrowSched] : [todaySched];
    if (status && !status.on) {
      const back = getScheduledRestoration(slots, ref);
      if (back) scheduleHint = `За графіком світло мають дати ${back.startsWith('завтра') ? back : `о ${back}`}`;
    } else {
      const next = getNextScheduledOutage(slots, ref);
      scheduleHint = next
        ? `Наступне відключення за графіком: ${next.startsTomorrow ? 'завтра ' : ''}${next.start}–${next.end}`
        : 'За графіком відключень найближчим часом немає';
    }
  }

  const label = weekLabel(dayDates[0], dayDates[6]);
  const svg = buildWeeklyChartSVG({
    weekLabel: label,
    group: env.OUTAGE_GROUP,
    days,
    status,
    longestOutage,
    scheduleHint,
    updatedLabel: `${refDateStr.slice(8, 10)}.${refDateStr.slice(5, 7)} о ${fmtClock(refParts.hours + refParts.minutes / 60)}`,
  });

  const lines = [`<b>Світло за тиждень · ${label}</b>`];
  if (status) {
    const dur = status.durationHours !== null ? ` вже ${fmtDur(status.durationHours)}` : '';
    lines.push(status.on ? `🟢 Світло є${dur}` : `🔴 Світла немає${dur}`);
  }
  if (scheduleHint) lines.push(`🗓 ${scheduleHint}`);

  return { svg, caption: lines.join('\n'), weekStartMs };
}

/** Silently pin the chart message so the current week is always in the chat header. */
async function pinChart(env: Env, messageId: number): Promise<void> {
  const res = await pinChatMessage(env, messageId);
  if (!res.ok) {
    // Retried on the next cron tick while `pinned` stays 0.
    console.error('chart pin failed', res.error);
    return;
  }
  await env.DB.prepare('UPDATE telegram_chart SET pinned = 1 WHERE id = 1 AND message_id = ?').bind(messageId).run();
}

export async function updateWeeklyChart(env: Env): Promise<void> {
  const inputs = await loadChartInputs(env, new Date());

  // Skip SVG build, PNG render and Telegram upload if none of the inputs changed.
  // The hash lives in D1 so it survives isolate restarts (cron often runs on a fresh isolate).
  const hash = await sha256(inputKey(env, inputs));
  const row = await env.DB.prepare('SELECT message_id, week_start, hash, pinned FROM telegram_chart WHERE id = 1').first<ChartRow>();
  const sameWeek = !!row && row.week_start === inputs.weekStartMs;

  // Also covers charts posted before pinning existed, and earlier failed pins.
  if (sameWeek && !row!.pinned) await pinChart(env, row!.message_id);

  if (sameWeek && row!.hash === hash) return;

  const chart = buildChart(env, inputs);

  let png: Uint8Array;
  try {
    png = await svgToPng(chart.svg);
  } catch (err) {
    console.error('chart render failed', err);
    return;
  }

  if (sameWeek) {
    const res = await editMessageMediaBuffer(env, row!.message_id, png, chart.caption);
    if (res.ok || res.error?.includes('not modified')) {
      await env.DB.prepare('UPDATE telegram_chart SET hash = ? WHERE id = 1').bind(hash).run();
      return;
    }
    console.error('chart edit failed', res.error);
    // The message is gone (deleted by an admin etc.) — post a fresh one below.
    if (!res.error?.includes('not found')) return;
  }

  const messageId = await sendPhotoBufferGetId(env, png, chart.caption);
  if (!messageId) return;

  await env.DB.prepare(
    'INSERT INTO telegram_chart (id, message_id, week_start, hash, pinned) VALUES (1, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET message_id = excluded.message_id, week_start = excluded.week_start, hash = excluded.hash, pinned = 0'
  )
    .bind(messageId, chart.weekStartMs, hash)
    .run();

  // Pin the new chart first, then unpin the old one, so the header is never empty.
  await pinChart(env, messageId);
  if (row && row.message_id !== messageId) {
    const res = await unpinChatMessage(env, row.message_id);
    if (!res.ok) console.error('old chart unpin failed', res.error);
  }
}
