import { Device, Outage } from '../types';

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

export async function getDeviceById(db: D1Database, id: string): Promise<Device | null> {
  return db.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first<Device>();
}

export async function getAllDevices(db: D1Database): Promise<Device[]> {
  const result = await db.prepare('SELECT * FROM devices ORDER BY group_name, name').all<Device>();
  return result.results;
}

export async function updateDeviceStatus(
  db: D1Database,
  deviceId: string,
  status: string,
  now: number
): Promise<void> {
  await db
    .prepare('UPDATE devices SET status = ?, last_status_change = ? WHERE id = ?')
    .bind(status, now, deviceId)
    .run();
}

export async function recordPing(db: D1Database, deviceId: string, now: number): Promise<void> {
  await db
    .prepare('UPDATE devices SET last_ping = ?, status = ? WHERE id = ?')
    .bind(now, 'online', deviceId)
    .run();
  await db
    .prepare('INSERT INTO pings (device_id, timestamp) VALUES (?, ?)')
    .bind(deviceId, now)
    .run();
}

export async function createOutage(db: D1Database, deviceId: string, startTime: number): Promise<void> {
  await db
    .prepare('INSERT INTO outages (device_id, start_time) VALUES (?, ?)')
    .bind(deviceId, startTime)
    .run();
}

export async function closeOutage(db: D1Database, deviceId: string, endTime: number): Promise<void> {
  const outage = await db
    .prepare('SELECT * FROM outages WHERE device_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1')
    .bind(deviceId)
    .first<Outage>();

  if (outage) {
    const duration = Math.floor((endTime - outage.start_time) / 1000);
    await db
      .prepare('UPDATE outages SET end_time = ?, duration = ? WHERE id = ?')
      .bind(endTime, duration, outage.id)
      .run();
  }
}

export async function getOutages(db: D1Database, days: number): Promise<(Outage & { device_name: string; device_group: string })[]> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const result = await db
    .prepare(
      `SELECT o.*, d.name as device_name, d.group_name as device_group
       FROM outages o JOIN devices d ON o.device_id = d.id
       WHERE o.start_time > ?
       ORDER BY o.start_time DESC`
    )
    .bind(since)
    .all<Outage & { device_name: string; device_group: string }>();
  return result.results;
}

export async function getStaleOnlineDevices(db: D1Database, thresholdMs: number): Promise<Device[]> {
  const cutoff = Date.now() - thresholdMs;
  const result = await db
    .prepare("SELECT * FROM devices WHERE status = 'online' AND last_ping < ?")
    .bind(cutoff)
    .all<Device>();
  return result.results;
}

export async function getStats(
  db: D1Database,
  periodDays: number
): Promise<{ device_id: string; device_name: string; group_name: string; total_outage_seconds: number; outage_count: number }[]> {
  const since = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const query = `
    SELECT d.id as device_id, d.name as device_name, d.group_name,
           COALESCE(SUM(o.duration), 0) as total_outage_seconds,
           COUNT(o.id) as outage_count
    FROM devices d
    LEFT JOIN outages o ON d.id = o.device_id AND o.start_time > ? AND o.duration IS NOT NULL
    GROUP BY d.id ORDER BY d.group_name, d.name
  `;

  const result = await db.prepare(query).bind(since).all<{
    device_id: string;
    device_name: string;
    group_name: string;
    total_outage_seconds: number;
    outage_count: number;
  }>();
  return result.results;
}
