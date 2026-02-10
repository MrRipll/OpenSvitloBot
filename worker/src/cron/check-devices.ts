import { Env } from '../types';
import { getStaleOnlineDevices, updateDeviceStatus, createOutage } from '../services/db';
import { sendMessage, formatOutageMessage } from '../services/telegram';
import { fetchSchedule, getScheduledRestoration } from '../services/schedule';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function checkDevices(env: Env): Promise<void> {
  const staleDevices = await getStaleOnlineDevices(env.DB, STALE_THRESHOLD_MS);

  for (const device of staleDevices) {
    const now = Date.now();

    await updateDeviceStatus(env.DB, device.id, 'offline', now);
    await createOutage(env.DB, device.id, now);

    const onlineDurationMs = device.last_status_change ? now - device.last_status_change : 0;

    let scheduledRestoration: string | null = null;
    const schedule = await fetchSchedule(env.OUTAGE_GROUP);
    if (schedule) {
      scheduledRestoration = getScheduledRestoration(schedule, new Date(now));
    }

    const message = formatOutageMessage(new Date(now), onlineDurationMs, scheduledRestoration);
    await sendMessage(env, message);
  }
}
