const DAY_LABELS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'НД'];

function getKyivParts(date: Date): { year: number; month: number; day: number; hours: number; minutes: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';

  const weekdayStr = get('weekday');
  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dow = dowMap[weekdayStr] || 1;

  return {
    year: parseInt(get('year')),
    month: parseInt(get('month')),
    day: parseInt(get('day')),
    hours: parseInt(get('hour')),
    minutes: parseInt(get('minute')),
    dow,
  };
}

/**
 * Compute the Monday 00:00 Kyiv time for the week containing `now`.
 * Returns start and end (exclusive Sunday 24:00) as epoch ms.
 */
function getWeekBounds(now: Date): { weekStartMs: number; weekEndMs: number; weekStartDate: string; weekEndDate: string } {
  const p = getKyivParts(now);
  const todayMs = Date.UTC(p.year, p.month - 1, p.day);
  const mondayMs = todayMs - (p.dow - 1) * 86400000;
  const sundayMs = mondayMs + 7 * 86400000;

  const nowFloored = Math.floor(now.getTime() / 60000) * 60000;
  const kyivOffsetMs = nowFloored - todayMs - p.hours * 3600000 - p.minutes * 60000;

  const mondayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(mondayMs));
  const sundayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(sundayMs - 86400000));

  return {
    weekStartMs: mondayMs + kyivOffsetMs,
    weekEndMs: sundayMs + kyivOffsetMs,
    weekStartDate: mondayDate,
    weekEndDate: sundayDate,
  };
}

export { getWeekBounds, getKyivParts, DAY_LABELS };
