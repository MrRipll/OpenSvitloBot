import { parseDay } from './schedule';

const SCHEDULE_URL = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/refs/heads/main/data/kyiv-region.json';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface ScheduleData {
  fact: {
    data: Record<string, Record<string, Record<string, string>>>;
    today: number;
  };
}

interface CacheRow {
  data: string;
  fetched_at: number;
}

export async function getCachedSchedule(db: D1Database): Promise<ScheduleData | null> {
  const row = await db.prepare('SELECT data, fetched_at FROM schedule_cache WHERE id = 1').first<CacheRow>();

  if (row && Date.now() - row.fetched_at < CACHE_TTL_MS) {
    try {
      return JSON.parse(row.data) as ScheduleData;
    } catch {
      // corrupted cache, re-fetch
    }
  }

  try {
    const resp = await fetch(SCHEDULE_URL);
    if (!resp.ok) return null;
    const text = await resp.text();
    const data: ScheduleData = JSON.parse(text);

    await db
      .prepare(
        'INSERT INTO schedule_cache (id, data, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at'
      )
      .bind(text, Date.now())
      .run();

    return data;
  } catch {
    return null;
  }
}

/**
 * Returns a Map from YYYY-MM-DD (Kyiv date) to 48 boolean slots for each day
 * in the range [weekStartMs, weekEndMs).
 */
export async function getScheduleForWeek(
  db: D1Database,
  group: string,
  weekStartMs: number,
  weekEndMs: number
): Promise<Map<string, boolean[]>> {
  const result = new Map<string, boolean[]>();
  const data = await getCachedSchedule(db);
  if (!data) return result;

  const days = data.fact.data;
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' });

  // Build set of Kyiv dates we need
  const neededDates = new Set<string>();
  for (let ms = weekStartMs; ms < weekEndMs; ms += 86400000) {
    neededDates.add(dateFmt.format(new Date(ms)));
  }

  // Iterate all day keys in schedule data (unix timestamps)
  for (const dayKey of Object.keys(days)) {
    const ts = Number(dayKey) * 1000; // schedule keys are in seconds
    const kyivDate = dateFmt.format(new Date(ts));
    if (neededDates.has(kyivDate) && days[dayKey][group]) {
      result.set(kyivDate, parseDay(days[dayKey][group]));
    }
  }

  return result;
}
