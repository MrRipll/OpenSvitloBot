import { Env } from '../types';

const TELEGRAM_API = 'https://api.telegram.org';

export async function sendMessage(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  return resp.ok;
}

export async function sendPhoto(env: Env, photoUrl: string, caption: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
    }),
  });

  return resp.ok;
}

export async function sendPhotoGetId(env: Env, photoUrl: string, caption: string): Promise<number | null> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
    }),
  });

  if (!resp.ok) return null;
  const data = await resp.json<{ ok: boolean; result?: { message_id: number } }>();
  return data.ok && data.result ? data.result.message_id : null;
}

export async function editMessageMedia(
  env: Env,
  messageId: number,
  photoUrl: string,
  caption: string
): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/editMessageMedia`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      message_id: messageId,
      media: {
        type: 'photo',
        media: photoUrl,
        caption,
        parse_mode: 'HTML',
      },
    }),
  });

  return resp.ok;
}

export async function sendPhotoBufferGetId(
  env: Env,
  pngData: Uint8Array,
  caption: string
): Promise<number | null> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  form.append('disable_notification', 'true');
  form.append('photo', new Blob([pngData], { type: 'image/png' }), 'chart.png');

  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) {
    console.error('sendPhoto failed', resp.status, await resp.text());
    return null;
  }
  const data = await resp.json<{ ok: boolean; result?: { message_id: number } }>();
  return data.ok && data.result ? data.result.message_id : null;
}

export async function editMessageMediaBuffer(
  env: Env,
  messageId: number,
  pngData: Uint8Array,
  caption: string
): Promise<{ ok: boolean; error?: string }> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, error: 'telegram not configured' };

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/editMessageMedia`;
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  form.append('message_id', String(messageId));
  form.append('media', JSON.stringify({
    type: 'photo',
    media: 'attach://photo',
    caption,
    parse_mode: 'HTML',
  }));
  form.append('photo', new Blob([pngData], { type: 'image/png' }), 'chart.png');

  const resp = await fetch(url, { method: 'POST', body: form });
  if (resp.ok) return { ok: true };
  const data = await resp.json<{ description?: string }>().catch(() => ({ description: undefined }));
  return { ok: false, error: data.description || `HTTP ${resp.status}` };
}

async function callChatMethod(
  env: Env,
  method: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, error: 'telegram not configured' };

  const resp = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, ...params }),
  });
  if (resp.ok) return { ok: true };
  const data = await resp.json<{ description?: string }>().catch(() => ({ description: undefined }));
  return { ok: false, error: data.description || `HTTP ${resp.status}` };
}

/** Pin without notifying members. Requires pin rights (in channels: "Edit messages"). */
export function pinChatMessage(env: Env, messageId: number) {
  return callChatMethod(env, 'pinChatMessage', { message_id: messageId, disable_notification: true });
}

export function unpinChatMessage(env: Env, messageId: number) {
  return callChatMethod(env, 'unpinChatMessage', { message_id: messageId });
}

const kyivTimeFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });

function kyivTimeStr(date: Date): string {
  return kyivTimeFmt.format(date);
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) return `${hours}год ${mins}хв`;
  return `${mins}хв`;
}

/**
 * 🔴 05:48 Світло зникло
 * 🕓 Воно було 3год 4хв
 * 🗓 Очікуємо за графіком о 12:30
 */
export function formatOutageMessage(
  time: Date,
  onlineDurationMs: number,
  scheduledRestoration: string | null
): string {
  const lines = [
    `<b>🔴 ${kyivTimeStr(time)} Світло зникло</b>`,
  ];
  if (onlineDurationMs > 0) {
    lines.push(`🕓 Воно було ${formatDuration(onlineDurationMs)}`);
  }
  if (scheduledRestoration) {
    const prefix = scheduledRestoration.startsWith('завтра') ? '' : 'о ';
    lines.push(`🗓 Очікуємо за графіком ${prefix}<b>${scheduledRestoration}</b>`);
  }
  return lines.join('\n');
}

/**
 * 🟢 02:44 Світло з'явилося
 * 🕓 Його не було 7год 19хв
 * 🗓 Наступне планове: 05:30 - 12:30
 */
export function formatRecoveryMessage(
  time: Date,
  offlineDurationMs: number,
  nextOutage: { start: string; end: string } | null
): string {
  const lines = [
    `<b>🟢 ${kyivTimeStr(time)} Світло з'явилося</b>`,
  ];
  if (offlineDurationMs > 0) {
    lines.push(`🕓 Його не було ${formatDuration(offlineDurationMs)}`);
  }
  if (nextOutage) {
    lines.push(`🗓 Наступне планове: <b>${nextOutage.start} - ${nextOutage.end}</b>`);
  }
  return lines.join('\n');
}
