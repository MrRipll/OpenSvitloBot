import { Env } from '../types';

const TELEGRAM_API = 'https://api.telegram.org';

export async function sendMessage(env: Env, text: string, chatId?: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  const targetChat = chatId || env.TELEGRAM_CHAT_ID;
  if (!targetChat) return false;

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: targetChat,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  return resp.ok;
}

export async function sendPhoto(env: Env, photoUrl: string, caption: string, chatId?: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  const targetChat = chatId || env.TELEGRAM_CHAT_ID;
  if (!targetChat) return false;

  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: targetChat,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
    }),
  });

  return resp.ok;
}

export function formatOutageMessage(deviceName: string, groupName: string, time: Date): string {
  const timeStr = time.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
  const group = groupName ? ` (${groupName})` : '';
  return `⚡ <b>${deviceName}</b>${group} — зникло світло о ${timeStr}`;
}

export function formatRecoveryMessage(deviceName: string, groupName: string, time: Date, durationMinutes: number): string {
  const timeStr = time.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
  const group = groupName ? ` (${groupName})` : '';
  const hours = Math.floor(durationMinutes / 60);
  const mins = Math.round(durationMinutes % 60);
  const durationStr = hours > 0 ? `${hours} год ${mins} хв` : `${mins} хв`;
  return `✅ <b>${deviceName}</b>${group} — світло повернулось о ${timeStr} (не було ${durationStr})`;
}
