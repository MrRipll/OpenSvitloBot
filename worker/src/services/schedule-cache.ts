import { parseDay } from './schedule';
import { markPublicHistoryDirty, savePreset } from './public-history';

const SCHEDULE_URL = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/refs/heads/main/data/kyiv-region.json';

interface ScheduleData {
  fact: {
    data: Record<string, Record<string, Record<string, string>>>;
    today: number;
  };
  /** Weekly template of possible outages: data[group][weekday 1..7][hour 1..24]. */
  preset?: {
    data?: Record<string, Record<string, Record<string, string>>>;
  };
}

/** Preset hour value → two half-hour slots: 1 = on, 0 = off, 2 = possible outage. */
const PRESET_SLOTS: Record<string, string> = {
  yes: '11', no: '00', maybe: '22',
  first: '01', second: '10', mfirst: '21', msecond: '12',
};

function parsePreset(week: Record<string, Record<string, string>> | undefined): string[] | null {
  if (!week) return null;
  const days: string[] = [];
  for (let d = 1; d <= 7; d++) {
    const day = week[String(d)];
    if (!day) return null;
    let s = '';
    for (let h = 1; h <= 24; h++) s += PRESET_SLOTS[day[String(h)]] ?? '11';
    days.push(s);
  }
  return days;
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

  const upsert = db.prepare(
    'INSERT INTO schedule_days (date, group_name, slots, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(date, group_name) DO UPDATE SET slots = excluded.slots, updated_at = excluded.updated_at WHERE schedule_days.slots != excluded.slots'
  );
  const statements: D1PreparedStatement[] = [];
  for (const dayKey of Object.keys(days)) {
    if (!days[dayKey][group]) continue;

    const slots = parseDay(days[dayKey][group]);
    const date = dateFmt.format(new Date(Number(dayKey) * 1000));
    statements.push(upsert.bind(date, group, JSON.stringify(slots), now));
  }

  let changed = false;
  if (statements.length > 0) {
    const results = await db.batch(statements);
    changed = results.some(r => (r.meta.changes ?? 0) > 0);
  }

  const preset = parsePreset(data.preset?.data?.[group]);
  if (preset && (await savePreset(db, preset))) changed = true;

  if (changed) await markPublicHistoryDirty(db);
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
