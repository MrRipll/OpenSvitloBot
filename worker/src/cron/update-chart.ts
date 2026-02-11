import { Env } from '../types';
import { sendPhotoBufferGetId, editMessageMediaBuffer } from '../services/telegram';
import { getScheduleForWeek } from '../services/schedule-cache';
import { getWeekBounds, getKyivParts, DAY_LABELS } from '../handlers/weekly';
import { buildWeeklyChartSVG } from '../services/chart-image';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
// @ts-expect-error — wasm asset import
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

// @ts-expect-error — binary asset import
import fontLatin from '../../assets/inter-latin-400.ttf';
// @ts-expect-error — binary asset import
import fontCyrillic from '../../assets/inter-cyrillic-400.ttf';

let wasmReady = false;

async function svgToPng(svg: string): Promise<Uint8Array> {
  if (!wasmReady) {
    await initWasm(resvgWasm);
    wasmReady = true;
  }
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1440 },
    font: {
      fontBuffers: [new Uint8Array(fontLatin), new Uint8Array(fontCyrillic)],
      defaultFontFamily: 'Inter',
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

interface OutageRow {
  start_time: number;
  end_time: number | null;
}

interface ChartRow {
  message_id: number;
  week_start: number;
}

function kyivDateStr(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(date);
}

interface ChartResult {
  pngData: Uint8Array;
  caption: string;
  weekStartMs: number;
}

async function buildChart(env: Env, refDate: Date): Promise<ChartResult | null> {
  const p = getKyivParts(refDate);
  const refDateStr = kyivDateStr(refDate);
  const { weekStartMs, weekEndMs, weekStartDate } = getWeekBounds(refDate);

  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMs + i * 86400000 + 12 * 3600000);
    dayDates.push(kyivDateStr(d));
  }

  const safeStart = weekStartMs - 86400000;
  const outageResult = await env.DB.prepare(
    'SELECT start_time, end_time FROM outages WHERE start_time < ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time'
  )
    .bind(weekEndMs, safeStart)
    .all<OutageRow>();
  const outageRows = outageResult.results || [];

  const schedule = await getScheduleForWeek(env.DB, env.OUTAGE_GROUP, weekStartMs, weekEndMs);

  const chartDays = dayDates.map((dateStr, i) => {
    const dayStartMs = weekStartMs + i * 86400000;
    const dayEndMs = dayStartMs + 86400000;

    const isToday = dateStr === refDateStr;
    const isFuture = dateStr > refDateStr;

    const outages: { startHour: number; endHour: number }[] = [];
    if (!isFuture) {
      const cutoff = isToday ? refDate.getTime() : dayEndMs;
      for (const o of outageRows) {
        const oEnd = o.end_time ?? refDate.getTime();
        if (oEnd <= dayStartMs || o.start_time >= cutoff) continue;
        const s = Math.max(o.start_time, dayStartMs);
        const e = Math.min(oEnd, cutoff);
        outages.push({
          startHour: Math.max(0, (s - dayStartMs) / 3600000),
          endHour: Math.min(24, (e - dayStartMs) / 3600000),
        });
      }
    }

    const [, mm, dd] = dateStr.split('-');
    return {
      dayLabel: DAY_LABELS[i],
      dayDate: `${dd}.${mm}`,
      isToday,
      isFuture,
      nowHour: isToday ? p.hours + p.minutes / 60 : null,
      outages,
      schedule: schedule.get(dateStr) || [],
    };
  });

  const [, sm, sd] = weekStartDate.split('-');
  const lastDate = dayDates[6];
  const [, em, ed] = lastDate.split('-');
  const weekLabel = `${sd}.${sm} - ${ed}.${em}`;

  const svg = buildWeeklyChartSVG({
    weekLabel,
    group: env.OUTAGE_GROUP,
    days: chartDays,
  });

  let pngData: Uint8Array;
  try {
    pngData = await svgToPng(svg);
  } catch {
    return null;
  }

  let totalOutageHours = 0;
  let totalOutages = 0;
  for (const day of chartDays) {
    for (const o of day.outages) {
      totalOutageHours += o.endHour - o.startHour;
      totalOutages++;
    }
  }
  const caption =
    `<b>Тижневий графік відключень</b>\n` +
    `Група: ${env.OUTAGE_GROUP}\n` +
    `Відключень: ${totalOutages}, всього ${Math.round(totalOutageHours * 10) / 10} год\n` +
    `🟢 є світло  🔴 немає  🟡 графік увімк  ⬛ графік вимк`;

  return { pngData, caption, weekStartMs };
}

export async function updateWeeklyChart(env: Env): Promise<void> {
  const now = new Date();
  const { minutes } = getKyivParts(now);
  if (minutes % 10 !== 0) return;

  const { weekStartMs } = getWeekBounds(now);
  const chart = await buildChart(env, now);
  if (!chart) return;

  const row = await env.DB.prepare('SELECT message_id, week_start FROM telegram_chart WHERE id = 1').first<ChartRow>();

  // Same week — just edit
  if (row && row.week_start === weekStartMs) {
    await editMessageMediaBuffer(env, row.message_id, chart.pngData, chart.caption);
    return;
  }

  // New week or first run — send new message
  const messageId = await sendPhotoBufferGetId(env, chart.pngData, chart.caption);
  if (messageId) {
    await env.DB.prepare(
      'INSERT INTO telegram_chart (id, message_id, week_start) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET message_id = excluded.message_id, week_start = excluded.week_start'
    )
      .bind(messageId, weekStartMs)
      .run();
  }
}
