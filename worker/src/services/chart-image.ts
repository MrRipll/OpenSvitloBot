/**
 * Builds a weekly outage timeline SVG chart.
 *
 * Layout per day row:
 *   ┌──────────────────────────────────────┐
 *   │ ПН  ████████░░░░████████████████████ │  actual bar: green=on, red=off (only real data)
 *   │ 09.02 ▓▓▓▓░░░░▓▓▓▓░░░░▓▓▓▓░░░░▓▓▓ │  schedule bar: yellow=on, gray=off
 *   │                                -8.5г │  summary below bars
 *   └──────────────────────────────────────┘
 *
 * Top bar (actual): only shows past/present data. Future days = empty.
 * Bottom bar (schedule): shows expected outages when data is available.
 * Blue now-marker drawn on top of everything.
 * White background for Telegram.
 */

interface ChartDay {
  dayLabel: string;
  dayDate: string;
  isToday: boolean;
  isFuture: boolean;
  nowHour: number | null;
  outages: { startHour: number; endHour: number }[];
  schedule: boolean[];
}

interface ChartData {
  weekLabel: string;
  group: string;
  days: ChartDay[];
}

export interface WeeklyStats {
  totalPowerOnHours: number;
  totalPowerOffHours: number;
  scheduledOnHours: number;
  scheduledOffHours: number;
  diffMinutes: number;
  diffPercent: number;
  outageCount: number;
  longestOn: number;
  longestOff: number;
  avgOutage: number;
  elapsedHours: number;
}

const C = {
  bg: '#ffffff',
  border: '#e2e8f0',
  gridLine: '#cbd5e1',
  gridMinor: '#e2e8f0',
  text: '#1e293b',
  muted: '#64748b',
  dimmed: '#94a3b8',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  yellowLight: '#fef08a',
  gray: '#d1d5db',
  schedOff: '#cbd5e1',
  accent: '#3b82f6',
  todayBg: '#eff6ff',
  statLabel: '#475569',
  emptyBar: '#f1f5f9',
  summaryOn: '#15803d',
  summaryExp: '#a16207',
  diffPos: '#059669',
  diffNeg: '#dc2626',
  sepLine: '#d1d5db',
};

const W = 720;
const LABEL_W = 80;
const PAD_X = 16;
const SUMMARY_COL = 72;
const SUMMARY_GAP = 8;
const BAR_AREA_W = W - LABEL_W - PAD_X * 2 - SUMMARY_COL - SUMMARY_GAP;
const TITLE_H = 44;
const ACTUAL_H = 20;
const SCHED_H = 8;
const BAR_GAP = 3;
const DAY_PAD = 6;
const DAY_H = DAY_PAD + ACTUAL_H + BAR_GAP + SCHED_H + DAY_PAD + 4;
const AXIS_H = 24;
const LEGEND_H = 28;
const STATS_H = 76;
const TOP_PAD = 10;
const H = TOP_PAD + TITLE_H + 7 * DAY_H + AXIS_H + LEGEND_H + STATS_H + 12;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hourToX(h: number): number {
  return LABEL_W + PAD_X + (h / 24) * BAR_AREA_W;
}

