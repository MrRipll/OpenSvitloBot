import { Device } from '../types';

const DEFAULT_DEVICE_ID = 'default';

export async function ensureDevice(db: D1Database): Promise<Device> {
  const existing = await db
    .prepare('SELECT * FROM devices WHERE id = ?')
    .bind(DEFAULT_DEVICE_ID)
    .first<Device>();
  if (existing) return existing;

  const now = Date.now();
  await db
    .prepare('INSERT INTO devices (id, name, created_at) VALUES (?, ?, ?)')
    .bind(DEFAULT_DEVICE_ID, 'device', now)
    .run();

  return {
    id: DEFAULT_DEVICE_ID,
    name: 'device',
    group_name: '',
    status: 'unknown',
    last_ping: null,
    last_status_change: null,
    created_at: now,
  };
}

/**
 * Records a ping and, if the device was offline, marks it online and closes its outage — in one
 * transaction, so a crash mid-way can't leave "online" with an open outage. Any outage still open
 * on a ping is closed too (self-heals rows left behind by older, non-atomic code).
 * Returns whether the device came back online and whether any outage was closed.
 */
export async function recordPingAtomic(
  db: D1Database,
  deviceId: string,
  now: number
): Promise<{ recovered: boolean; closedOutages: boolean }> {
  const [status, outages] = await db.batch([
    db.prepare("UPDATE devices SET status = 'online', last_status_change = ?1 WHERE id = ?2 AND status = 'offline'").bind(now, deviceId),
    db.prepare('UPDATE outages SET end_time = ?1, duration = (?1 - start_time) / 1000 WHERE device_id = ?2 AND end_time IS NULL').bind(now, deviceId),
    db.prepare("UPDATE devices SET last_ping = ?1, status = 'online' WHERE id = ?2").bind(now, deviceId),
  ]);
  return { recovered: (status.meta.changes ?? 0) > 0, closedOutages: (outages.meta.changes ?? 0) > 0 };
}

/**
 * Marks a stale device offline and opens an outage, atomically. Does nothing if a ping arrived after
 * `lastPing` was read (race with handlePing), and never opens a second outage while one is open.
 * Returns true if the device actually went offline.
 */
export async function markOfflineAtomic(db: D1Database, deviceId: string, lastPing: number): Promise<boolean> {
  const [status] = await db.batch([
    db.prepare("UPDATE devices SET status = 'offline', last_status_change = ?1 WHERE id = ?2 AND status = 'online' AND last_ping = ?1").bind(lastPing, deviceId),
    db.prepare(
      "INSERT INTO outages (device_id, start_time) SELECT ?2, ?1 WHERE EXISTS (SELECT 1 FROM devices WHERE id = ?2 AND status = 'offline' AND last_status_change = ?1) AND NOT EXISTS (SELECT 1 FROM outages WHERE device_id = ?2 AND end_time IS NULL)"
    ).bind(lastPing, deviceId),
  ]);
  return (status.meta.changes ?? 0) > 0;
}

export async function getStaleOnlineDevices(db: D1Database, thresholdMs: number): Promise<Device[]> {
  const cutoff = Date.now() - thresholdMs;
  const result = await db
    .prepare("SELECT * FROM devices WHERE status = 'online' AND last_ping < ?")
    .bind(cutoff)
    .all<Device>();
  return result.results;
}

