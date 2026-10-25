/**
 * Builds the weekly power timeline SVG that is posted to Telegram.
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ Світло за тиждень                        ● Світло є        │  header + live status pill
 *   │ 20–26 жовтня · група GPV6.2                з 14:20 · 3 год │
 *   │ [Зі світлом] [Без світла] [Найдовше] [Порівняно з графіком] │  KPI tiles
 *   │      00   03   06   09   12   15   18   21   24  без світла │
 *   │ Пн  ████████▓▓▓▓▓▓████████████████████████████   4 год 30 хв │  actual: green/red
 *   │ 20.10 ───────▬▬▬▬▬▬▬──────────────────────────    графік 6 год │  thin strip: schedule (elapsed part)
 *   │ ...                                                          │
 *   │ Сб  ██████████████████│╱╱╱╱░░░░░░░╱╱╱╱░░░░░░░    план 6 год  │  after "now": planned outages, hatched
 *   │ legend · next planned outage · updated at                    │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Only Inter 400/600 is bundled, so every font-weight here must be one of those.
 */

export interface ChartDay {
  dayLabel: string;
  dayDate: string;
  isToday: boolean;
  isFuture: boolean;
  nowHour: number | null;
  outages: { startHour: number; endHour: number; ongoing?: boolean }[];
  schedule: boolean[];
}

export interface ChartData {
  weekLabel: string;
  group: string;
  days: ChartDay[];
  /** Live device status; null when unknown. */
  status: { on: boolean; since: string | null; durationHours: number | null } | null;
  /** Longest outage of the week, e.g. { hours: 4.5, label: 'Чт 12:00–16:30' }. */
  longestOutage: { hours: number; label: string } | null;
  /** Footer hint about the schedule, e.g. "Наступне відключення за графіком: 18:00–21:30". */
  scheduleHint: string | null;
  updatedLabel: string;
}

export interface WeeklyStats {
  onHours: number;
  offHours: number;
  elapsedHours: number;
  outageCount: number;
  /** Actual minus scheduled "power on" hours over the elapsed part of the week; null without schedule data. */
  diffVsScheduleHours: number | null;
}

const C = {
  bg: '#ffffff',
  tile: '#f6f6f3',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e7e6e0',
  track: '#f1f0ec',
  on: '#0ca30c',
  off: '#d03b3b',
  planned: '#e08a8a',
  plannedBg: '#fdeeee',
  plannedInk: '#a33a3a',
  accent: '#2a78d6',
  todayBg: '#eef4fc',
  good: '#006300',
  bad: '#b42d2d',
  pillOnBg: '#e8f5e8',
  pillOffBg: '#fbeaea',
};

const FONT = 'font-family="Inter"';

const W = 800;
const PAD = 24;
const LABEL_W = 56;
const RIGHT_W = 96;
const BAR_X = PAD + LABEL_W;
const BAR_W = W - PAD - RIGHT_W - 12 - BAR_X;
const TILES_Y = 92;
const TILE_H = 74;
const ROWS_TOP = 206;
const ROW_H = 46;
const BAR_Y = 9;
const BAR_H = 20;
const STRIP_Y = BAR_Y + BAR_H + 4;
const STRIP_H = 5;
const ROWS_BOTTOM = ROWS_TOP + 7 * ROW_H;
const H = ROWS_BOTTOM + 82;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hourToX(h: number): number {
  return BAR_X + (h / 24) * BAR_W;
}

/** Rough Inter text width; good enough for sizing pills and legend spacing. */
function textW(s: string, size: number, bold = false): number {
  return s.length * size * (bold ? 0.6 : 0.53);
}

export function fmtDur(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}

