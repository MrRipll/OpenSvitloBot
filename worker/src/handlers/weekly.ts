import { Env } from '../types';
import { getScheduleForWeek } from '../services/schedule-cache';

const DAY_LABELS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'НД'];

interface OutageRow {
  start_time: number;
  end_time: number | null;
}

interface DayOutage {
  startHour: number;
  endHour: number;
  ongoing: boolean;
}

interface DayData {
  date: string;
  dayLabel: string;
  dayDate: string;
  isToday: boolean;
  isFuture: boolean;
  nowHour: number | null;
  outages: DayOutage[];
  schedule: boolean[];
}

function getKyivParts(date: Date): { year: number; month: number; day: number; hours: number; minutes: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';

  const weekdayStr = get('weekday');
  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dow = dowMap[weekdayStr] || 1;

  return {
    year: parseInt(get('year')),
    month: parseInt(get('month')),
    day: parseInt(get('day')),
    hours: parseInt(get('hour')),
    minutes: parseInt(get('minute')),
    dow,
  };
}

function kyivDateStr(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(date);
}

/**
 * Compute the Monday 00:00 Kyiv time for the week containing `now`.
 * Returns start and end (exclusive Sunday 24:00) as epoch ms.
 */
function getWeekBounds(now: Date): { weekStartMs: number; weekEndMs: number; weekStartDate: string; weekEndDate: string } {
  const p = getKyivParts(now);
  // Go back to Monday: subtract (dow - 1) days from today's date
  // Build a date string for Monday in Kyiv
  const todayMs = Date.UTC(p.year, p.month - 1, p.day); // midnight UTC for that calendar date
  const mondayMs = todayMs - (p.dow - 1) * 86400000;
  const sundayMs = mondayMs + 7 * 86400000;

  // Kyiv is UTC+2 or UTC+3. We need the actual epoch for Monday 00:00 Kyiv.
  // Use a reference: the Kyiv offset at 'now' = now.getTime() - todayMs - hours*3600000 - minutes*60000
  const kyivOffsetMs = now.getTime() - todayMs - p.hours * 3600000 - p.minutes * 60000;
  // But we only need approximate for week boundaries (±1h DST won't matter for clipping)
  // Actually: weekStartMs in epoch = mondayMs - kyivOffsetMs... let's think differently.

  // Simpler: just use calendar dates, no need for exact epoch bounds.
  const mondayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(mondayMs));
  const sundayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(sundayMs - 86400000));

  return {
    weekStartMs: mondayMs - kyivOffsetMs,
    weekEndMs: sundayMs - kyivOffsetMs,
    weekStartDate: mondayDate,
    weekEndDate: sundayDate,
  };
}

export async function handleWeekly(env: Env): Promise<Response> {
  const now = new Date();
  const p = getKyivParts(now);
  const todayStr = kyivDateStr(now);

  const { weekStartMs, weekEndMs, weekStartDate } = getWeekBounds(now);

  // Build 7 day dates (Mon..Sun)
  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMs + i * 86400000 + 12 * 3600000); // noon-ish to avoid DST edge
    dayDates.push(kyivDateStr(d));
  }

  // Query outages overlapping the week
  // weekStartMs might be off by an hour, so extend by 1 day for safety
  const safeStart = weekStartMs - 86400000;
  const outages = await env.DB.prepare(
    'SELECT start_time, end_time FROM outages WHERE start_time < ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time'
  )
    .bind(weekEndMs, safeStart)
    .all<OutageRow>();

  const outageRows = outages.results || [];

  // Fetch schedule
  const schedule = await getScheduleForWeek(env.DB, env.OUTAGE_GROUP, weekStartMs, weekEndMs);

  // Build days
  const days: DayData[] = [];
  for (let i = 0; i < 7; i++) {
    const dateStr = dayDates[i];
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr;

    // Day boundaries in epoch ms (approximate, based on weekStartMs + offset)
    const dayStartMs = weekStartMs + i * 86400000;
    const dayEndMs = dayStartMs + 86400000;

    // Clip outages to this day
    const dayOutages: DayOutage[] = [];
    for (const o of outageRows) {
      const oStart = o.start_time;
      const oEnd = o.end_time ?? now.getTime();

      if (oEnd <= dayStartMs || oStart >= dayEndMs) continue;

      const clippedStart = Math.max(oStart, dayStartMs);
      const clippedEnd = Math.min(oEnd, dayEndMs);

      const startHour = Math.round(((clippedStart - dayStartMs) / 3600000) * 100) / 100;
      const endHour = Math.round(((clippedEnd - dayStartMs) / 3600000) * 100) / 100;

      dayOutages.push({
        startHour: Math.max(0, Math.min(24, startHour)),
        endHour: Math.max(0, Math.min(24, endHour)),
        ongoing: o.end_time === null && clippedEnd === oEnd,
      });
    }

    const [mm, dd] = dateStr.split('-').slice(1);

    days.push({
      date: dateStr,
      dayLabel: DAY_LABELS[i],
      dayDate: `${dd}.${mm}`,
      isToday,
      isFuture,
      nowHour: isToday ? Math.round((p.hours + p.minutes / 60) * 100) / 100 : null,
      outages: dayOutages,
      schedule: schedule.get(dateStr) || [],
    });
  }

  const [, sm, sd] = weekStartDate.split('-');
  const lastDate = dayDates[6];
  const [, em, ed] = lastDate.split('-');
  const weekLabel = `${sd}.${sm} - ${ed}.${em}`;

  return new Response(
    JSON.stringify({
      weekLabel,
      now: now.getTime(),
      group: env.OUTAGE_GROUP,
      days,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export { getWeekBounds, getKyivParts, DAY_LABELS };
