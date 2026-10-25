import { Env } from '../types';
import { getStaleOnlineDevices, markOfflineAtomic } from '../services/db';
import { sendMessage, formatOutageMessage } from '../services/telegram';
import { fetchSchedule, getScheduledRestoration } from '../services/schedule';
import { markPublicHistoryDirty } from '../services/public-history';

const STALE_THRESHOLD_MS = 45 * 1000; // 45 seconds (3 missed pings at 15s interval)

export async function checkDevices(env: Env): Promise<void> {
  const staleDevices = await getStaleOnlineDevices(env.DB, STALE_THRESHOLD_MS);

  for (const device of staleDevices) {
    if (device.last_ping === null) continue;
    const outageTime = device.last_ping;

    // Skips if a ping raced in after the stale check, so no ghost outages or duplicate alerts.
    if (!(await markOfflineAtomic(env.DB, device.id, outageTime))) continue;
    await markPublicHistoryDirty(env.DB);

    const onlineDurationMs = device.last_status_change ? outageTime - device.last_status_change : 0;

    let scheduledRestoration: string | null = null;
    const schedule = await fetchSchedule(env.DB, env.OUTAGE_GROUP);
    if (schedule) {
      scheduledRestoration = getScheduledRestoration(schedule, new Date(outageTime));
    }

    const message = formatOutageMessage(new Date(outageTime), onlineDurationMs, scheduledRestoration);
    await sendMessage(env, message);
  }
}
