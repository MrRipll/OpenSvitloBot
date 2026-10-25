/* OpenSvitloBot public analytics. Everything is computed here, in the browser, from
 * /api/public/history (see worker/src/services/public-history.ts for the format).
 *
 * Time model: all math runs on "local ms" — epoch ms shifted by the Kyiv UTC offset, so the
 * UTC getters of a Date return Kyiv wall-clock fields and a day is exactly DAY long. */
(() => {
  'use strict';

  const MIN = 60e3, HOUR = 36e5, DAY = 864e5;
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const WD_IN = ['у понеділок', 'у вівторок', 'у середу', 'у четвер', 'у пʼятницю', 'у суботу', 'у неділю'];
  const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const PERIODS = [['7', '7 днів'], ['30', '30 днів'], ['90', '90 днів'], ['all', 'Весь час']];
  const API = '/api/public/history';

  // ── Time helpers ──────────────────────────────────────────────────────────
  const tzFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  });
  const offCache = new Map();
  function tzOff(ms) {
    const k = Math.floor(ms / (30 * MIN));
    let o = offCache.get(k);
    if (o === undefined) {
      const t = k * 30 * MIN;
      const p = {};
      for (const x of tzFmt.formatToParts(new Date(t))) p[x.type] = x.value;
      o = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t;
      offCache.set(k, o);
    }
    return o;
  }
  const L = ms => ms + tzOff(ms);
  const dayStart = l => Math.floor(l / DAY) * DAY;
  const weekStart = l => dayStart(l) - wdOf(l) * DAY;
  const wdOf = l => (new Date(l).getUTCDay() + 6) % 7;
  const hourOf = l => new Date(l).getUTCHours();
  const dateKey = l => new Date(l).toISOString().slice(0, 10);
  const keyToL = k => Date.parse(k + 'T00:00:00Z');
  const pad = n => String(n).padStart(2, '0');
  const clock = (l, isEnd) => (isEnd && l % DAY === 0 ? '24:00' : `${pad(new Date(l).getUTCHours())}:${pad(new Date(l).getUTCMinutes())}`);
  const ddmm = l => `${pad(new Date(l).getUTCDate())}.${pad(new Date(l).getUTCMonth() + 1)}`;
  const longDate = l => `${new Date(l).getUTCDate()} ${MONTHS_GEN[new Date(l).getUTCMonth()]}`;

  function dur(ms) {
    const m = Math.max(0, Math.round(ms / MIN));
    const h = Math.floor(m / 60), r = m % 60;
    if (!h) return `${r} хв`;
    if (!r) return `${h} год`;
    return `${h} год ${r} хв`;
  }
  function durLong(ms) {
    if (ms >= 2 * DAY) {
      const d = Math.floor(ms / DAY), h = Math.round((ms - d * DAY) / HOUR);
      return `${d} ${plural(d, 'день', 'дні', 'днів')}${h ? ` ${h} год` : ''}`;
    }
    return dur(ms);
  }
  function plural(n, one, few, many) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = x => `${Math.round(x * 100)}%`;
  const relDay = (l, nowL) => {
    const d = Math.round((dayStart(l) - dayStart(nowL)) / DAY);
    return d === 0 ? 'сьогодні' : d === 1 ? 'завтра' : `${WD[wdOf(l)].toLowerCase()} ${ddmm(l)}`;
  };
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

  /** Total length of sorted, non-overlapping intervals inside [a, b). */
  function sumIn(iv, a, b) {
    let t = 0;
    for (const [s, e] of iv) {
      if (e <= a) continue;
      if (s >= b) break;
      t += Math.min(e, b) - Math.max(s, a);
    }
    return t;
  }
  /** Runs of `ch` in a 48-slot day string, as [start, end) local ms. */
  function runs(str, ch, ds) {
    const out = [];
    let s = -1;
    for (let i = 0; i <= str.length; i++) {
      const hit = i < str.length && str[i] === ch;
      if (hit && s < 0) s = i;
      if (!hit && s >= 0) { out.push([ds + s * 30 * MIN, ds + i * 30 * MIN]); s = -1; }
    }
    return out;
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  function buildModel(raw) {
    const h = raw.history || {};
    const live = raw.live || {};
    const nowL = L(Date.now());

    const outages = (h.outages || []).map(([s, e]) => ({ s: L(s * 1000), e: e == null ? null : L(e * 1000) }));
    outages.sort((a, b) => a.s - b.s);
    // The cached history may lag a few minutes behind the live status — reconcile.
    const last = outages[outages.length - 1];
    if (live.status === 'offline' && live.since) {
      const since = L(live.since);
      if (!last || (last.e !== null && last.e <= since)) outages.push({ s: since, e: null });
    } else if (live.status === 'online' && last && last.e === null && live.since) {
      last.e = Math.max(last.s, L(live.since));
    }
    const iv = outages.map(o => [o.s, o.e ?? nowL]).filter(([s, e]) => e > s);

    const trackStart = h.trackingSince ? L(h.trackingSince) : iv.length ? iv[0][0] : nowL;

    const sched = h.schedule || {};
    const blocks = [], cover = [];
    for (const k of Object.keys(sched).sort()) {
      const str = sched[k];
      if (!str || str.length !== 48) continue;
      const ds = keyToL(k);
      const lc = cover[cover.length - 1];
      if (lc && lc[1] === ds) lc[1] = ds + DAY; else cover.push([ds, ds + DAY]);
      for (const r of runs(str, '0', ds)) {
        const lb = blocks[blocks.length - 1];
        if (lb && lb[0 + 1] === r[0]) lb[1] = r[1]; else blocks.push(r);
      }
    }

    return {
      raw, live, nowL, outages, iv, trackStart, sched, blocks, cover,
      preset: Array.isArray(h.preset) && h.preset.length === 7 ? h.preset : null,
      group: h.group || '',
      generatedAt: h.generatedAt || null,
      online: live.status === 'online' ? true : live.status === 'offline' ? false : null,
    };
  }

  const covered = (m, t) => m.cover.some(([s, e]) => t >= s && t < e);

  function periodRange(m, p) {
    const b = m.nowL;
    const a = p === 'all' ? m.trackStart : Math.max(m.trackStart, b - Number(p) * DAY);
    return [a, b];
  }

  function periodStats(m, a, b) {
    const off = sumIn(m.iv, a, b);
    const obs = Math.max(0, b - a);
    const list = m.outages.filter(o => o.s >= a && o.s < b);
    const durs = list.map(o => (o.e ?? m.nowL) - o.s);
    // Actual vs scheduled, only where a schedule is known.
    let actCov = 0, schedCov = 0;
    for (const [c0, c1] of m.cover) {
      const s = Math.max(a, c0), e = Math.min(b, c1);
      if (e <= s) continue;
      actCov += sumIn(m.iv, s, e);
      schedCov += sumIn(m.blocks, s, e);
    }
    return {
      off, obs, on: obs - off, count: list.length,
      avg: durs.length ? durs.reduce((x, y) => x + y, 0) / durs.length : 0,
      longest: durs.length ? Math.max(...durs) : 0,
      actCov, schedCov, hasCover: schedCov > 0 || actCov > 0 && m.cover.some(([s, e]) => e > a && s < b),
    };
  }

  /** Matches real outages to scheduled blocks: start/end deviations, unplanned and cancelled ones. */
  function accuracy(m, a, b) {
    const PAD = 30 * MIN;
    const blocks = m.blocks.filter(x => x[1] > a && x[0] < b && x[0] < m.nowL);
    const groups = new Map();
    const unplanned = [];
    let total = 0;
    for (const o of m.outages) {
      if (o.s < a || o.s >= b || !covered(m, o.s)) continue;
      total++;
      const oe = o.e ?? m.nowL;
      let best = null, bo = 0;
      for (const bl of blocks) {
        if (bl[0] - PAD > oe) break;
        const ov = overlap(o.s, oe, bl[0] - PAD, bl[1] + PAD);
        if (ov > bo) { bo = ov; best = bl; }
      }
      if (!best) { unplanned.push(o); continue; }
      const g = groups.get(best) || { s: Infinity, e: -Infinity, open: false };
      g.s = Math.min(g.s, o.s);
      if (o.e === null) g.open = true; else g.e = Math.max(g.e, o.e);
      groups.set(best, g);
    }
    const startD = [], endD = [];
    for (const [bl, g] of groups) {
      startD.push({ d: (g.s - bl[0]) / MIN, at: bl[0], bl });
      if (!g.open && bl[1] <= m.nowL && g.e > -Infinity) endD.push({ d: (g.e - bl[1]) / MIN, at: bl[1], bl });
    }
    const cancelled = blocks.filter(bl => bl[1] <= m.nowL && !groups.has(bl) && bl[1] - bl[0] >= HOUR);
    const sd = startD.map(x => x.d).sort((x, y) => x - y);
    const ed = endD.map(x => x.d).sort((x, y) => x - y);
    return {
      total, planned: total - unplanned.length, unplanned,
      unplannedMs: unplanned.reduce((t, o) => t + ((o.e ?? m.nowL) - o.s), 0),
      blocksPast: blocks.filter(bl => bl[1] <= m.nowL).length,
      cancelled, startD, endD,
      startMed: quantile(sd, 0.5), startLo: quantile(sd, 0.25), startHi: quantile(sd, 0.75),
      endMed: quantile(ed, 0.5), endLo: quantile(ed, 0.25), endHi: quantile(ed, 0.75),
    };
  }

  function heatmap(m, a, b) {
    const off = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const obs = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (let t = Math.floor(a / HOUR) * HOUR; t < b; t += HOUR) {
      const v = Math.min(t + HOUR, b) - Math.max(t, a);
      if (v > 0) obs[wdOf(t)][hourOf(t)] += v;
    }
    for (const [s0, e0] of m.iv) {
      const s = Math.max(s0, a), e = Math.min(e0, b);
      if (e <= s) continue;
      for (let t = Math.floor(s / HOUR) * HOUR; t < e; t += HOUR) {
        const v = overlap(s, e, t, t + HOUR);
        if (v > 0) off[wdOf(t)][hourOf(t)] += v;
      }
    }
    return { off, obs };
  }

  /** Per-day aggregates over the whole tracked history. */
  function dailyStats(m) {
    const days = [];
    let oi = 0;
    for (let ds = dayStart(m.trackStart); ds <= dayStart(m.nowL); ds += DAY) {
      const a = Math.max(ds, m.trackStart), b = Math.min(ds + DAY, m.nowL);
      const key = dateKey(ds);
      const str = m.sched[key];
      let count = 0;
      while (oi < m.outages.length && m.outages[oi].s < ds) oi++;
      for (let j = oi; j < m.outages.length && m.outages[j].s < ds + DAY; j++) count++;
      days.push({
        ds, key, obs: Math.max(0, b - a), off: sumIn(m.iv, a, b), count,
        sched: str && str.length === 48 ? sumIn(runs(str, '0', ds), a, b) : null,
        schedFull: str && str.length === 48 ? sumIn(runs(str, '0', ds), ds, ds + DAY) : null,
      });
    }
    return days;
  }

  function weeklyStats(days) {
    const map = new Map();
    for (const d of days) {
      const ws = weekStart(d.ds);
      const w = map.get(ws) || { ws, off: 0, obs: 0, sched: 0, schedKnown: false, count: 0 };
      w.off += d.off; w.obs += d.obs; w.count += d.count;
      if (d.sched !== null) { w.sched += d.sched; w.schedKnown = true; }
      map.set(ws, w);
    }
    return [...map.values()].sort((x, y) => x.ws - y.ws);
  }

  // ── Rendering helpers ─────────────────────────────────────────────────────
  const $ = sel => document.querySelector(sel);
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  const RAMP_LIGHT = ['#efeee9', '#f8dad8', '#f2b0ac', '#e67f79', '#d34a44', '#a32b28'];
  const RAMP_DARK = ['#262624', '#432322', '#66302d', '#8f3a36', '#c04741', '#ef6b66'];
  const ramp = () => (darkMq.matches ? RAMP_DARK : RAMP_LIGHT);
  const level = (v, steps) => { let i = 0; while (i < steps.length && v >= steps[i]) i++; return i; };

  function seg(cls, l0, l1, ds, tip) {
    const left = ((l0 - ds) / DAY) * 100, width = ((l1 - l0) / DAY) * 100;
    if (width <= 0) return '';
    return `<div class="seg ${cls}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"${tip ? ` data-tip="${esc(tip)}"` : ''}></div>`;
  }

  /** One day timeline: actual (past), planned/possible (future), schedule strip (past). */
  function dayRow(m, ds, opts) {
    const de = ds + DAY;
    const cut = Math.min(Math.max(m.nowL, ds), de);
    const key = dateKey(ds);
    const str = m.sched[key] && m.sched[key].length === 48 ? m.sched[key] : null;
    const start = Math.max(ds, m.trackStart);
    let html = `<div class="seg track" style="left:0;width:100%"></div>`;

    if (cut > start) {
      html += seg('on', start, cut, ds);
      for (const o of m.outages) {
        const oe = o.e ?? m.nowL;
        if (oe <= ds || o.s >= cut) continue;
        const s = Math.max(o.s, ds), e = Math.min(oe, cut);
        const tip = o.e === null
          ? `<b>Немає світла</b> з ${clock(o.s)} · вже ${dur(m.nowL - o.s)}`
          : `<b>Без світла</b> ${clock(o.s)}–${clock(o.e, true)}${dayStart(o.s) !== dayStart(o.e) ? ` (${ddmm(o.s)}–${ddmm(o.e)})` : ''} · ${dur(o.e - o.s)}`;
        html += seg('off', s, e, ds, tip);
      }
    }
    let planned = 0, maybe = 0;
    if (str) {
      for (const [s, e] of runs(str, '0', ds)) {
        const fs = Math.max(s, cut);
        if (e > fs) html += seg('plan', fs, e, ds, `<b>За графіком без світла</b> ${clock(s)}–${clock(e, true)} · ${dur(e - s)}`);
        const ps = Math.max(s, start), pe = Math.min(e, cut);
        if (pe > ps) html += seg('sched', ps, pe, ds, `<b>Графік:</b> без світла ${clock(s)}–${clock(e, true)}`);
        planned += e - s;
      }
    } else if (m.preset && cut < de) {
      const p = m.preset[wdOf(ds)];
      for (const [s, e] of runs(p, '0', ds)) {
        const fs = Math.max(s, cut);
        if (e > fs) html += seg('plan', fs, e, ds, `<b>Без світла за прогнозом</b> ${clock(s)}–${clock(e, true)}`);
        planned += e - s;
      }
      for (const [s, e] of runs(p, '2', ds)) {
        const fs = Math.max(s, cut);
        if (e > fs) html += seg('maybe', fs, e, ds, `<b>Можливе відключення</b> ${clock(s)}–${clock(e, true)} (тижневий прогноз)`);
        maybe += e - s;
      }
    }
    if (m.nowL >= ds && m.nowL < de) {
      html += `<div class="now" style="left:${(((m.nowL - ds) / DAY) * 100).toFixed(3)}%" data-tip="Зараз ${clock(m.nowL)}"></div>`;
    }
    if (ds + DAY <= m.trackStart) html = `<div class="seg track" style="left:0;width:100%"></div>`;

    let val;
    if (cut > start) {
      const off = sumIn(m.iv, start, cut);
      val = off >= MIN ? `${dur(off)}` : `<span class="good">без відкл.</span>`;
      if (str) val += `<small>графік ${dur(planned)}</small>`;
    } else if (str) {
      val = `<span class="muted">${planned ? `план ${dur(planned)}` : 'без відкл.'}</span>`;
    } else if (m.preset) {
      val = `<span class="muted">${maybe || planned ? `до ${dur(maybe + planned)}` : '—'}</span><small>прогноз</small>`;
    } else {
      val = '<span class="muted">—</span>';
    }

    const isToday = m.nowL >= ds && m.nowL < de;
    return `<div class="tl-row${isToday ? ' today' : ''}">
      <div class="tl-label"><b>${esc(opts.label)}</b><span>${esc(opts.sub || ddmm(ds))}</span></div>
      <div class="tl-bar">${html}</div>
      <div class="tl-val num">${val}</div>
    </div>`;
  }

  function axis(cls = 'tl-axis') {
    let s = `<div class="${cls}">`;
    for (let h = 0; h <= 24; h += 3) s += `<span style="left:${(h / 24) * 100}%">${pad(h)}</span>`;
    return s + '</div>';
  }

  const legendHTML = (withMaybe) => `<div class="legend">
    <span><i class="sw-on"></i>Світло було</span>
    <span><i class="sw-off"></i>Відключення</span>
    <span><i class="sw-plan"></i>За графіком</span>
    ${withMaybe ? '<span><i class="sw-maybe"></i>Можливе (прогноз)</span>' : ''}
    <span><i class="sw-strip"></i>Графік для порівняння</span>
    <span><i class="sw-now"></i>Зараз</span>
  </div>`;

  // ── Sections ──────────────────────────────────────────────────────────────
  function heroHTML(m, acc30) {
    const st = m.online === true ? 'on' : m.online === false ? 'off' : 'unknown';
    const since = m.live.since ? L(m.live.since) : null;
    const title = st === 'on' ? 'Світло є' : st === 'off' ? 'Світла немає' : 'Статус невідомий';

    const hints = [];
    const next = m.blocks.find(bl => bl[1] > m.nowL);
    const inBlock = next && next[0] <= m.nowL;
    const typical = (med, word) => (isFinite(med) && Math.abs(med) >= 3
      ? ` <span class="muted">· зазвичай ${word} на ~${Math.abs(Math.round(med))} хв ${med > 0 ? 'пізніше' : 'раніше'}</span>` : '');
    if (st === 'off') {
      if (inBlock) {
        hints.push(`За графіком світло мають дати <b>${relDay(next[1], m.nowL) === 'сьогодні' ? '' : relDay(next[1], m.nowL) + ' '}о ${clock(next[1], true)}</b>${typical(acc30.endMed, 'вмикають')}`);
      } else if (covered(m, m.nowL)) {
        hints.push('За графіком зараз світло <b>мало б бути</b> — схоже на позапланове відключення');
        if (next) hints.push(`Наступне відключення за графіком: <b>${relDay(next[0], m.nowL)} ${clock(next[0])}–${clock(next[1], true)}</b>`);
      }
    } else if (st === 'on') {
      if (inBlock) {
        hints.push(`За графіком зараз відключення до <b>${clock(next[1], true)}</b>, але світло є`);
      } else if (next) {
        hints.push(`Наступне відключення за графіком: <b>${relDay(next[0], m.nowL)} ${clock(next[0])}–${clock(next[1], true)}</b> <span class="muted">· через ${dur(next[0] - m.nowL)}</span>`);
        if (isFinite(acc30.startMed) && Math.abs(acc30.startMed) >= 3) {
          hints.push(`<span class="muted">Зазвичай вимикають на ~${Math.abs(Math.round(acc30.startMed))} хв ${acc30.startMed > 0 ? 'пізніше' : 'раніше'} графіка</span>`);
        }
      } else if (covered(m, m.nowL)) {
        hints.push('За графіком відключень <b>найближчим часом немає</b>');
      }
    }
    if (!hints.length && m.preset) {
      for (let d = 0; d < 7 && !hints.length; d++) {
        const ds = dayStart(m.nowL) + d * DAY;
        if (m.sched[dateKey(ds)]) continue;
        const r = runs(m.preset[wdOf(ds)], '2', ds).concat(runs(m.preset[wdOf(ds)], '0', ds)).filter(x => x[1] > m.nowL).sort((x, y) => x[0] - y[0])[0];
        if (r) hints.push(`Можливе відключення за тижневим прогнозом: <b>${relDay(r[0], m.nowL)} ${clock(Math.max(r[0], m.nowL))}–${clock(r[1], true)}</b>`);
      }
    }

    let meta = '';
    if (m.live.lastPing) {
      const ago = Date.now() - m.live.lastPing;
      meta = st === 'on' && ago > 2 * MIN
        ? `<span class="bad">Немає сигналу від датчика ${dur(ago)} — статус може бути застарілим</span>`
        : `Датчик на звʼязку <span data-ago="${m.live.lastPing}">${agoText(ago)}</span>`;
    }

    const dsToday = dayStart(m.nowL);
    const todayStr = m.sched[dateKey(dsToday)];
    const offToday = sumIn(m.iv, Math.max(dsToday, m.trackStart), m.nowL);
    const cntToday = m.outages.filter(o => o.s >= dsToday).length;
    const planToday = todayStr && todayStr.length === 48 ? sumIn(runs(todayStr, '0', dsToday), dsToday, dsToday + DAY) : null;

    let rows = '';
    rows += dayRow(m, dsToday, { label: 'Сьогодні' });
    rows += dayRow(m, dsToday + DAY, { label: 'Завтра' });
    for (let d = 2; d < 7; d++) {
      const ds = dsToday + d * DAY;
      if (!m.sched[dateKey(ds)] && !m.preset) break;
      rows += dayRow(m, ds, { label: WD[wdOf(ds)] });
    }

    return `<section class="card hero">
      <div class="status ${st}">
        <div class="status-line"><span class="dot" aria-hidden="true"></span><span class="status-title">${title}</span></div>
        ${since ? `<div class="status-timer">${st === 'on' ? 'вже' : 'вже'} <b data-since="${m.live.since}">${durLong(Date.now() - m.live.since)}</b> · з ${relDay(since, m.nowL) === 'сьогодні' ? '' : ddmm(since) + ' '}${clock(since)}</div>` : ''}
        ${hints.length ? `<div class="status-hint">${hints.map(x => `<div>${x}</div>`).join('')}</div>` : ''}
        ${meta ? `<div class="status-meta">${meta}</div>` : ''}
      </div>
      <div class="today-box">
        <div class="mini-kpis">
          <div class="mini"><h3>Сьогодні без світла</h3><div class="v num">${dur(offToday)}</div></div>
          <div class="mini"><h3>За графіком</h3><div class="v num">${planToday === null ? '—' : dur(planToday)}</div></div>
          <div class="mini"><h3>Відключень</h3><div class="v num">${cntToday}</div></div>
        </div>
        <div class="tl">${rows}${axis()}</div>
        ${legendHTML(!!m.preset)}
      </div>
    </section>`;
  }

  const agoText = ms => (ms < MIN ? `${Math.max(1, Math.round(ms / 1000))} с тому` : `${dur(ms)} тому`);

  function kpisHTML(m, p) {
    const [a, b] = periodRange(m, p);
    const s = periodStats(m, a, b);
    let prev = null;
    if (p !== 'all') {
      const len = b - a, pa = a - len;
      if (pa >= m.trackStart - HOUR) prev = periodStats(m, pa, a);
    }
    const delta = (cur, old, unitFn, lessIsGood, label) => {
      if (!prev) return '';
      const d = cur - old;
      if (Math.abs(d) < MIN * 5 && unitFn === dur) return `<div class="d muted">як і попередні ${label}</div>`;
      const good = lessIsGood ? d < 0 : d > 0;
      return `<div class="d ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${unitFn(Math.abs(d))} ${d > 0 ? 'більше' : 'менше'}, ніж попередні ${label}</div>`;
    };
    const label = p === '7' ? '7 днів' : p === '30' ? '30 днів' : '90 днів';
    const up = s.obs ? s.on / s.obs : 1;
    const diff = s.actCov - s.schedCov;
    return `<div class="kpis">
      <div class="kpi"><h3>Зі світлом</h3><div class="v num">${pct(up)}</div><div class="s">${dur(s.on)} з ${durLong(s.obs)}</div>
        ${prev && prev.obs ? `<div class="d ${up >= prev.on / prev.obs ? 'good' : 'bad'}">${up >= prev.on / prev.obs ? '▲' : '▼'} ${Math.abs(Math.round((up - prev.on / prev.obs) * 100))} п.п. проти попередніх ${label}</div>` : ''}</div>
      <div class="kpi"><h3>Без світла</h3><div class="v num">${dur(s.off)}</div><div class="s">${s.count} ${plural(s.count, 'відключення', 'відключення', 'відключень')}</div>${delta(s.off, prev?.off ?? 0, dur, true, label)}</div>
      <div class="kpi"><h3>Середнє відключення</h3><div class="v num">${s.count ? dur(s.avg) : '—'}</div><div class="s">${s.count ? `найдовше ${dur(s.longest)}` : 'відключень не було'}</div></div>
      <div class="kpi"><h3>Порівняно з графіком</h3>${s.schedCov || s.actCov
        ? `<div class="v num ${diff > 5 * MIN ? 'bad' : diff < -5 * MIN ? 'good' : ''}">${Math.abs(diff) < 5 * MIN ? '≈ 0' : `${diff > 0 ? '+' : '−'}${dur(Math.abs(diff))}`}</div>
           <div class="s">${Math.abs(diff) < 5 * MIN ? 'точно за графіком' : diff > 0 ? 'без світла довше, ніж за графіком' : 'без світла менше, ніж за графіком'}</div>
           <div class="d muted">графік: ${dur(s.schedCov)}, факт: ${dur(s.actCov)}</div>`
        : '<div class="v muted">—</div><div class="s">немає даних графіка за цей період</div>'}</div>
    </div>`;
  }

  function heatmapHTML(m, p) {
    const [a, b] = periodRange(m, p);
    const { off, obs } = heatmap(m, a, b);
    const R = ramp(), steps = [0.0001, 0.1, 0.25, 0.4, 0.6];
    let cells = '<div></div>';
    for (let h = 0; h < 24; h++) cells += `<div class="cl${h % 3 === 0 ? ' h3' : ''}">${h}</div>`;
    for (let d = 0; d < 7; d++) {
      cells += `<div class="rl">${WD[d]}</div>`;
      for (let h = 0; h < 24; h++) {
        const o = obs[d][h];
        if (!o) { cells += `<div class="c" style="background:transparent;border:1px dashed var(--hair)"></div>`; continue; }
        const v = off[d][h] / o;
        cells += `<div class="c" style="background:${R[level(v, steps)]}" data-tip="<b>${WD[d]}, ${pad(h)}:00–${pad(h + 1)}:00</b><br>без світла ${pct(v)} часу"></div>`;
      }
    }
    // Insights from the same data.
    const byHour = new Array(24).fill(0).map((_, h) => {
      let o = 0, t = 0;
      for (let d = 0; d < 7; d++) { o += off[d][h]; t += obs[d][h]; }
      return t ? o / t : 0;
    });
    let bestW = 0, bestH = 0;
    for (let h = 0; h < 24; h++) {
      const w = (byHour[h] + byHour[(h + 1) % 24]) / 2;
      if (w > bestW) { bestW = w; bestH = h; }
    }
    const byDay = off.map((r, d) => { const o = r.reduce((x, y) => x + y, 0), t = obs[d].reduce((x, y) => x + y, 0); return t ? o / t : null; });
    const valid = byDay.map((v, d) => [v, d]).filter(x => x[0] !== null);
    const worstD = valid.reduce((x, y) => (y[0] > x[0] ? y : x), [-1, 0]);
    const bestD = valid.reduce((x, y) => (y[0] < x[0] ? y : x), [2, 0]);
    const totalOff = off.flat().reduce((x, y) => x + y, 0);

    const insight = totalOff > 0
      ? `Найчастіше світла немає <b>з ${pad(bestH)}:00 до ${pad((bestH + 2) % 24)}:00</b> (${pct(bestW)} часу). Найважчий день — <b>${WD_IN[worstD[1]]}</b> (${pct(worstD[0])}), найлегший — <b>${WD_IN[bestD[1]]}</b> (${pct(bestD[0])}).`
      : 'За цей період відключень не було.';

    return `<section class="card">
      <div class="card-head"><h2>Коли найчастіше немає світла</h2><p class="muted">частка часу без світла за день тижня і годину</p></div>
      <div class="hm" role="img" aria-label="Теплова карта відключень">${cells}</div>
      <div class="scale"><span>0%</span>${R.slice(1).map(c => `<i style="background:${c}"></i>`).join('')}<span>60%+</span></div>
      <p class="note ink2" style="font-size:14px">${insight}</p>
    </section>`;
  }

  function accuracyHTML(m, p) {
    const [a, b] = periodRange(m, p);
    const acc = accuracy(m, a, b);
    if (!acc.total && !acc.blocksPast) {
      return `<section class="card"><div class="card-head"><h2>Чи можна вірити графіку?</h2></div>
        <div class="empty">За цей період немає даних графіка, щоб порівняти.</div></section>`;
    }
    const fmtR = v => `${Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : ''}${Math.abs(Math.round(v))} хв`;
    const fmtD = v => (isFinite(v) ? (Math.abs(v) < 1 ? 'вчасно' : `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))} хв`) : '—');
    const word = (v, late, early) => (isFinite(v) ? (Math.abs(v) < 3 ? 'майже точно за графіком' : v > 0 ? late : early) : 'мало даних');
    const share = acc.total ? acc.planned / acc.total : 0;

    return `<section class="card">
      <div class="card-head"><h2>Чи можна вірити графіку?</h2><p class="muted">факт проти опублікованого графіка</p></div>
      <div class="acc-top">
        <div class="mini"><h3>Відключення за графіком</h3><div class="v num">${acc.total ? pct(share) : '—'}</div><small>${acc.planned} з ${acc.total}</small></div>
        <div class="mini"><h3>Вимикають</h3><div class="v num">${fmtD(acc.startMed)}</div><small>${word(acc.startMed, 'пізніше графіка', 'раніше графіка')}</small></div>
        <div class="mini"><h3>Вмикають</h3><div class="v num">${fmtD(acc.endMed)}</div><small>${word(acc.endMed, 'пізніше графіка', 'раніше графіка')}</small></div>
        <div class="mini"><h3>Позапланові</h3><div class="v num">${acc.unplanned.length}</div><small>${acc.unplanned.length ? `разом ${dur(acc.unplannedMs)}` : 'не було'}</small></div>
      </div>
      <div class="strip" id="strip"></div>
      <p class="note">Кожна точка — одне відключення: наскільки раніше (ліворуч) чи пізніше (праворуч) графіка зникло або зʼявилось світло.
      ${acc.cancelled.length ? ` За графіком мали бути ще <b class="ink2">${acc.cancelled.length}</b> ${plural(acc.cancelled.length, 'відключення', 'відключення', 'відключень')}, але світло не вимикали.` : ''}
      ${isFinite(acc.startLo) ? ` Половина відключень починається в межах від ${fmtR(acc.startLo)} до ${fmtR(acc.startHi)} від графіка${isFinite(acc.endLo) ? `, а закінчується — від ${fmtR(acc.endLo)} до ${fmtR(acc.endHi)}` : ''}.` : ''}</p>
    </section>`;
  }

  function drawStrip(m, p) {
    const el = $('#strip');
    if (!el) return;
    const [a, b] = periodRange(m, p);
    const acc = accuracy(m, a, b);
    const W = el.clientWidth - (window.innerWidth <= 520 ? 84 : 106);
    if (W <= 50) return;
    const RANGE = 90;
    const x = d => ((Math.max(-RANGE, Math.min(RANGE, d)) + RANGE) / (2 * RANGE)) * W;
    const row = (label, list, color, kind) => {
      let svg = `<svg viewBox="0 0 ${W} 46" height="46" preserveAspectRatio="none">`;
      svg += `<line x1="${x(0)}" x2="${x(0)}" y1="2" y2="44" stroke="var(--ink-2)" stroke-width="1.5"/>`;
      for (const t of (W >= 420 ? [-60, -30, 30, 60] : [-45, 45])) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="6" y2="40" stroke="var(--hair)"/>`;
      list.forEach((it, i) => {
        const jitter = ((i * 7919) % 23) - 11;
        const tip = `<b>${kind} ${longDate(it.at)}</b><br>за графіком ${clock(it.at, kind === 'Увімкнення')}, ${Math.abs(it.d) < 1 ? 'вчасно' : `${it.d > 0 ? 'на' : 'на'} ${dur(Math.abs(it.d) * MIN)} ${it.d > 0 ? 'пізніше' : 'раніше'}`}`;
        svg += `<circle cx="${x(it.d).toFixed(1)}" cy="${23 + jitter * 0.8}" r="4.5" fill="${color}" fill-opacity=".75" stroke="var(--surface)" stroke-width="1.5" data-tip="${esc(tip)}"/>`;
      });
      return `<div class="strip-row"><span>${label}</span>${svg}</svg></div>`;
    };
    let ax = '<div class="strip-axis">';
    const ticks = W >= 420
      ? [[-90, '≤ −90 хв'], [-60, '−60'], [-30, '−30'], [0, 'за графіком'], [30, '+30'], [60, '+60'], [90, '≥ +90 хв']]
      : [[-90, '−90'], [-45, '−45'], [0, '0'], [45, '+45'], [90, '+90 хв']];
    for (const [t, lbl] of ticks) {
      ax += `<span style="left:${x(t)}px">${lbl}</span>`;
    }
    ax += '</div>';
    el.innerHTML = row('Вимкнення', acc.startD, 'var(--off)', 'Вимкнення') + row('Увімкнення', acc.endD, 'var(--on)', 'Увімкнення') + ax;
  }

  function calendarHTML(days, m) {
    if (!days.length) return '';
    const R = ramp(), steps = [MIN, 2 * HOUR, 4 * HOUR, 8 * HOUR, 12 * HOUR];
    const first = weekStart(days[0].ds);
    const byKey = new Map(days.map(d => [d.ds, d]));
    let cells = '<div></div>';
    for (let d = 0; d < 7; d++) cells += `<div class="wd">${d % 2 === 0 ? WD[d] : ''}</div>`;
    let lastMonth = new Date(first + 6 * DAY).getUTCMonth(), col = 0, lastLabelCol = -9;
    for (let ws = first; ws <= dayStart(m.nowL); ws += 7 * DAY, col++) {
      const mo = new Date(ws + 6 * DAY).getUTCMonth();
      const label = (mo !== lastMonth || col === 0) && col - lastLabelCol >= 3;
      cells += `<div class="m">${label ? MONTHS[mo] : ''}</div>`;
      if (label) lastLabelCol = col;
      lastMonth = mo;
      for (let d = 0; d < 7; d++) {
        const ds = ws + d * DAY;
        const day = byKey.get(ds);
        if (!day || !day.obs) { cells += '<div class="c"></div>'; continue; }
        const isToday = ds === dayStart(m.nowL);
        const tip = `<b>${WD[d]}, ${longDate(ds)}</b><br>без світла ${dur(day.off)}${day.count ? ` · ${day.count} ${plural(day.count, 'відключення', 'відключення', 'відключень')}` : ''}${day.schedFull !== null ? `<br>за графіком ${dur(day.schedFull)}` : ''}${isToday ? '<br><i>сьогодні, ще триває</i>' : ''}`;
        cells += `<div class="c${isToday ? ' today-c' : ''}" style="background:${R[level(day.off, steps)]}" data-tip="${esc(tip)}"></div>`;
      }
    }
    const legend = ['0', '<2', '2–4', '4–8', '8–12', '12+'];
    return `<section class="card">
      <div class="card-head"><h2>Календар відключень</h2><p class="muted">годин без світла на день, уся історія</p></div>
      <div class="cal-scroll" id="calScroll"><div class="cal">${cells}</div></div>
      <div class="scale">${R.map((c, i) => `<i style="background:${c}"></i><span>${legend[i]}</span>`).join(' ')}<span>год</span></div>
    </section>`;
  }

  function factsHTML(m, days, weeks) {
    const facts = [];
    const nowL = m.nowL;
    // Current streak.
    if (m.online && m.live.since && Date.now() - m.live.since > 12 * HOUR) {
      facts.push(['☀️', `Світло є вже <b>${durLong(Date.now() - m.live.since)}</b> без перерви.`]);
    }
    // Week over week.
    const last7 = sumIn(m.iv, nowL - 7 * DAY, nowL), prev7 = sumIn(m.iv, nowL - 14 * DAY, nowL - 7 * DAY);
    if (nowL - 14 * DAY >= m.trackStart && (last7 || prev7)) {
      const d = last7 - prev7;
      if (Math.abs(d) >= HOUR) {
        facts.push([d < 0 ? '📉' : '📈', `За останні 7 днів без світла <b>${dur(last7)}</b> — на ${dur(Math.abs(d))} ${d < 0 ? 'менше' : 'більше'}, ніж тижнем раніше.`]);
      }
    }
    // Typical on/off hours over 30 days.
    const a30 = Math.max(m.trackStart, nowL - 30 * DAY);
    const recent = m.outages.filter(o => o.s >= a30 && o.e !== null && o.e - o.s >= 10 * MIN);
    if (recent.length >= 5) {
      const mode = arr => { const c = new Array(24).fill(0); arr.forEach(h => c[h]++); const mx = Math.max(...c); return [c.indexOf(mx), mx]; };
      const [offH, offN] = mode(recent.map(o => hourOf(o.s)));
      const [onH, onN] = mode(recent.map(o => hourOf(o.e)));
      facts.push(['🕕', `Найчастіше вимикають <b>о ${pad(offH)}:00–${pad(offH + 1)}:00</b> (${offN} з ${recent.length} разів за 30 днів), а вмикають — <b>о ${pad(onH)}:00–${pad(onH + 1)}:00</b> (${onN} разів).`]);
    }
    // Full days without outages.
    const clean = days.filter(d => d.obs >= DAY - MIN && d.off < MIN).length;
    const full = days.filter(d => d.obs >= DAY - MIN).length;
    if (full >= 7) facts.push(['✅', `Днів зовсім без відключень: <b>${clean}</b> з ${full} (${pct(clean / full)}).`]);
    // Total.
    const total = sumIn(m.iv, m.trackStart, nowL);
    if (total > 0) facts.push(['⏳', `Загалом без світла <b>${durLong(total)}</b> за ${durLong(nowL - m.trackStart)} спостережень — це ${pct(total / Math.max(1, nowL - m.trackStart))} усього часу.`]);
    // Unplanned share for 30 days.
    const acc = accuracy(m, a30, nowL);
    if (acc.total >= 5) {
      facts.push(['⚡', acc.unplanned.length
        ? `За 30 днів <b>${acc.unplanned.length}</b> ${plural(acc.unplanned.length, 'відключення було', 'відключення були', 'відключень були')} поза графіком.`
        : 'За 30 днів <b>усі</b> відключення були за графіком.']);
    }
    if (!facts.length) return '';
    return `<section class="card">
      <div class="card-head"><h2>Цікаві факти</h2></div>
      <div class="facts">${facts.map(([ic, t]) => `<div class="fact"><span class="ic">${ic}</span><p>${t}</p></div>`).join('')}</div>
    </section>`;
  }

  function weeklyChart(el, weeks, m) {
    const list = weeks.slice(-26);
    const W = el.clientWidth;
    if (!list.length || W < 50) { el.innerHTML = '<div class="empty">Ще замало даних.</div>'; return; }
    const H = 200, padL = 34, padB = 22, padT = 8;
    const max = Math.max(4 * HOUR, ...list.map(w => Math.max(w.off, w.sched)));
    const stepH = max > 60 * HOUR ? 20 : max > 30 * HOUR ? 10 : max > 12 * HOUR ? 5 : 2;
    const top = Math.ceil(max / HOUR / stepH) * stepH;
    const y = v => padT + (H - padT - padB) * (1 - v / (top * HOUR));
    const bw = (W - padL) / list.length;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    for (let g = 0; g <= top; g += stepH) {
      s += `<line x1="${padL}" x2="${W}" y1="${y(g * HOUR)}" y2="${y(g * HOUR)}" stroke="var(--hair)"/>`;
      s += `<text x="${padL - 6}" y="${y(g * HOUR) + 4}" text-anchor="end">${g}</text>`;
    }
    const curWs = weekStart(m.nowL);
    list.forEach((w, i) => {
      const x0 = padL + i * bw + bw * 0.18, bwi = Math.max(2, bw * 0.64);
      const isCur = w.ws === curWs;
      const tip = `<b>${ddmm(w.ws)}–${ddmm(w.ws + 6 * DAY)}${isCur ? ' (поточний)' : ''}</b><br>без світла ${dur(w.off)} · ${w.count} ${plural(w.count, 'відключення', 'відключення', 'відключень')}${w.schedKnown ? `<br>за графіком ${dur(w.sched)}` : ''}`;
      s += `<rect x="${x0}" y="${y(w.off)}" width="${bwi}" height="${Math.max(0, y(0) - y(w.off))}" rx="3" fill="var(--off)" fill-opacity="${isCur ? 0.45 : 0.9}"/>`;
      if (w.schedKnown) s += `<line x1="${x0 - 2}" x2="${x0 + bwi + 2}" y1="${y(w.sched)}" y2="${y(w.sched)}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`;
      s += `<rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT}" fill="transparent" data-tip="${esc(tip)}"/>`;
      const every = Math.ceil(list.length / Math.max(1, Math.floor((W - padL) / 48)));
      if (i % every === 0) s += `<text x="${x0 + bwi / 2}" y="${H - 6}" text-anchor="middle">${ddmm(w.ws)}</text>`;
    });
    el.innerHTML = s + '</svg>';
  }

  function durationChart(el, m, p) {
    const [a, b] = periodRange(m, p);
    const list = m.outages.filter(o => o.s >= a && o.s < b && o.e !== null).map(o => o.e - o.s);
    const W = el.clientWidth;
    if (!list.length || W < 50) { el.innerHTML = '<div class="empty">За цей період завершених відключень немає.</div>'; return; }
    const B = [[0, 30, '<30 хв'], [30, 60, '30–60 хв'], [60, 120, '1–2 год'], [120, 180, '2–3 год'], [180, 240, '3–4 год'], [240, 360, '4–6 год'], [360, 600, '6–10 год'], [600, Infinity, '10+ год']];
    const counts = B.map(([lo, hi]) => list.filter(d => d >= lo * MIN && d < hi * MIN).length);
    const max = Math.max(...counts);
    const rowH = 26, labelW = 72, H = B.length * rowH;
    const x = v => ((W - labelW - 40) * v) / max;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    B.forEach(([, , lbl], i) => {
      const y0 = i * rowH;
      s += `<text x="${labelW - 8}" y="${y0 + 17}" text-anchor="end" style="fill:var(--ink-2)">${lbl}</text>`;
      s += `<rect x="${labelW}" y="${y0 + 5}" width="${Math.max(counts[i] ? 3 : 0, x(counts[i]))}" height="${rowH - 10}" rx="4" fill="var(--off)" fill-opacity=".85"/>`;
      s += `<text x="${labelW + x(counts[i]) + 6}" y="${y0 + 17}" style="fill:var(--ink)">${counts[i] || ''}</text>`;
      s += `<rect x="0" y="${y0}" width="${W}" height="${rowH}" fill="transparent" data-tip="<b>${esc(lbl)}</b><br>${counts[i]} ${plural(counts[i], 'відключення', 'відключення', 'відключень')} (${pct(counts[i] / list.length)})"/>`;
    });
    el.innerHTML = s + '</svg>';
  }

  function recordsHTML(m, days, weeks) {
    const recs = [];
    let lo = null;
    for (const o of m.outages) {
      const d = (o.e ?? m.nowL) - o.s;
      if (!lo || d > lo.d) lo = { d, o };
    }
    if (lo) recs.push(['Найдовше без світла', durLong(lo.d), lo.o.e === null ? `з ${longDate(lo.o.s)}, триває` : `${longDate(lo.o.s)}, ${clock(lo.o.s)}–${clock(lo.o.e, true)}`]);
    let prev = m.trackStart, ls = null;
    for (const [s, e] of m.iv) {
      if (!ls || s - prev > ls.d) ls = { d: s - prev, a: prev, b: s };
      prev = Math.max(prev, e);
    }
    if (m.online !== false && (!ls || m.nowL - prev > ls.d)) ls = { d: m.nowL - prev, a: prev, b: null };
    if (ls && ls.d > 0) recs.push(['Найдовше зі світлом', durLong(ls.d), ls.b ? `${ddmm(ls.a)}–${ddmm(ls.b)}` : `з ${longDate(ls.a)}, триває`]);
    const worstDay = days.reduce((x, d) => (!x || d.off > x.off ? d : x), null);
    if (worstDay && worstDay.off > 0) recs.push(['Найважчий день', dur(worstDay.off), `${WD[wdOf(worstDay.ds)]}, ${longDate(worstDay.ds)}`]);
    const busiest = days.reduce((x, d) => (!x || d.count > x.count ? d : x), null);
    if (busiest && busiest.count > 1) recs.push(['Найбільше відключень за день', `${busiest.count}`, `${WD[wdOf(busiest.ds)]}, ${longDate(busiest.ds)}`]);
    const full = weeks.filter(w => w.obs >= 7 * DAY - HOUR);
    if (full.length >= 2) {
      const best = full.reduce((x, w) => (w.off < x.off ? w : x));
      const worst = full.reduce((x, w) => (w.off > x.off ? w : x));
      recs.push(['Найкращий тиждень', dur(best.off), `${ddmm(best.ws)}–${ddmm(best.ws + 6 * DAY)}`]);
      recs.push(['Найгірший тиждень', dur(worst.off), `${ddmm(worst.ws)}–${ddmm(worst.ws + 6 * DAY)}`]);
    }
    recs.push(['Усього відключень', `${m.outages.length}`, `з ${longDate(m.trackStart)}`]);
    recs.push(['Спостерігаємо', durLong(m.nowL - m.trackStart), `з ${longDate(m.trackStart)} ${new Date(m.trackStart).getUTCFullYear()}`]);
    return `<section class="card">
      <div class="card-head"><h2>Рекорди</h2><p class="muted">за весь час</p></div>
      <div class="records">${recs.map(([h, v, s]) => `<div class="rec"><h3>${h}</h3><div class="v num">${v}</div><div class="s">${s}</div></div>`).join('')}</div>
    </section>`;
  }

  let historyDays = 14;
  function historyHTML(m) {
    let rows = '';
    const today = dayStart(m.nowL);
    let shown = 0;
    for (let d = 1; d <= historyDays; d++) {
      const ds = today - d * DAY;
      if (ds + DAY <= m.trackStart) break;
      rows += dayRow(m, ds, { label: WD[wdOf(ds)] });
      shown++;
    }
    const canMore = today - (historyDays + 1) * DAY + DAY > m.trackStart;
    return `<section class="card" id="history">
      <div class="card-head"><h2>Історія по днях</h2><p class="muted">фактичні відключення і графік</p></div>
      ${shown ? `<div class="tl">${rows}${axis()}</div>` : '<div class="empty">Історія ще не накопичилась.</div>'}
      ${canMore ? '<button class="more" id="more">Показати ще 14 днів</button>' : ''}
    </section>`;
  }

  // ── Page assembly ─────────────────────────────────────────────────────────
  let M = null;
  let period = new URLSearchParams(location.search).get('period') || '30';
  if (!PERIODS.some(([k]) => k === period)) period = '30';

  function render() {
    const m = M;
    const days = dailyStats(m);
    const weeks = weeklyStats(days);
    const acc30 = accuracy(m, Math.max(m.trackStart, m.nowL - 30 * DAY), m.nowL);

    $('#subtitle').textContent = `${m.group ? `Група ${m.group.replace(/^GPV/, '')} · ` : ''}моніторинг і статистика відключень`;

    const tabs = `<div class="tabs-wrap"><h2>Статистика</h2><div class="tabs" role="group" aria-label="Період">${PERIODS.map(([k, l]) => `<button data-period="${k}" aria-pressed="${k === period}">${l}</button>`).join('')}</div></div>`;

    $('#app').innerHTML = [
      heroHTML(m, acc30),
      factsHTML(m, days, weeks),
      tabs,
      kpisHTML(m, period),
      `<div class="grid-2">${heatmapHTML(m, period)}${accuracyHTML(m, period)}</div>`,
      calendarHTML(days, m),
      `<div class="grid-2">
        <section class="card"><div class="card-head"><h2>Тижні</h2><p class="muted">годин без світла · <span style="color:var(--ink)">—</span> за графіком</p></div><div class="bars" id="weekly"></div></section>
        <section class="card"><div class="card-head"><h2>Тривалість відключень</h2><p class="muted">скільки разів, за обраний період</p></div><div class="bars" id="durations"></div></section>
      </div>`,
      recordsHTML(m, days, weeks),
      historyHTML(m),
    ].join('');

    drawCharts(weeks);
    const cs = $('#calScroll');
    if (cs) cs.scrollLeft = cs.scrollWidth;

    const upd = m.generatedAt ? `Статистика оновлена ${clock(L(m.generatedAt))} ${ddmm(L(m.generatedAt))}.` : '';
    $('#foot').innerHTML = `<div>Статус — з датчика в реальному часі. ${upd} Час київський.</div>
      <div>Графіки відключень: <a href="https://github.com/Baskerville42/outage-data-ua" target="_blank" rel="noopener">outage-data-ua</a>. Код: <a href="https://github.com/MrRipll/OpenSvitloBot" target="_blank" rel="noopener">OpenSvitloBot</a>.</div>`;
  }

  let lastWeeks = null;
  function drawCharts(weeks) {
    lastWeeks = weeks;
    const w = $('#weekly'), d = $('#durations');
    if (w) weeklyChart(w, weeks, M);
    if (d) durationChart(d, M, period);
    drawStrip(M, period);
  }

  function renderPeriod() {
    const u = new URL(location.href);
    if (period === '30') u.searchParams.delete('period'); else u.searchParams.set('period', period);
    history.replaceState(null, '', u);
    render();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-period]');
    if (b) { period = b.dataset.period; renderPeriod(); return; }
    if (e.target.closest('#more')) {
      historyDays += 14;
      const sec = $('#history');
      sec.outerHTML = historyHTML(M);
    }
  });

  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => M && lastWeeks && drawCharts(lastWeeks), 150); });
  darkMq.addEventListener?.('change', () => M && render());

  // Live counters.
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-since]')) el.textContent = durLong(Date.now() - Number(el.dataset.since));
    for (const el of document.querySelectorAll('[data-ago]')) el.textContent = agoText(Date.now() - Number(el.dataset.ago));
  }, 1000);

  // Tooltip.
  const tip = $('#tip');
  let tipFor = null;
  function showTip(el, x, y) {
    tipFor = el;
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  const hideTip = () => { tip.hidden = true; tipFor = null; };
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY); else if (tipFor) hideTip();
  });
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el && e.pointerType === 'touch') showTip(el, e.clientX, e.clientY); else if (!el) hideTip();
  });
  window.addEventListener('scroll', () => tipFor && hideTip(), { passive: true });

  // ── Data loading ──────────────────────────────────────────────────────────
  async function load() {
    try {
      const raw = window.__DATA__ || await fetch(API, { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      if (!raw.history) throw new Error('історія ще не зібрана — зазирніть за кілька хвилин');
      M = buildModel(raw);
      render();
    } catch (err) {
      if (!M) {
        $('#app').innerHTML = `<section class="card"><div class="empty">Не вдалося завантажити дані: ${esc(err.message)}</div></section>`;
      }
    }
  }
  load();
  if (!window.__DATA__) setInterval(load, 60 * 1000);
})();
