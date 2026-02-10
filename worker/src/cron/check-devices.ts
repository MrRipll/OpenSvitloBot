import { Env } from '../types';
import { getStaleOnlineDevices, updateDeviceStatus, createOutage } from '../services/db';
import { sendMessage, formatOutageMessage } from '../services/telegram';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function checkDevices(env: Env): Promise<void> {
  const staleDevices = await getStaleOnlineDevices(env.DB, STALE_THRESHOLD_MS);

  for (const device of staleDevices) {
    const now = Date.now();

    await updateDeviceStatus(env.DB, device.id, 'offline', now);
    await createOutage(env.DB, device.id, now);

    const message = formatOutageMessage(device.name, device.group_name, new Date(now));
    await sendMessage(env, message);
  }
}
