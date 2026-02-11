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

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' });

/**
 * Read today's and tomorrow's schedule from the schedule_days cache.
 * Returns [todaySlots, tomorrowSlots] or null if no data.
 */
export async function fetchSchedule(db: D1Database, group: string): Promise<HalfHourSlots[] | null> {
  try {
    const now = new Date();
    const today = dateFmt.format(now);
    const tomorrow = dateFmt.format(new Date(now.getTime() + 86400000));

    const rows = await db
      .prepare('SELECT date, slots FROM schedule_days WHERE group_name = ? AND date IN (?, ?)')
      .bind(group, today, tomorrow)
      .all<{ date: string; slots: string }>();

    const byDate = new Map<string, HalfHourSlots>();
    for (const row of rows.results) {
      try {
        byDate.set(row.date, JSON.parse(row.slots));
      } catch {
        // skip corrupted
      }
    }

    const result: HalfHourSlots[] = [];
    if (byDate.has(today)) result.push(byDate.get(today)!);
    if (byDate.has(tomorrow)) result.push(byDate.get(tomorrow)!);

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/** When should the current outage end per schedule? Returns "HH:MM" or "завтра о HH:MM", or null. */
export function getScheduledRestoration(schedule: HalfHourSlots[], now: Date): string | null {
  const { hours, minutes } = getKyivTime(now);
  const currentSlot = hours * 2 + (minutes >= 30 ? 1 : 0);

  // Check if current slot is actually scheduled as off
  if (schedule[0] && schedule[0][currentSlot]) {
    // Schedule says power should be ON — this is an unplanned outage
    return null;
  }

  // Walk forward from current slot to find first ON slot today
  if (schedule[0]) {
    for (let i = currentSlot; i < 48; i++) {
      if (schedule[0][i]) return slotToTime(i);
    }
  }
  // Check tomorrow's schedule
  if (schedule[1]) {
    for (let i = 0; i < 48; i++) {
      if (schedule[1][i]) return `завтра о ${slotToTime(i)}`;
    }
  }

  return null;
}

/** Find next planned outage block. Returns {start, end} times or null. */
export function getNextScheduledOutage(schedule: HalfHourSlots[], now: Date): { start: string; end: string } | null {
  const { hours, minutes } = getKyivTime(now);
  const currentSlot = hours * 2 + (minutes >= 30 ? 1 : 0);

  const allSlots = [...(schedule[0] || []), ...(schedule[1] || [])];

  // If currently in a scheduled OFF block, skip past it first
  // to find the next distinct outage (not the current one)
  let searchFrom = currentSlot + 1;
  if (!allSlots[currentSlot]) {
    while (searchFrom < allSlots.length && !allSlots[searchFrom]) {
      searchFrom++;
    }
  }

  // Find next OFF slot (start of next outage)
  let start = -1;
  for (let i = searchFrom; i < allSlots.length; i++) {
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
