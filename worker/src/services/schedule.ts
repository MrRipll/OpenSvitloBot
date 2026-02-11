const SCHEDULE_URL = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/refs/heads/main/data/kyiv-region.json';

interface ScheduleData {
  fact: {
    data: Record<string, Record<string, Record<string, string>>>;
    today: number;
  };
}

// true = power on, false = power off
type HalfHourSlots = boolean[];

export function parseDay(daySchedule: Record<string, string>): HalfHourSlots {
  const slots: boolean[] = [];
  for (let hour = 1; hour <= 24; hour++) {
    const val = daySchedule[String(hour)] || 'yes';
    switch (val) {
      case 'no':
        slots.push(false, false);
        break;
      case 'first':
        slots.push(false, true);
        break;
      case 'second':
        slots.push(true, false);
        break;
      default:
        slots.push(true, true);
    }
  }
  return slots;
}

function slotToTime(slotIndex: number): string {
  const idx = ((slotIndex % 48) + 48) % 48;
  const hour = Math.floor(idx / 2);
  const min = (idx % 2) * 30;
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function getKyivTime(date: Date): { hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  return { hours, minutes };
}

export async function fetchSchedule(group: string): Promise<HalfHourSlots[] | null> {
  try {
    const resp = await fetch(SCHEDULE_URL);
    if (!resp.ok) return null;
    const data: ScheduleData = await resp.json();

    const days = data.fact.data;
    const today = data.fact.today;
    const todayKey = String(today);
    const tomorrowKey = String(today + 86400);

    const result: HalfHourSlots[] = [];

    if (days[todayKey]?.[group]) {
      result.push(parseDay(days[todayKey][group]));
    }
    if (days[tomorrowKey]?.[group]) {
      result.push(parseDay(days[tomorrowKey][group]));
    }

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/** When should the current outage end per schedule? Returns "HH:MM" or null. */
export function getScheduledRestoration(schedule: HalfHourSlots[], now: Date): string | null {
  const { hours, minutes } = getKyivTime(now);
  const currentSlot = hours * 2 + (minutes >= 30 ? 1 : 0);

  // Check if current slot is actually scheduled as off
  if (schedule[0] && schedule[0][currentSlot]) {
    // Schedule says power should be ON — this is an unplanned outage
    return null;
  }

  // Walk forward from current slot to find first ON slot
  if (schedule[0]) {
    for (let i = currentSlot; i < 48; i++) {
      if (schedule[0][i]) return slotToTime(i);
    }
  }
  if (schedule[1]) {
    for (let i = 0; i < 48; i++) {
      if (schedule[1][i]) return slotToTime(i);
    }
  }

  return null;
}

/** Find next planned outage block. Returns {start, end} times or null. */
export function getNextScheduledOutage(schedule: HalfHourSlots[], now: Date): { start: string; end: string } | null {
  const { hours, minutes } = getKyivTime(now);
  const currentSlot = hours * 2 + (minutes >= 30 ? 1 : 0);

  const allSlots = [...(schedule[0] || []), ...(schedule[1] || [])];

  // Find next OFF slot after current position
  let start = -1;
  for (let i = currentSlot + 1; i < allSlots.length; i++) {
    if (!allSlots[i]) {
      start = i;
      break;
    }
  }

  if (start === -1) return null;

  // Find end of this OFF block
  let end = start;
  while (end < allSlots.length && !allSlots[end]) {
    end++;
  }

  return { start: slotToTime(start), end: slotToTime(end) };
}