export function fmtClock(hour: number): string {
  const total = Math.round(hour * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function pluralOutages(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} відключення`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} відключення`;
  return `${n} відключень`;
}

/** Scheduled "off" runs in hours, clipped to [from, to). */
function plannedOffRuns(schedule: boolean[], from: number, to: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  if (schedule.length !== 48) return runs;
  let s = -1;
  for (let i = 0; i <= 48; i++) {
    const off = i < 48 && !schedule[i];
    if (off && s < 0) s = i;
    if (!off && s >= 0) {
      const start = Math.max(s * 0.5, from);
      const end = Math.min(i * 0.5, to);
      if (end > start) runs.push({ start, end });
      s = -1;
    }
  }
  return runs;
}

function dayCutoff(day: ChartDay): number {
  if (day.isFuture) return 0;
  return day.isToday && day.nowHour !== null ? day.nowHour : 24;
}

function sumRuns(runs: { start: number; end: number }[]): number {
  return runs.reduce((acc, r) => acc + (r.end - r.start), 0);
}

export function computeWeeklyStats(data: ChartData): WeeklyStats {
  let on = 0, off = 0, elapsed = 0, count = 0;
  let schedOn = 0, actualOnWithSchedule = 0, hasSchedule = false;

  for (const day of data.days) {
    const cutoff = dayCutoff(day);
    if (cutoff <= 0) continue;
    elapsed += cutoff;
    let dayOff = 0;
    for (const o of day.outages) {
      dayOff += o.endHour - o.startHour;
      // An outage crossing midnight is split per day; count it once.
      if (o.startHour > 0) count++;
    }
    off += dayOff;
    on += cutoff - dayOff;

    if (day.schedule.length === 48) {
      hasSchedule = true;
      schedOn += cutoff - sumRuns(plannedOffRuns(day.schedule, 0, cutoff));
      actualOnWithSchedule += cutoff - dayOff;
    }
  }

  return {
    onHours: on,
    offHours: off,
    elapsedHours: elapsed,
    outageCount: count,
    diffVsScheduleHours: hasSchedule ? actualOnWithSchedule - schedOn : null,
  };
}

export function buildWeeklyChartSVG(data: ChartData): string {
  const p: string[] = [];
  const stats = computeWeeklyStats(data);

  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(
    `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<rect width="6" height="6" fill="${C.plannedBg}"/><rect width="2.5" height="6" fill="${C.planned}"/>` +
      `</pattern></defs>`
  );
  p.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

  // ── Header ──
  p.push(`<text x="${PAD}" y="46" fill="${C.ink}" ${FONT} font-size="22" font-weight="600">Світло за тиждень</text>`);
  p.push(`<text x="${PAD}" y="70" fill="${C.ink2}" ${FONT} font-size="13">${esc(`${data.weekLabel} · група ${data.group}`)}</text>`);

  if (data.status) {
    const title = data.status.on ? 'Світло є' : 'Світла немає';
    const parts: string[] = [];
    if (data.status.since) parts.push(`з ${data.status.since}`);
    if (data.status.durationHours !== null) parts.push(fmtDur(data.status.durationHours));
    const sub = parts.join(' · ');
    const pillW = Math.max(textW(title, 14, true), textW(sub, 11)) + 44;
    const pillX = W - PAD - pillW;
    const pillY = 24;
    p.push(`<rect x="${pillX}" y="${pillY}" width="${pillW}" height="48" rx="12" fill="${data.status.on ? C.pillOnBg : C.pillOffBg}"/>`);
    p.push(`<circle cx="${pillX + 18}" cy="${pillY + (sub ? 18 : 24)}" r="5" fill="${data.status.on ? C.on : C.off}"/>`);
    p.push(`<text x="${pillX + 32}" y="${pillY + (sub ? 23 : 29)}" fill="${C.ink}" ${FONT} font-size="14" font-weight="600">${esc(title)}</text>`);
    if (sub) {
      p.push(`<text x="${pillX + 32}" y="${pillY + 39}" fill="${C.ink2}" ${FONT} font-size="11">${esc(sub)}</text>`);
    }
  }

  // ── KPI tiles ──
  const upPct = stats.elapsedHours > 0 ? Math.round((stats.onHours / stats.elapsedHours) * 100) : 0;
  const diff = stats.diffVsScheduleHours;
  const diffRounded = diff === null ? null : Math.round(diff * 60) / 60;
  const tiles: { label: string; value: string; sub: string; color?: string }[] = [
    {
      label: 'Зі світлом',
      value: `${upPct}%`,
      sub: `${fmtDur(stats.onHours)} з ${stats.elapsedHours >= 24 ? `${Math.round(stats.elapsedHours)} год` : fmtDur(stats.elapsedHours)}`,
    },
    {
      label: 'Без світла',
      value: fmtDur(stats.offHours),
      sub: stats.outageCount > 0 ? pluralOutages(stats.outageCount) : 'відключень не було',
    },
    {
      label: 'Найдовше відключення',
      value: data.longestOutage ? fmtDur(data.longestOutage.hours) : '—',
      sub: data.longestOutage ? data.longestOutage.label : 'відключень не було',
    },
    diffRounded === null
      ? { label: 'Порівняно з графіком', value: '—', sub: 'графіка немає' }
      : {
          label: 'Порівняно з графіком',
          value: diffRounded === 0 ? '0 хв' : `${diffRounded > 0 ? '+' : '−'}${fmtDur(Math.abs(diffRounded))}`,
          sub: diffRounded > 0 ? 'світла більше за графік' : diffRounded < 0 ? 'світла менше за графік' : 'точно за графіком',
          color: diffRounded > 0 ? C.good : diffRounded < 0 ? C.bad : undefined,
        },
  ];
  const tileGap = 10;
  const tileW = (W - PAD * 2 - tileGap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = PAD + i * (tileW + tileGap);
    p.push(`<rect x="${x}" y="${TILES_Y}" width="${tileW}" height="${TILE_H}" rx="10" fill="${C.tile}"/>`);
    p.push(`<text x="${x + 14}" y="${TILES_Y + 22}" fill="${C.ink2}" ${FONT} font-size="11.5">${esc(t.label)}</text>`);
    const valueSize = textW(t.value, 20, true) > tileW - 28 ? 16 : 20;
    p.push(`<text x="${x + 14}" y="${TILES_Y + 47}" fill="${t.color || C.ink}" ${FONT} font-size="${valueSize}" font-weight="600">${esc(t.value)}</text>`);
    p.push(`<text x="${x + 14}" y="${TILES_Y + 64}" fill="${C.muted}" ${FONT} font-size="11">${esc(t.sub)}</text>`);
  });

  // ── Hour axis + grid ──
  for (let h = 0; h <= 24; h += 3) {
    const x = hourToX(h);
    p.push(`<text x="${x}" y="${ROWS_TOP - 10}" text-anchor="middle" fill="${C.muted}" ${FONT} font-size="11">${String(h).padStart(2, '0')}</text>`);
    p.push(`<line x1="${x}" y1="${ROWS_TOP - 4}" x2="${x}" y2="${ROWS_BOTTOM}" stroke="${C.grid}" stroke-width="1"/>`);
  }
  p.push(`<text x="${W - PAD}" y="${ROWS_TOP - 10}" text-anchor="end" fill="${C.muted}" ${FONT} font-size="11">без світла</text>`);

  // ── Day rows ──
  const overlay: string[] = [];
  for (let i = 0; i < data.days.length && i < 7; i++) {
    const day = data.days[i];
    const top = ROWS_TOP + i * ROW_H;
    const barY = top + BAR_Y;
    const stripY = top + STRIP_Y;
    const cutoff = dayCutoff(day);
    const cutX = hourToX(cutoff);
    const hasSchedule = day.schedule.length === 48;

    if (day.isToday) {
      p.push(`<rect x="${PAD - 10}" y="${top + 1}" width="${W - PAD * 2 + 20}" height="${ROW_H - 2}" rx="10" fill="${C.todayBg}"/>`);
      // Today's highlight covers the grid; redraw it inside the row.
      for (let h = 3; h < 24; h += 3) {
        const x = hourToX(h);
        p.push(`<line x1="${x}" y1="${top + 1}" x2="${x}" y2="${top + ROW_H - 1}" stroke="${C.grid}" stroke-width="1"/>`);
      }
    }

    const labelColor = day.isToday ? C.accent : day.isFuture ? C.muted : C.ink;
    p.push(`<text x="${PAD}" y="${top + 23}" fill="${labelColor}" ${FONT} font-size="14" font-weight="600">${esc(day.dayLabel)}</text>`);
    p.push(`<text x="${PAD}" y="${top + 38}" fill="${C.muted}" ${FONT} font-size="11">${esc(day.dayDate)}</text>`);

    // Track for the whole day, then actual data up to the cutoff.
    p.push(`<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="${BAR_H}" rx="4" fill="${C.track}"/>`);
    if (cutoff > 0) {
      p.push(`<rect x="${BAR_X}" y="${barY}" width="${cutX - BAR_X}" height="${BAR_H}" rx="4" fill="${C.on}"/>`);
      for (const o of day.outages) {
        const x1 = hourToX(o.startHour);
        const x2 = hourToX(o.endHour);
        if (x2 - x1 < 0.5) continue;
        p.push(`<rect x="${x1}" y="${barY}" width="${x2 - x1}" height="${BAR_H}" rx="3" fill="${C.off}"/>`);
        const label = o.ongoing
          ? (o.startHour > 0 ? `з ${fmtClock(o.startHour)}` : 'триває')
          : `${fmtClock(o.startHour)}–${fmtClock(o.endHour)}`;
        if (x2 - x1 >= textW(label, 10.5, true) + 8) {
          overlay.push(`<text x="${(x1 + x2) / 2}" y="${barY + 14}" text-anchor="middle" fill="#ffffff" ${FONT} font-size="10.5" font-weight="600">${label}</text>`);
        }
      }
    }

    // Planned outages for the part of the day that hasn't happened yet.
    if (hasSchedule && cutoff < 24) {
      for (const r of plannedOffRuns(day.schedule, cutoff, 24)) {
        const x1 = hourToX(r.start);
        const x2 = hourToX(r.end);
        p.push(`<rect x="${x1}" y="${barY}" width="${x2 - x1}" height="${BAR_H}" rx="3" fill="url(#hatch)"/>`);
        if (x2 - x1 >= textW('00:00–00:00', 10.5, true) + 8) {
          overlay.push(
            `<text x="${(x1 + x2) / 2}" y="${barY + 14}" text-anchor="middle" fill="${C.plannedInk}" stroke="${C.plannedBg}" stroke-width="3" paint-order="stroke" stroke-linejoin="round" ${FONT} font-size="10.5" font-weight="600">${fmtClock(r.start)}–${fmtClock(r.end)}</text>`
          );
        }
      }
    }

    // Schedule strip under the elapsed part, to compare reality with the plan.
    if (hasSchedule && cutoff > 0) {
      p.push(`<rect x="${BAR_X}" y="${stripY}" width="${cutX - BAR_X}" height="${STRIP_H}" rx="2" fill="${C.track}"/>`);
      for (const r of plannedOffRuns(day.schedule, 0, cutoff)) {
        p.push(`<rect x="${hourToX(r.start)}" y="${stripY}" width="${hourToX(r.end) - hourToX(r.start)}" height="${STRIP_H}" rx="2" fill="${C.planned}"/>`);
      }
    }

    if (day.isToday && day.nowHour !== null) {
      overlay.push(`<line x1="${cutX}" y1="${barY - 4}" x2="${cutX}" y2="${stripY + STRIP_H + 3}" stroke="${C.accent}" stroke-width="2" stroke-linecap="round"/>`);
      overlay.push(`<circle cx="${cutX}" cy="${barY - 4}" r="4" fill="${C.accent}" stroke="${C.bg}" stroke-width="1.5"/>`);
    }

    // Right column: hours without power (actual for past days, planned for future ones).
    const rx = W - PAD;
    const scheduledOff = hasSchedule ? sumRuns(plannedOffRuns(day.schedule, 0, cutoff > 0 ? cutoff : 24)) : null;
    if (cutoff > 0) {
      const off = day.outages.reduce((acc, o) => acc + (o.endHour - o.startHour), 0);
      if (off >= 1 / 60) {
        p.push(`<text x="${rx}" y="${top + 23}" text-anchor="end" fill="${C.ink}" ${FONT} font-size="13" font-weight="600">${fmtDur(off)}</text>`);
      } else {
        p.push(`<text x="${rx}" y="${top + 23}" text-anchor="end" fill="${C.good}" ${FONT} font-size="12" font-weight="600">без відкл.</text>`);
      }
      if (scheduledOff !== null) {
        p.push(`<text x="${rx}" y="${top + 38}" text-anchor="end" fill="${C.muted}" ${FONT} font-size="11">${esc(`графік ${fmtDur(scheduledOff)}`)}</text>`);
      }
    } else if (scheduledOff !== null) {
      p.push(`<text x="${rx}" y="${top + 28}" text-anchor="end" fill="${C.muted}" ${FONT} font-size="12">${esc(`план ${fmtDur(scheduledOff)}`)}</text>`);
    } else {
      p.push(`<text x="${rx}" y="${top + 28}" text-anchor="end" fill="${C.muted}" ${FONT} font-size="12">—</text>`);
    }
  }

  // Light gridlines over the bars make hours readable inside long segments.
  for (let h = 3; h < 24; h += 3) {
    const x = hourToX(h);
    for (let i = 0; i < 7; i++) {
      const y = ROWS_TOP + i * ROW_H + BAR_Y;
      p.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + BAR_H}" stroke="#ffffff" stroke-opacity="0.45" stroke-width="1"/>`);
    }
  }
  p.push(...overlay);

  // ── Legend ──
  const legY = ROWS_BOTTOM + 22;
  let lx = BAR_X;
  const legend: { swatch: string; label: string }[] = [
    { swatch: `<rect x="0" y="-9" width="14" height="10" rx="2" fill="${C.on}"/>`, label: 'Світло було' },
    { swatch: `<rect x="0" y="-9" width="14" height="10" rx="2" fill="${C.off}"/>`, label: 'Відключення' },
    { swatch: `<rect x="0" y="-9" width="14" height="10" rx="2" fill="url(#hatch)"/>`, label: 'Заплановано графіком' },
    { swatch: `<rect x="0" y="-6" width="14" height="5" rx="2" fill="${C.planned}"/>`, label: 'Графік (для порівняння)' },
    { swatch: `<line x1="7" y1="-11" x2="7" y2="3" stroke="${C.accent}" stroke-width="2" stroke-linecap="round"/>`, label: 'Зараз' },
  ];
  for (const item of legend) {
    p.push(`<g transform="translate(${lx} ${legY})">${item.swatch}</g>`);
    p.push(`<text x="${lx + 20}" y="${legY}" fill="${C.ink2}" ${FONT} font-size="11">${esc(item.label)}</text>`);
    lx += 20 + textW(item.label, 11) + 18;
  }

  // ── Footer ──
  const footY = H - 18;
  p.push(`<line x1="${PAD}" y1="${footY - 22}" x2="${W - PAD}" y2="${footY - 22}" stroke="${C.grid}" stroke-width="1"/>`);
  if (data.scheduleHint) {
    p.push(`<text x="${PAD}" y="${footY}" fill="${C.ink2}" ${FONT} font-size="12">${esc(data.scheduleHint)}</text>`);
  }
  p.push(`<text x="${W - PAD}" y="${footY}" text-anchor="end" fill="${C.muted}" ${FONT} font-size="11">${esc(`Оновлено ${data.updatedLabel}`)}</text>`);

  p.push('</svg>');
  return p.join('\n');
}
