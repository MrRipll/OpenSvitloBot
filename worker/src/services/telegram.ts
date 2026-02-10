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

function kyivTimeStr(date: Date): string {
  return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
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
    `🔴 ${kyivTimeStr(time)} Світло зникло`,
  ];
  if (onlineDurationMs > 0) {
    lines.push(`🕓 Воно було ${formatDuration(onlineDurationMs)}`);
  }
  if (scheduledRestoration) {
    lines.push(`🗓 Очікуємо за графіком о ${scheduledRestoration}`);
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
    `🟢 ${kyivTimeStr(time)} Світло з'явилося`,
  ];
  if (offlineDurationMs > 0) {
    lines.push(`🕓 Його не було ${formatDuration(offlineDurationMs)}`);
  }
  if (nextOutage) {
    lines.push(`🗓 Наступне планове: ${nextOutage.start} - ${nextOutage.end}`);
  }
  return lines.join('\n');
}
