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

export async function getStaleOnlineDevices(db: D1Database, thresholdMs: number): Promise<Device[]> {
  const cutoff = Date.now() - thresholdMs;
  const result = await db
    .prepare("SELECT * FROM devices WHERE status = 'online' AND last_ping < ?")
    .bind(cutoff)
    .all<Device>();
  return result.results;
}

