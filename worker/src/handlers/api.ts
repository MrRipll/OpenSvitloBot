import { Env } from '../types';
import { getAllDevices, getOutages, getStats } from '../services/db';

export async function handleStatus(env: Env): Promise<Response> {
  const devices = await getAllDevices(env.DB);
  const now = Date.now();

  const status = devices.map((d) => ({
    id: d.id,
    name: d.name,
    group_name: d.group_name,
    status: d.status,
    last_ping: d.last_ping,
    last_ping_ago: d.last_ping ? Math.floor((now - d.last_ping) / 1000) : null,
    last_status_change: d.last_status_change,
  }));

  return jsonResponse({ devices: status, timestamp: now });
}

export async function handleDevices(env: Env): Promise<Response> {
  const devices = await getAllDevices(env.DB);
  return jsonResponse({ devices });
}

export async function handleOutages(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7', 10);
  const clampedDays = Math.min(Math.max(days, 1), 90);

  const outages = await getOutages(env.DB, clampedDays);
  return jsonResponse({ outages, days: clampedDays });
}

export async function handleStats(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const periodParam = url.searchParams.get('period') || '7d';
  const periodDays = parseInt(periodParam.replace('d', ''), 10) || 7;
  const clampedDays = Math.min(Math.max(periodDays, 1), 90);

  const stats = await getStats(env.DB, clampedDays);
  const totalSeconds = clampedDays * 24 * 60 * 60;

  const result = stats.map((s) => ({
    device_id: s.device_id,
    device_name: s.device_name,
    group_name: s.group_name,
    outage_count: s.outage_count,
    total_outage_seconds: s.total_outage_seconds,
    total_outage_hours: Math.round((s.total_outage_seconds / 3600) * 100) / 100,
    uptime_percent: Math.round(((totalSeconds - s.total_outage_seconds) / totalSeconds) * 10000) / 100,
  }));

  return jsonResponse({ stats: result, period_days: clampedDays });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
