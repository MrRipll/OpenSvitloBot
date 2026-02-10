import { Env } from './types';
import { handlePing } from './handlers/ping';
import { handleRegister } from './handlers/register';
import { handleStatus, handleDevices, handleOutages, handleStats } from './handlers/api';
import { checkDevices } from './cron/check-devices';

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    let response: Response;

    try {
      switch (url.pathname) {
        case '/ping':
          response = await handlePing(request, env);
          break;

        case '/api/status':
          response = await handleStatus(env);
          break;

        case '/api/devices':
          response = await handleDevices(env);
          break;

        case '/api/outages':
          response = await handleOutages(request, env);
          break;

        case '/api/stats':
          response = await handleStats(request, env);
          break;

        case '/api/register':
          if (request.method !== 'POST') {
            response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
              status: 405,
              headers: { 'Content-Type': 'application/json' },
            });
          } else {
            response = await handleRegister(request, env);
          }
          break;

        case '/':
          response = new Response(null, {
            status: 302,
            headers: { Location: 'https://github.com/MrRipll/OpenSvitloBot' },
          });
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
    await checkDevices(env);
  },
};
