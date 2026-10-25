import { Env } from '../types';

/**
 * Public analytics data for the site (public/index.html).
 *
 * The full history is serialized once into public_cache('history') by the cron, only when something
 * changed (an outage started/ended or the schedule was updated), so a page view costs two D1 row reads
 * and a string concat — no per-request aggregation, which keeps us far below the Free plan limits.
 * All analytics are computed in the visitor's browser.
 *
 * Body format (v1):
 *   { v, group, generatedAt, trackingSince,
 *     outages: [[startSec, endSec | null], ...],
 *     schedule: { "YYYY-MM-DD": "48 chars, 1 = power on, 0 = off" },
 *     preset: ["48 chars per weekday Mon..Sun, 1 = on, 0 = off, 2 = possible outage"] | null,
 *     excluded: [[startSec, endSec], ...] — no reliable data (sensor down etc.), ignored by stats }
 */

const HISTORY_KEY = 'history';
const PRESET_KEY = 'preset';

/** Flag the history for rebuild on the next eligible cron tick. */
export async function markPublicHistoryDirty(db: D1Database): Promise<void> {
  await db
    .prepare(
      "INSERT INTO public_cache (key, body, dirty, updated_at) VALUES (?, '', 1, 0) ON CONFLICT(key) DO UPDATE SET dirty = 1"
    )
    .bind(HISTORY_KEY)
    .run();
}

/** Stores the weekly "possible outages" template; returns true if it changed. */
export async function savePreset(db: D1Database, preset: string[]): Promise<boolean> {
  const res = await db
    .prepare(
      'INSERT INTO public_cache (key, body, dirty, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at WHERE public_cache.body != excluded.body'
    )
    .bind(PRESET_KEY, JSON.stringify(preset), Date.now())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Rebuilds the cached history if it is missing or flagged dirty. */
export async function refreshPublicHistory(env: Env): Promise<void> {
  const row = await env.DB.prepare('SELECT dirty FROM public_cache WHERE key = ?').bind(HISTORY_KEY).first<{ dirty: number }>();
  if (row && !row.dirty) return;

  const [outages, schedule, preset, device, excluded] = await Promise.all([
    env.DB.prepare('SELECT start_time, end_time FROM outages ORDER BY start_time').all<{ start_time: number; end_time: number | null }>(),
    env.DB.prepare('SELECT date, slots FROM schedule_days WHERE group_name = ? ORDER BY date').bind(env.OUTAGE_GROUP).all<{ date: string; slots: string }>(),
    env.DB.prepare('SELECT body FROM public_cache WHERE key = ?').bind(PRESET_KEY).first<{ body: string }>(),
    env.DB.prepare('SELECT created_at FROM devices ORDER BY created_at LIMIT 1').first<{ created_at: number }>(),
    env.DB.prepare('SELECT start_time, end_time FROM excluded_periods ORDER BY start_time').all<{ start_time: number; end_time: number }>(),
  ]);

  const sched: Record<string, string> = {};
  for (const r of schedule.results) {
    try {
      sched[r.date] = (JSON.parse(r.slots) as boolean[]).map(on => (on ? '1' : '0')).join('');
    } catch {
      // skip corrupted rows
    }
  }

  const body = JSON.stringify({
    v: 1,
    group: env.OUTAGE_GROUP,
    generatedAt: Date.now(),
    trackingSince: device?.created_at ?? null,
    outages: outages.results.map(o => [Math.round(o.start_time / 1000), o.end_time === null ? null : Math.round(o.end_time / 1000)]),
    schedule: sched,
    preset: preset?.body ? JSON.parse(preset.body) : null,
    excluded: excluded.results.map(e => [Math.round(e.start_time / 1000), Math.round(e.end_time / 1000)]),
  });

  await env.DB.prepare(
    'INSERT INTO public_cache (key, body, dirty, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, dirty = 0, updated_at = excluded.updated_at'
  )
    .bind(HISTORY_KEY, body, Date.now())
    .run();
}

/** GET /api/public/history — no auth; cached history + live device status. */
export async function handlePublicHistory(env: Env): Promise<Response> {
  const [history, device] = await Promise.all([
    env.DB.prepare('SELECT body FROM public_cache WHERE key = ?').bind(HISTORY_KEY).first<{ body: string }>(),
    env.DB.prepare('SELECT status, last_ping, last_status_change FROM devices ORDER BY created_at LIMIT 1').first<{
      status: string;
      last_ping: number | null;
      last_status_change: number | null;
    }>(),
  ]);

  const live = JSON.stringify({
    now: Date.now(),
    status: device?.status ?? 'unknown',
    since: device?.last_status_change ?? null,
    lastPing: device?.last_ping ?? null,
  });
  // The cached body is already JSON — splice it in instead of parsing and re-serializing.
  const body = `{"live":${live},"history":${history?.body || 'null'}}`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30',
    },
  });
}
