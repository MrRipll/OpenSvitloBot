import { Env } from './types';
import { ensureSchema } from './migrate';
import { handlePing } from './handlers/ping';
import { checkDevices } from './cron/check-devices';
import { updateWeeklyChart } from './cron/update-chart';
import { refreshScheduleCache } from './services/schedule-cache';
import { handlePublicHistory, refreshPublicHistory } from './services/public-history';

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function withCors(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(env))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // Public analytics data for the site — no key, read-only.
    if (url.pathname === '/api/public/history' && request.method === 'GET') {
      try {
        await ensureSchema(env.DB);
        return withCors(await handlePublicHistory(env), env);
      } catch (err) {
        console.error('public history failed', err);
        return withCors(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }), env);
      }
    }

    // Auth: require API_KEY on all other endpoints
    const key = url.searchParams.get('key');
    if (!key || key !== env.API_KEY) {
      return withCors(unauthorized(), env);
    }

    let response: Response;

    try {
      await ensureSchema(env.DB);
      switch (url.pathname) {
        case '/ping':
          response = await handlePing(env);
          break;

        default:
          response = new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      response = new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return withCors(response, env);
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env.DB);
    await checkDevices(env);

    // Offset from the chart's 15-minute steps (:00/:15/:30/:45) so the schedule download
    // never lands on the same tick as a PNG render.
    const minutes = new Date().getMinutes();
    if (minutes % 5 === 2) {
      await refreshScheduleCache(env.DB, env.OUTAGE_GROUP);
    }
    // Site data: rebuilt only when flagged dirty, on its own tick (renders are :00/:30, schedule :x2/:x7).
    if (minutes % 5 === 4) {
      await refreshPublicHistory(env);
    }

    await updateWeeklyChart(env);
  },
};
