import { parseDay } from './schedule';

const SCHEDULE_URL = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/refs/heads/main/data/kyiv-region.json';

interface ScheduleData {
  fact: {
    data: Record<string, Record<string, Record<string, string>>>;
    today: number;
  };
}

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' });

/**
 * Fetch schedule from external API and upsert all available days
 * into the schedule_days table. Called from cron every 5 minutes.
 */
export async function refreshScheduleCache(db: D1Database, group: string): Promise<void> {
  const resp = await fetch(SCHEDULE_URL);
  if (!resp.ok) return;

  const data: ScheduleData = await resp.json();
  const days = data.fact.data;
  const now = Date.now();

  for (const dayKey of Object.keys(days)) {
    if (!days[dayKey][group]) continue;

    const slots = parseDay(days[dayKey][group]);
    const ts = Number(dayKey);
    const date = dateFmt.format(new Date(ts * 1000));

    await db
      .prepare(
        'INSERT INTO schedule_days (date, group_name, slots, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(date, group_name) DO UPDATE SET slots = excluded.slots, updated_at = excluded.updated_at'
      )
      .bind(date, group, JSON.stringify(slots), now)
      .run();
  }
}

/**
 * Returns a Map from YYYY-MM-DD (Kyiv date) to 48 boolean slots
 * for each day in the range [weekStartMs, weekEndMs).
 * Reads from the schedule_days table (historical data).
 */
export async function getScheduleForWeek(
  db: D1Database,
  group: string,
  weekStartMs: number,
  weekEndMs: number
): Promise<Map<string, boolean[]>> {
  const result = new Map<string, boolean[]>();

  const dates: string[] = [];
  for (let ms = weekStartMs; ms < weekEndMs; ms += 86400000) {
    dates.push(dateFmt.format(new Date(ms)));
  }

  if (dates.length === 0) return result;

  const placeholders = dates.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT date, slots FROM schedule_days WHERE group_name = ? AND date IN (${placeholders})`
    )
    .bind(group, ...dates)
    .all<{ date: string; slots: string }>();

  for (const row of rows.results) {
    try {
      result.set(row.date, JSON.parse(row.slots));
    } catch {
      // skip corrupted rows
    }
  }

  return result;
}
