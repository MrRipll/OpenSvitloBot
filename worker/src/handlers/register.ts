import { Env } from '../types';
import { registerDevice } from '../services/db';

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: { name?: string; group_name?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const name = body.name?.trim();
  if (!name) {
    return new Response(JSON.stringify({ error: 'Device name is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const groupName = body.group_name?.trim() || '';
  const id = crypto.randomUUID();
  const key = crypto.randomUUID().replace(/-/g, '');

  await registerDevice(env.DB, id, key, name, groupName);

  return new Response(
    JSON.stringify({
      id,
      key,
      name,
      group_name: groupName,
      ping_url: `/ping?key=${key}`,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
