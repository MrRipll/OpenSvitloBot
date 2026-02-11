import { Env } from '../types';
import { sendPhotoBufferGetId, editMessageMediaBuffer } from '../services/telegram';
import { getScheduleForWeek } from '../services/schedule-cache';
import { getWeekBounds, getKyivParts, DAY_LABELS } from '../handlers/weekly';
import { buildWeeklyChartSVG } from '../services/chart-image';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
// @ts-expect-error — wasm asset import
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

let wasmReady = false;

async function svgToPng(svg: string): Promise<Uint8Array> {
  if (!wasmReady) {
    await initWasm(resvgWasm);
    wasmReady = true;
  }
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 680 } });
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

export async function updateWeeklyChart(env: Env): Promise<void> {
  const now = new Date();
  const p = getKyivParts(now);

  const isMonday8AM = p.dow === 1 && p.hours === 8 && p.minutes < 2;
  const isHalfHour = p.minutes < 2 || (p.minutes >= 30 && p.minutes < 32);

  if (!isMonday8AM && !isHalfHour) return;

  // Build the weekly data
  const todayStr = kyivDateStr(now);
  const { weekStartMs, weekEndMs, weekStartDate } = getWeekBounds(now);

  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMs + i * 86400000 + 12 * 3600000);
    dayDates.push(kyivDateStr(d));
  }

  // Query outages
  const safeStart = weekStartMs - 86400000;
  const outageResult = await env.DB.prepare(
    'SELECT start_time, end_time FROM outages WHERE start_time < ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time'
  )
    .bind(weekEndMs, safeStart)
    .all<OutageRow>();
  const outageRows = outageResult.results || [];

  // Fetch schedule
  const schedule = await getScheduleForWeek(env.DB, env.OUTAGE_GROUP, weekStartMs, weekEndMs);

  // Build chart day data
  const chartDays = dayDates.map((dateStr, i) => {
    const isFuture = dateStr > todayStr;
    const isToday = dateStr === todayStr;
    const dayStartMs = weekStartMs + i * 86400000;
    const dayEndMs = dayStartMs + 86400000;

    const outages: { startHour: number; endHour: number }[] = [];
    if (!isFuture) {
      const cutoff = isToday ? now.getTime() : dayEndMs;
      for (const o of outageRows) {
        const oEnd = o.end_time ?? now.getTime();
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

  // Build SVG
  const [, sm, sd] = weekStartDate.split('-');
  const lastDate = dayDates[6];
  const [, em, ed] = lastDate.split('-');
  const weekLabel = `${sd}.${sm} - ${ed}.${em}`;

  const svg = buildWeeklyChartSVG({
    weekLabel,
    group: env.OUTAGE_GROUP,
    days: chartDays,
  });

  // Convert SVG → PNG
  let pngData: Uint8Array;
  try {
    pngData = await svgToPng(svg);
  } catch {
    return;
  }

  // Build caption
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

  if (isMonday8AM) {
    const messageId = await sendPhotoBufferGetId(env, pngData, caption);
    if (messageId) {
      await env.DB.prepare(
        'INSERT INTO telegram_chart (id, message_id, week_start) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET message_id = excluded.message_id, week_start = excluded.week_start'
      )
        .bind(messageId, weekStartMs)
        .run();
    }
  } else {
    const row = await env.DB.prepare('SELECT message_id, week_start FROM telegram_chart WHERE id = 1').first<ChartRow>();
    if (row) {
      await editMessageMediaBuffer(env, row.message_id, pngData, caption);
    }
  }
}
