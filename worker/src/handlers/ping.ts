import { Env } from '../types';
import { ensureDevice, recordPing, closeOutage, updateDeviceStatus } from '../services/db';
import { sendMessage, formatRecoveryMessage } from '../services/telegram';
import { fetchSchedule, getNextScheduledOutage } from '../services/schedule';

export async function handlePing(env: Env): Promise<Response> {
  const device = await ensureDevice(env.DB);
  const now = Date.now();
  const wasOffline = device.status === 'offline';

  await recordPing(env.DB, device.id, now);

  if (wasOffline) {
    await updateDeviceStatus(env.DB, device.id, 'online', now);
    await closeOutage(env.DB, device.id, now);

    const offlineDurationMs = device.last_status_change ? now - device.last_status_change : 0;

    let nextOutage: { start: string; end: string } | null = null;
    const schedule = await fetchSchedule(env.OUTAGE_GROUP);
    if (schedule) {
      nextOutage = getNextScheduledOutage(schedule, new Date(now));
    }

    const message = formatRecoveryMessage(new Date(now), offlineDurationMs, nextOutage);
    await sendMessage(env, message);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