export function computeWeeklyStats(data: ChartData): WeeklyStats {
  let totalOn = 0, totalOff = 0, schedOn = 0, schedOff = 0;
  let elapsed = 0, outageCount = 0, longestOn = 0, longestOff = 0;

  for (const day of data.days) {
    if (day.isFuture) continue;
    const dayEnd = day.isToday && day.nowHour !== null ? day.nowHour : 24;
    elapsed += dayEnd;

    const sorted = [...day.outages].sort((a, b) => a.startHour - b.startHour);
    let offH = 0;
    for (const o of sorted) {
      const dur = o.endHour - o.startHour;
      offH += dur;
      outageCount++;
      if (dur > longestOff) longestOff = dur;
    }
    totalOff += offH;
    totalOn += dayEnd - offH;

    let prevEnd = 0;
    for (const o of sorted) {
      const gap = o.startHour - prevEnd;
      if (gap > longestOn) longestOn = gap;
      prevEnd = o.endHour;
    }
    const trailing = dayEnd - prevEnd;
    if (trailing > longestOn) longestOn = trailing;

    if (day.schedule && day.schedule.length === 48) {
      for (let s = 0; s < 48; s++) {
        const slotH = s * 0.5;
        if (slotH >= dayEnd) break;
        const slotDur = Math.min(0.5, dayEnd - slotH);
        if (day.schedule[s]) schedOn += slotDur; else schedOff += slotDur;
      }
    }
  }

  const diffMinutes = Math.round((totalOn - schedOn) * 60);
  const diffPercent = schedOn > 0 ? Math.round(((totalOn - schedOn) / schedOn) * 1000) / 10 : 0;
  const avgOutage = outageCount > 0 ? Math.round((totalOff / outageCount) * 10) / 10 : 0;

  return {
    totalPowerOnHours: Math.round(totalOn * 10) / 10,
    totalPowerOffHours: Math.round(totalOff * 10) / 10,
    scheduledOnHours: Math.round(schedOn * 10) / 10,
    scheduledOffHours: Math.round(schedOff * 10) / 10,
    diffMinutes, diffPercent, outageCount,
    longestOn: Math.round(longestOn * 10) / 10,
    longestOff: Math.round(longestOff * 10) / 10,
    avgOutage,
    elapsedHours: Math.round(elapsed * 10) / 10,
  };
}

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}хв`;
  if (mins === 0) return `${hrs}год`;
  return `${hrs}год ${mins}хв`;
}

export function buildWeeklyChartSVG(data: ChartData): string {
  const p: string[] = [];
  const stats = computeWeeklyStats(data);
  const barLeft = LABEL_W + PAD_X;

  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>`);

  // Title
  const titleY = TOP_PAD + 20;
  p.push(`<text x="${W / 2}" y="${titleY}" text-anchor="middle" fill="${C.text}" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="700">${esc(`Відключення за тиждень ${data.weekLabel}`)}</text>`);
  p.push(`<text x="${W / 2}" y="${titleY + 16}" text-anchor="middle" fill="${C.muted}" font-family="Inter,Arial,sans-serif" font-size="11">Група: ${esc(data.group)}</text>`);

  const chartTop = TOP_PAD + TITLE_H;
  const axisY = chartTop + 7 * DAY_H;

  // Grid lines (behind bars)
  for (let h = 0; h <= 24; h++) {
    const x = hourToX(h);
    if (h % 4 === 0 && h > 0 && h < 24) {
      p.push(`<line x1="${x}" y1="${chartTop}" x2="${x}" y2="${axisY}" stroke="${C.gridLine}" stroke-width="0.75"/>`);
    } else if (h > 0 && h < 24) {
      p.push(`<line x1="${x}" y1="${chartTop}" x2="${x}" y2="${axisY}" stroke="${C.gridMinor}" stroke-width="0.4"/>`);
    }
  }

  // Collect now-markers to draw last (on top of everything)
  const nowMarkers: string[] = [];

  // Draw days
  for (let i = 0; i < 7 && i < data.days.length; i++) {
    const day = data.days[i];
    const rowY = chartTop + i * DAY_H;
    const hasSchedule = day.schedule && day.schedule.length === 48;

    // Today highlight
    if (day.isToday) {
      p.push(`<rect x="${PAD_X / 2}" y="${rowY}" width="${W - PAD_X}" height="${DAY_H - 2}" rx="5" fill="${C.todayBg}"/>`);
    }

    // Row separator
    if (i > 0) {
      p.push(`<line x1="${barLeft}" y1="${rowY}" x2="${W - PAD_X}" y2="${rowY}" stroke="${C.border}" stroke-width="0.5"/>`);
    }

    // Day label
    const labelColor = day.isToday ? C.accent : (day.isFuture ? C.dimmed : C.text);
    const labelWeight = day.isToday ? '700' : '600';
    p.push(`<text x="${LABEL_W - 6}" y="${rowY + DAY_PAD + 13}" text-anchor="end" fill="${labelColor}" font-family="Inter,Arial,sans-serif" font-size="13" font-weight="${labelWeight}">${esc(day.dayLabel)}</text>`);
    p.push(`<text x="${LABEL_W - 6}" y="${rowY + DAY_PAD + 26}" text-anchor="end" fill="${C.dimmed}" font-family="Inter,Arial,sans-serif" font-size="9.5">${esc(day.dayDate)}</text>`);

    // ── Top bar: Actual data ──
    const actualY = rowY + DAY_PAD;

    if (!day.isFuture) {
      // Draw actual bar: green base + red outages
      const cutoff = day.isToday && day.nowHour !== null ? day.nowHour : 24;
      const greenRight = hourToX(cutoff);

      // Green (power on) base
      p.push(`<rect x="${barLeft}" y="${actualY}" width="${greenRight - barLeft}" height="${ACTUAL_H}" rx="3" fill="${C.green}"/>`);

      // Red outage overlays
      for (const o of day.outages) {
        const oLeft = hourToX(o.startHour);
        const oRight = hourToX(o.endHour);
        if (oRight - oLeft > 0) {
          p.push(`<rect x="${oLeft}" y="${actualY}" width="${oRight - oLeft}" height="${ACTUAL_H}" rx="2" fill="${C.red}"/>`);
        }
      }

      // Actual bar border (only for filled part)
      p.push(`<rect x="${barLeft}" y="${actualY}" width="${greenRight - barLeft}" height="${ACTUAL_H}" rx="3" fill="none" stroke="${C.border}" stroke-width="0.5"/>`);

      // Now marker — collect for later (drawn on top of everything)
      if (day.isToday && day.nowHour !== null) {
        const nowX = hourToX(day.nowHour);
        nowMarkers.push(`<line x1="${nowX}" y1="${actualY - 3}" x2="${nowX}" y2="${actualY + ACTUAL_H + BAR_GAP + SCHED_H + 3}" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"/>`);
        nowMarkers.push(`<circle cx="${nowX}" cy="${actualY - 3}" r="3" fill="${C.accent}"/>`);
      }
    } else {
      // Future day: empty top bar — just a thin border placeholder
      p.push(`<rect x="${barLeft}" y="${actualY}" width="${BAR_AREA_W}" height="${ACTUAL_H}" rx="3" fill="${C.emptyBar}" stroke="${C.border}" stroke-width="0.5" stroke-dasharray="4,3"/>`);
    }

    // ── Bottom bar: Schedule ──
    const schedY = actualY + ACTUAL_H + BAR_GAP;

    if (hasSchedule) {
      // Schedule bar background
      p.push(`<rect x="${barLeft}" y="${schedY}" width="${BAR_AREA_W}" height="${SCHED_H}" rx="2" fill="${C.schedOff}"/>`);

      // Schedule segments
      let runStart = 0;
      let runOn = day.schedule[0];
      for (let s = 1; s <= 48; s++) {
        const on = s < 48 ? day.schedule[s] : !runOn;
        if (on !== runOn) {
          const sLeft = hourToX(runStart * 0.5);
          const sRight = hourToX(s * 0.5);
          p.push(`<rect x="${sLeft}" y="${schedY}" width="${sRight - sLeft}" height="${SCHED_H}" rx="2" fill="${runOn ? C.yellow : C.schedOff}"/>`);
          runStart = s;
          runOn = on;
        }
      }

      p.push(`<rect x="${barLeft}" y="${schedY}" width="${BAR_AREA_W}" height="${SCHED_H}" rx="2" fill="none" stroke="${C.border}" stroke-width="0.4"/>`);
    } else {
      // No schedule data: empty dashed placeholder
      p.push(`<rect x="${barLeft}" y="${schedY}" width="${BAR_AREA_W}" height="${SCHED_H}" rx="2" fill="${C.emptyBar}" stroke="${C.border}" stroke-width="0.4" stroke-dasharray="3,2"/>`);
    }

    // ── Summary column (right of bars) ──
    if (!day.isFuture) {
      const smR = W - PAD_X - 2;
      const dayEnd = day.isToday && day.nowHour !== null ? day.nowHour : 24;
      let outageH = 0;
      for (const o of day.outages) outageH += o.endHour - o.startHour;
      const actualOnH = Math.max(0, Math.round((dayEnd - outageH) * 10) / 10);

      // Actual ON hours
      p.push(`<text x="${smR}" y="${actualY + 12}" text-anchor="end" fill="${C.summaryOn}" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="700">${fmtHours(actualOnH)}</text>`);

      if (hasSchedule) {
        // Separator line
        p.push(`<line x1="${smR - 44}" y1="${actualY + 16}" x2="${smR}" y2="${actualY + 16}" stroke="${C.sepLine}" stroke-width="0.75"/>`);

        // Expected ON hours
        let expOnH = 0;
        for (let s = 0; s < 48; s++) {
          const sh = s * 0.5;
          if (sh >= dayEnd) break;
          expOnH += Math.min(0.5, dayEnd - sh) * (day.schedule[s] ? 1 : 0);
        }
        expOnH = Math.round(expOnH * 10) / 10;
        p.push(`<text x="${smR}" y="${actualY + 26}" text-anchor="end" fill="${C.summaryExp}" font-family="Inter,Arial,sans-serif" font-size="9.5">${fmtHours(expOnH)}</text>`);

        // Difference
        const diff = Math.round((actualOnH - expOnH) * 10) / 10;
        const dc = diff > 0 ? C.diffPos : (diff < 0 ? C.diffNeg : C.muted);
        const ds = diff > 0 ? '+' : (diff < 0 ? '-' : '');
        p.push(`<text x="${smR}" y="${actualY + 36}" text-anchor="end" fill="${dc}" font-family="Inter,Arial,sans-serif" font-size="9" font-weight="600">${ds}${fmtHours(Math.abs(diff))}</text>`);
      }
    }
  }

  // Draw now-markers on top of everything
  for (const m of nowMarkers) {
    p.push(m);
  }

  // Hour axis
  const tickY = axisY + 2;
  for (let h = 0; h <= 24; h++) {
    const x = hourToX(h);
    if (h % 4 === 0) {
      p.push(`<line x1="${x}" y1="${tickY}" x2="${x}" y2="${tickY + 5}" stroke="${C.muted}" stroke-width="1"/>`);
      p.push(`<text x="${x}" y="${tickY + 16}" text-anchor="middle" fill="${C.muted}" font-family="Inter,Arial,sans-serif" font-size="10">${h}</text>`);
    } else {
      p.push(`<line x1="${x}" y1="${tickY}" x2="${x}" y2="${tickY + 3}" stroke="${C.dimmed}" stroke-width="0.5"/>`);
    }
  }

  // Legend
  const legY = axisY + AXIS_H + 6;
  const legItems: { color: string; label: string }[] = [
    { color: C.green, label: 'Є світло' },
    { color: C.red, label: 'Відключення' },
    { color: C.yellow, label: 'Графік: увімк' },
    { color: C.schedOff, label: 'Графік: вимк' },
  ];
  let legX = barLeft;
  for (const item of legItems) {
    p.push(`<rect x="${legX}" y="${legY}" width="10" height="10" rx="2" fill="${item.color}"/>`);
    p.push(`<text x="${legX + 14}" y="${legY + 9}" fill="${C.muted}" font-family="Inter,Arial,sans-serif" font-size="9.5">${esc(item.label)}</text>`);
    legX += 14 + item.label.length * 5.8 + 14;
  }

  // Statistics
  const statsTop = legY + LEGEND_H;
  p.push(`<line x1="${PAD_X}" y1="${statsTop - 4}" x2="${W - PAD_X}" y2="${statsTop - 4}" stroke="${C.border}" stroke-width="0.5"/>`);

  const col1 = PAD_X + 8;
  const col2 = W / 2 + 8;
  const lineH = 15;
  const sFont = `font-family="Inter,Arial,sans-serif" font-size="10"`;
  const bFont = `font-family="Inter,Arial,sans-serif" font-size="10" font-weight="700"`;
  const upPct = Math.round((stats.totalPowerOnHours / Math.max(stats.elapsedHours, 1)) * 1000) / 10;

  const statLines: [number, string, string][] = [
    [col1, '🟢 Зі світлом: ', `${fmtHours(stats.totalPowerOnHours)} (${upPct}%)`],
    [col2, '🔴 Без світла: ', `${fmtHours(stats.totalPowerOffHours)}, ${stats.outageCount} відкл.`],
    [col1, '⏱ Найдовше зі світлом: ', `${fmtHours(stats.longestOn)}`],
    [col2, '⏱ Найдовше без світла: ', `${fmtHours(stats.longestOff)}`],
    [col1, '📊 Середнє відключення: ', `${fmtHours(stats.avgOutage)}`],
    [col2, '📊 Різниця від графіку: ', `${stats.diffMinutes > 0 ? '+' : ''}${stats.diffMinutes}хв (${stats.diffPercent > 0 ? '+' : ''}${stats.diffPercent}%)`],
  ];

  for (let i = 0; i < statLines.length; i++) {
    const [x, label, value] = statLines[i];
    const y = statsTop + 8 + Math.floor(i / 2) * lineH;
    p.push(`<text x="${x}" y="${y}" fill="${C.statLabel}" ${sFont}>${esc(label)}<tspan ${bFont}>${esc(value)}</tspan></text>`);
  }

  p.push('</svg>');
  return p.join('\n');
}
