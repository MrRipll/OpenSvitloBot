import { Env } from '../types';
import { getDeviceByKey, recordPing, closeOutage, updateDeviceStatus } from '../services/db';
import { sendMessage, formatRecoveryMessage } from '../services/telegram';

export async function handlePing(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!key) {
    return new Response(JSON.stringify({ error: 'Missing device key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const device = await getDeviceByKey(env.DB, key);
  if (!device) {
    return new Response(JSON.stringify({ error: 'Unknown device' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = Date.now();
  const wasOffline = device.status === 'offline';

  await recordPing(env.DB, device.id, now);

  if (wasOffline) {
    await updateDeviceStatus(env.DB, device.id, 'online', now);
    await closeOutage(env.DB, device.id, now);

    const durationMs = device.last_status_change ? now - device.last_status_change : 0;
    const durationMinutes = durationMs / 60000;

    const message = formatRecoveryMessage(device.name, device.group_name, new Date(now), durationMinutes);
    await sendMessage(env, message);
  }

  return new Response(JSON.stringify({ ok: true, device: device.name }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
